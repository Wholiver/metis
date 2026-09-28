import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { createBrowserHostController, isHttpUrl, resolveNavigateUrl, computeSvgContentRect, resolveKeyboardKey } = require("../desktop/browser-host.cjs") as {
	createBrowserHostController: (options?: {
		getMainWindow?: () => { webContents: { send: (channel: string, payload: unknown) => void } } | undefined;
		getWorkspaceRoot?: () => string;
		token?: string;
	}) => {
		start: () => Promise<{ baseUrl: string; token: string }>;
		stop: () => void;
		registerGuest: (guest: unknown) => void;
		bindTab: (tabId: string, webContentsId: number, meta?: { url?: string; title?: string }) => { ok: boolean };
		handleCommand: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
		token: string;
		baseUrl: string;
	};
	isHttpUrl: (value: string) => boolean;
	resolveNavigateUrl: (
		raw: string,
		workspaceRoot?: string,
	) => { url?: string; filePath?: string; error?: string };
	computeSvgContentRect: (
		viewport: { x?: number; y?: number; width?: number; height?: number } | null,
		viewBox?: { width?: number; height?: number } | null,
	) => { x: number; y: number; width: number; height: number } | null;
	resolveKeyboardKey: (raw: string) => {
		error?: string;
		key?: string;
		code?: string;
		keyCode?: string;
	};
};

describe("desktop browser-host controller", () => {
	const controllers: Array<{ stop: () => void }> = [];

	afterEach(() => {
		for (const controller of controllers) controller.stop();
		controllers.length = 0;
	});

	it("validates http urls", () => {
		expect(isHttpUrl("http://localhost:3000")).toBe(true);
		expect(isHttpUrl("https://example.com")).toBe(true);
		expect(isHttpUrl("file:///tmp")).toBe(false);
		expect(isHttpUrl("javascript:alert(1)")).toBe(false);
	});

	it("resolves workspace-relative SVG paths to file:// URLs", () => {
		const dir = mkdtempSync(join(tmpdir(), "metis-browser-"));
		try {
			const svgPath = join(dir, "pelican.svg");
			writeFileSync(svgPath, "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
			const resolved = resolveNavigateUrl("pelican.svg", dir);
			expect(resolved.error).toBeUndefined();
			expect(resolved.url).toBe(pathToFileURL(svgPath).href);
			expect(resolveNavigateUrl("missing.svg", dir).error).toMatch(/File not found/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects unauthorized and non-local command posts", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "test-token",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		const { baseUrl, token } = await controller.start();
		expect(token).toBe("test-token");

		const unauthorized = await fetch(`${baseUrl}/browser/command`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-metis-browser-token": "wrong" },
			body: JSON.stringify({ op: "tabs", action: "list" }),
		});
		expect(unauthorized.status).toBe(401);

		const ok = await fetch(`${baseUrl}/browser/command`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-metis-browser-token": "test-token" },
			body: JSON.stringify({ op: "tabs", action: "list" }),
		});
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as { ok: boolean; tabs: unknown[] };
		expect(body.ok).toBe(true);
		expect(body.tabs).toEqual([]);
	});

	it("snapshots and clicks through a mock guest webContents", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const guest = {
			id: 42,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Demo",
			focus: vi.fn(),
			sendInputEvent: vi.fn(),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("interactiveOnly") || script.includes("data-metis-ref")) {
					if (script.includes("getBoundingClientRect") && script.includes("scrollIntoView")) {
						return {
							ok: true,
							x: 12,
							y: 34,
							width: 80,
							height: 24,
							tag: "button",
							url: "http://127.0.0.1:3000/",
							title: "Demo",
						};
					}
					if (script.includes("interactiveOnly")) {
						return {
							url: "http://127.0.0.1:3000/",
							title: "Demo",
							nodes: [{ ref: "e0", tag: "button", name: "Save" }],
							pointerLocked: false,
							viewportWidth: 800,
							viewportHeight: 600,
						};
					}
				}
				if (script.includes("getBoundingClientRect")) {
					return {
						ok: true,
						x: 12,
						y: 34,
						width: 80,
						height: 24,
						tag: "button",
						url: "http://127.0.0.1:3000/",
						title: "Demo",
					};
				}
				if (script.includes("pointerLockElement")) {
					return {
						url: "http://127.0.0.1:3000/",
						title: "Demo",
						pointerLocked: false,
						pointerLockTag: null,
					};
				}
				if (script.includes("standalone") || script.includes("viewBox")) {
					return null;
				}
				return { ok: true, url: "http://127.0.0.1:3000/", title: "Demo" };
			}),
			once: vi.fn(),
			capturePage: vi.fn(async () => ({
				toPNG: () => Buffer.from("png"),
			})),
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-1", 42, { url: "http://127.0.0.1:3000/", title: "Demo" }).ok).toBe(true);

		const snapshot = await controller.handleCommand({ op: "snapshot" });
		expect(snapshot.ok).toBe(true);
		expect(String(snapshot.snapshot)).toContain("[e0]");
		expect(String(snapshot.snapshot)).toContain("pointerLocked:");

		const click = await controller.handleCommand({ op: "click", ref: "e0" });
		expect(click.ok).toBe(true);
		expect(guest.sendInputEvent).toHaveBeenCalled();

		const screenshot = await controller.handleCommand({ op: "screenshot" });
		expect(screenshot.ok).toBe(true);
		expect(screenshot.mimeType).toBe("image/png");
		expect(typeof screenshot.screenshotBase64).toBe("string");
	});

	it("asks renderer to open a tab when none exist", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const navigatePromise = controller.handleCommand({
			op: "navigate",
			url: "http://127.0.0.1:5173",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(send).toHaveBeenCalledWith(
			"browser:host-ensure-tab",
			expect.objectContaining({ url: "http://127.0.0.1:5173" }),
		);

		const guest = {
			id: 7,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:5173/",
			getTitle: () => "Vite",
			loadURL: vi.fn(async () => undefined),
			once: vi.fn(),
			executeJavaScript: vi.fn(),
		};
		controller.registerGuest(guest);
		controller.bindTab("browser-9", 7, { url: "http://127.0.0.1:5173/", title: "Vite" });
		const result = await navigatePromise;
		expect(result.ok).toBe(true);
		expect(result.tabId).toBe("browser-9");
	});

	it("exposes browser host IPC in desktop preload", () => {
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { resolve } = require("node:path") as typeof import("node:path");
		const preload = readFileSync(resolve(process.cwd(), "desktop/preload.cjs"), "utf8");
		expect(preload).toContain('ipcRenderer.invoke("browser:bind-tab"');
		expect(preload).toContain('ipcRenderer.on("browser:host-ensure-tab"');
		expect(preload).toContain("onEnsureTab");
		expect(preload).toContain('ipcRenderer.on("browser:host-busy"');
		expect(preload).toContain("onBusy");
	});

	it("packages every main.cjs helper, including browser-host.cjs, into desktop dist", () => {
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { resolve } = require("node:path") as typeof import("node:path");
		const main = readFileSync(resolve(process.cwd(), "desktop/main.cjs"), "utf8");
		const build = readFileSync(resolve(process.cwd(), "desktop/scripts/build.mjs"), "utf8");
		const helpers = [...main.matchAll(/require\("\.\/([^"]+\.cjs)"\)/g)].map((match) => match[1]);
		expect(helpers).toContain("browser-host.cjs");
		for (const helper of helpers) {
			expect(build).toContain(`"${helper}"`);
		}
	});

	it("locks Inspector webview zoom gestures and applies fit zoom in the browser panel", () => {
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { resolve } = require("node:path") as typeof import("node:path");
		const panel = readFileSync(
			resolve(process.cwd(), "desktop/src/components/inspector/InspectorBrowserPanel.tsx"),
			"utf8",
		);
		expect(panel).toContain("setVisualZoomLevelLimits?.(1, 1)");
		expect(panel).toContain("setZoomFactor?.(next)");
		expect(panel).toContain("getZoomFactor");
		expect(panel).toContain("computeFitZoomScale");
		expect(panel).toContain("ResizeObserver");
		expect(panel).toContain("Math.abs(prev.width - width) < 2");
		expect(panel).toContain("Math.abs(current - next) < 0.01");
		expect(panel).toContain("initialSrc");
		expect(panel).toContain("memo(InspectorBrowserPanelInner");
		expect(panel).toContain('data-browser-viewport=""');
		expect(panel).toContain("data-browser-fit-viewport");
		expect(panel).toContain("BROWSER_FIT_VIEWPORT_SCRIPT");
		expect(panel).toContain("loadURL('about:blank')");
		// Must not force zoom back to 1 after fitting oversized media.
		expect(panel).not.toContain("setZoomFactor?.(1)");
		// Controlled src rebinds on every address-bar update and reloads the guest.
		expect(panel).not.toContain("src={currentUrl");
	});

	it("keeps browser-fit viewport script in sync across host and renderer", () => {
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { resolve } = require("node:path") as typeof import("node:path");
		const {
			BROWSER_FIT_VIEWPORT_SCRIPT: fromHost,
			computeFitZoomScale,
		} = require("../desktop/browser-fit.cjs") as {
			BROWSER_FIT_VIEWPORT_SCRIPT: string;
			computeFitZoomScale: (
				contentWidth: number,
				contentHeight: number,
				viewportWidth: number,
				viewportHeight: number,
			) => number;
		};
		const ts = readFileSync(resolve(process.cwd(), "desktop/src/lib/browser-fit.ts"), "utf8");
		const host = readFileSync(resolve(process.cwd(), "desktop/browser-host.cjs"), "utf8");
		const build = readFileSync(resolve(process.cwd(), "desktop/scripts/build.mjs"), "utf8");
		const markers = [
			"metis-browser-fit-viewport",
			"svg:root",
			"max-width: 100vw",
			"max-height: 100vh",
			"preserveAspectRatio",
			"xMidYMid meet",
			"object-fit: contain",
			"object-fit: fill",
			"not-media-document",
			"Boolean(media) || isSvgUrl()",
			"Never treat arbitrary file://",
			"zoomFactor",
			"waitFrames",
		];
		for (const marker of markers) {
			expect(fromHost).toContain(marker);
			expect(ts).toContain(marker);
		}
		// Must not flex-center every file:// HTML page as if it were media.
		expect(fromHost).not.toContain("isFileUrl() || isSvgUrl()");
		expect(fromHost).not.toMatch(/shouldFit = Boolean\(media\) \|\| isFileUrl\(\)/);
		expect(computeFitZoomScale(2400, 1600, 400, 300)).toBeCloseTo(0.1666, 3);
		expect(computeFitZoomScale(400, 300, 400, 300)).toBe(1);
		expect(host).toContain('require("./browser-fit.cjs")');
		expect(host).toContain("applyFitViewport");
		expect(host).toContain("setZoomFactor");
		expect(host).toContain("encodeScreenshotPng");
		expect(host).toContain("alreadyThere");
		expect(host).toContain("reloadIgnoringCache");
		expect(host).toContain("sendInputEvent");
		expect(host).toContain("standalone");
		expect(host).toContain("resolveKeyboardKey");
		expect(host).not.toContain("el.click()");
		expect(build).toContain('"browser-fit.cjs"');
	});

	it("skips redundant loadURL and setZoomFactor when guest is already fitted", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		let currentUrl = "https://example.com/";
		const loadURL = vi.fn(async (next: string) => {
			currentUrl = next;
		});
		const setZoomFactor = vi.fn();
		const getZoomFactor = vi.fn(() => 0.25);
		const guest = Object.assign(new EventEmitter(), {
			id: 88,
			isDestroyed: () => false,
			isLoading: () => false,
			getURL: () => currentUrl,
			getTitle: () => "Example",
			loadURL,
			getZoomFactor,
			setZoomFactor,
			setVisualZoomLevelLimits: vi.fn(),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("metis-browser-fit-viewport")) {
					return {
						fitted: true,
						zoomFactor: 0.25,
						contentWidth: 1600,
						contentHeight: 1200,
						viewportWidth: 400,
						viewportHeight: 300,
					};
				}
				if (script.includes("requestAnimationFrame")) return true;
				return null;
			}),
			capturePage: vi.fn(async () => ({
				getSize: () => ({ width: 800, height: 600 }),
				resize: vi.fn(function resize(this: { toPNG: () => Buffer }) {
					return { toPNG: () => Buffer.from("small-png") };
				}),
				toPNG: () => Buffer.from("big-png"),
			})),
			getSize: () => ({ width: 400, height: 300 }),
		});
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-skip", 88, { url: currentUrl, title: "Example" }).ok).toBe(true);

		const navigated = await controller.handleCommand({
			op: "navigate",
			url: "https://example.com/",
		});
		expect(navigated.ok).toBe(true);
		expect(loadURL).not.toHaveBeenCalled();
		expect(setZoomFactor).not.toHaveBeenCalled();

		const shot = await controller.handleCommand({ op: "screenshot" });
		expect(shot.ok).toBe(true);
		expect(shot.screenshotBase64).toBe(Buffer.from("small-png").toString("base64"));
		expect(setZoomFactor).not.toHaveBeenCalled();
	});

	it("applies fit-viewport script after navigate and before screenshot", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const dir = mkdtempSync(join(tmpdir(), "metis-browser-fit-"));
		try {
			const svgPath = join(dir, "wide.svg");
			writeFileSync(
				svgPath,
				"<svg xmlns='http://www.w3.org/2000/svg' width='2400' height='1600'></svg>",
			);
			const fileUrl = pathToFileURL(svgPath).href;
			let currentUrl = "about:blank";
			const scripts: string[] = [];
			const setZoomFactor = vi.fn();
			let guest: EventEmitter & {
				loadURL: ReturnType<typeof vi.fn>;
				executeJavaScript: ReturnType<typeof vi.fn>;
				capturePage: ReturnType<typeof vi.fn>;
				setZoomFactor: ReturnType<typeof vi.fn>;
			};
			guest = Object.assign(new EventEmitter(), {
				id: 77,
				isDestroyed: () => false,
				getURL: () => currentUrl,
				getTitle: () => "wide.svg",
				loadURL: vi.fn(async (next: string) => {
					currentUrl = next;
					queueMicrotask(() => guest.emit("did-finish-load"));
				}),
				executeJavaScript: vi.fn(async (script: string) => {
					scripts.push(script);
					if (script.includes("metis-browser-fit-viewport")) {
						return {
							fitted: true,
							tag: "svg",
							hasViewBox: true,
							zoomFactor: 0.25,
							contentWidth: 1600,
							contentHeight: 1200,
							viewportWidth: 400,
							viewportHeight: 300,
						};
					}
					if (script.includes("requestAnimationFrame")) return true;
					if (script.includes("querySelector('svg')")) {
						return { x: 0, y: 0, width: 400, height: 300, viewBox: { width: 2400, height: 1600 } };
					}
					return null;
				}),
				setZoomFactor,
				setVisualZoomLevelLimits: vi.fn(),
				capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from("png") })),
			}) as typeof guest;
			controller.registerGuest(guest);
			expect(controller.bindTab("browser-fit", 77, { url: "about:blank", title: "Browser" }).ok).toBe(true);

			const navigated = await controller.handleCommand({ op: "navigate", url: fileUrl });
			expect(navigated.ok).toBe(true);
			expect(scripts.some((script) => script.includes("metis-browser-fit-viewport"))).toBe(true);
			expect(setZoomFactor).toHaveBeenCalledWith(0.25);

			scripts.length = 0;
			setZoomFactor.mockClear();
			const shot = await controller.handleCommand({ op: "screenshot" });
			expect(shot.ok).toBe(true);
			expect(scripts.some((script) => script.includes("metis-browser-fit-viewport"))).toBe(true);
			expect(setZoomFactor).toHaveBeenCalledWith(0.25);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("crops SVG viewBox letterboxing inside a taller webview", () => {
		expect(computeSvgContentRect({ x: 0, y: 0, width: 1700, height: 1736 }, { width: 1200, height: 800 })).toMatchObject({
			x: 0,
			width: 1700,
			height: 1133,
		});
		expect(computeSvgContentRect({ x: 0, y: 0, width: 800, height: 400 }, { width: 100, height: 100 })).toMatchObject({
			x: 200,
			y: 0,
			width: 400,
			height: 400,
		});
		expect(computeSvgContentRect({ url: "x" } as never, null)).toBeNull();
	});

	it("navigates about:blank and reloads file:// on an existing tab", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const dir = mkdtempSync(join(tmpdir(), "metis-browser-"));
		try {
			const svgPath = join(dir, "pelican.svg");
			writeFileSync(svgPath, "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'></svg>");
			const fileUrl = pathToFileURL(svgPath).href;
			let currentUrl = "about:blank";
			let currentTitle = "Browser";
			let guest: EventEmitter & { loadURL: ReturnType<typeof vi.fn> };
			guest = Object.assign(new EventEmitter(), {
				id: 11,
				isDestroyed: () => false,
				getURL: () => currentUrl,
				getTitle: () => currentTitle,
				loadURL: vi.fn(async (next: string) => {
					currentUrl = next;
					currentTitle = next === "about:blank" ? "Browser" : "pelican.svg";
					queueMicrotask(() => guest.emit("did-finish-load"));
				}),
				executeJavaScript: vi.fn(async () => true),
				capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from("png") })),
			}) as EventEmitter & { loadURL: ReturnType<typeof vi.fn> };
			controller.registerGuest(guest);
			expect(controller.bindTab("browser-1", 11, { url: "about:blank", title: "Browser" }).ok).toBe(true);

			const blank = await controller.handleCommand({ op: "navigate", url: "about:blank" });
			expect(blank.ok).toBe(true);
			// Already on about:blank — skip a redundant loadURL, still return tab meta.
			expect(guest.loadURL).not.toHaveBeenCalled();
			expect(blank.title).toBe("Browser");

			const first = await controller.handleCommand({ op: "navigate", url: fileUrl });
			expect(first.ok).toBe(true);
			expect(String(first.url)).toBe(fileUrl);
			expect(String(guest.loadURL.mock.calls.at(-1)?.[0])).toContain("metisReload=");
			expect(send).toHaveBeenCalledWith(
				"browser:host-ensure-tab",
				expect.objectContaining({ url: expect.stringContaining("metisReload=") }),
			);

			const again = await controller.handleCommand({ op: "navigate", url: fileUrl });
			expect(again.ok).toBe(true);
			// file:// always gets a fresh metisReload token so the guest reloads.
			expect(guest.loadURL.mock.calls.length).toBeGreaterThanOrEqual(2);
			expect(String(guest.loadURL.mock.calls.at(-1)?.[0])).toContain("metisReload=");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("captures a cropped SVG screenshot after paint", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const capturePage = vi.fn(async (rect?: { x: number; y: number; width: number; height: number }) => {
			expect(rect).toMatchObject({ x: 0, width: 1700, height: 1133 });
			return { toPNG: () => Buffer.from("png") };
		});
		const guest = {
			id: 21,
			isDestroyed: () => false,
			getURL: () => "file:///tmp/pelican.svg",
			getTitle: () => "pelican.svg",
			once: vi.fn(),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("viewBox") || script.includes("standalone")) {
					return {
						x: 0,
						y: 0,
						width: 1700,
						height: 1736,
						viewBox: { width: 1200, height: 800 },
						standalone: true,
					};
				}
				return true;
			}),
			capturePage,
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-2", 21, { url: "file:///tmp/pelican.svg", title: "pelican.svg" }).ok).toBe(true);

		const screenshot = await controller.handleCommand({ op: "screenshot" });
		expect(screenshot.ok).toBe(true);
		expect(capturePage).toHaveBeenCalled();
	});

	it("notifies renderer while a controlling command runs, but not for tabs list", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const guest = {
			id: 42,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Demo",
			executeJavaScript: vi.fn(async () => ({
				url: "http://127.0.0.1:3000/",
				title: "Demo",
				nodes: [],
			})),
			once: vi.fn(),
			capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from("png") })),
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-1", 42, { url: "http://127.0.0.1:3000/", title: "Demo" }).ok).toBe(true);

		send.mockClear();
		const snapshot = await controller.handleCommand({ op: "snapshot" });
		expect(snapshot.ok).toBe(true);
		const busyCalls = send.mock.calls.filter((call) => call[0] === "browser:host-busy");
		expect(busyCalls[0]?.[1]).toEqual({ busy: true });
		expect(busyCalls.at(-1)?.[1]).toEqual({ busy: false });

		send.mockClear();
		const listed = await controller.handleCommand({ op: "tabs", action: "list" });
		expect(listed.ok).toBe(true);
		expect(send.mock.calls.some((call) => call[0] === "browser:host-busy")).toBe(false);
	});

	it("maps KeyW / w to Electron keyCode W", () => {
		expect(resolveKeyboardKey("w")).toMatchObject({ key: "w", code: "KeyW", keyCode: "W" });
		expect(resolveKeyboardKey("KeyW")).toMatchObject({ key: "w", code: "KeyW", keyCode: "W" });
		expect(resolveKeyboardKey("ArrowLeft")).toMatchObject({
			key: "ArrowLeft",
			code: "ArrowLeft",
			keyCode: "Left",
		});
		expect(resolveKeyboardKey("")).toMatchObject({ error: "key required" });
	});

	it("press_key uses sendInputEvent keyDown then keyUp with holdMs", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const events: Array<Record<string, unknown>> = [];
		const guest = {
			id: 91,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Game",
			focus: vi.fn(),
			sendInputEvent: vi.fn((event: Record<string, unknown>) => {
				events.push(event);
			}),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("pointerLockElement")) {
					return {
						url: "http://127.0.0.1:3000/",
						title: "Game",
						pointerLocked: true,
						pointerLockTag: "canvas",
					};
				}
				return true;
			}),
			once: vi.fn(),
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-key", 91, { url: "http://127.0.0.1:3000/", title: "Game" }).ok).toBe(true);

		const pressed = await controller.handleCommand({
			op: "press_key",
			key: "w",
			holdMs: 120,
			tabId: "browser-key",
		});
		expect(pressed.ok).toBe(true);
		expect(pressed.code).toBe("KeyW");
		expect(pressed.keyCode).toBe("W");
		expect(pressed.holdMs).toBe(120);
		expect(pressed.pointerLocked).toBe(true);
		expect(events.map((e) => e.type)).toEqual(["keyDown", "keyUp"]);
		expect(events[0]).toMatchObject({ type: "keyDown", keyCode: "W" });
		expect(events[1]).toMatchObject({ type: "keyUp", keyCode: "W" });
	});

	it("click and mouse use trusted sendInputEvent instead of el.click", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const events: Array<Record<string, unknown>> = [];
		const guest = {
			id: 92,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Game",
			focus: vi.fn(),
			sendInputEvent: vi.fn((event: Record<string, unknown>) => {
				events.push(event);
			}),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("scrollIntoView") && script.includes("getBoundingClientRect")) {
					return {
						ok: true,
						x: 100,
						y: 200,
						width: 40,
						height: 20,
						tag: "button",
						url: "http://127.0.0.1:3000/",
						title: "Game",
					};
				}
				if (script.includes("pointerLockElement")) {
					return {
						url: "http://127.0.0.1:3000/",
						title: "Game",
						pointerLocked: true,
						pointerLockTag: "canvas",
					};
				}
				return true;
			}),
			once: vi.fn(),
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-click", 92, { url: "http://127.0.0.1:3000/", title: "Game" }).ok).toBe(true);

		const clicked = await controller.handleCommand({ op: "click", ref: "e6", tabId: "browser-click" });
		expect(clicked.ok).toBe(true);
		expect(clicked.pointerLocked).toBe(true);
		expect(clicked.x).toBe(100);
		expect(clicked.y).toBe(200);
		expect(events.some((e) => e.type === "mouseDown")).toBe(true);
		expect(events.some((e) => e.type === "mouseUp")).toBe(true);
		expect(guest.executeJavaScript.mock.calls.some((call: string[]) => String(call[0]).includes("el.click()"))).toBe(
			false,
		);

		events.length = 0;
		const moved = await controller.handleCommand({
			op: "mouse",
			action: "move",
			x: 40,
			y: 50,
			tabId: "browser-click",
		});
		expect(moved.ok).toBe(true);
		expect(events).toEqual([{ type: "mouseMove", x: 40, y: 50 }]);

		events.length = 0;
		const looked = await controller.handleCommand({
			op: "mouse",
			action: "look",
			movementX: 35,
			movementY: -12,
			tabId: "browser-click",
		});
		expect(looked.ok).toBe(true);
		expect(looked.movementX).toBe(35);
		expect(looked.movementY).toBe(-12);
		expect(events[0]).toMatchObject({
			type: "mouseMove",
			movementX: 35,
			movementY: -12,
		});
	});

	it("allows pointerLock permission on the Inspector browser session", () => {
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { resolve } = require("node:path") as typeof import("node:path");
		const main = readFileSync(resolve(process.cwd(), "desktop/main.cjs"), "utf8");
		expect(main).toContain('session.fromPartition("persist:metis-browser")');
		expect(main).toContain("BROWSER_ALLOWED_PERMISSIONS");
		expect(main).toContain("pointerLock");
		expect(main).toContain("setPermissionCheckHandler");
		expect(main).toContain("setPermissionRequestHandler");
		expect(main).not.toMatch(
			/setPermissionRequestHandler\(\(_webContents,\s*_permission,\s*callback\)\s*=>\s*callback\(false\)\)/,
		);
	});

	it("scroll fuses trusted mouseWheel at viewport mid with scrollBy fallback", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const events: Array<Record<string, unknown>> = [];
		let scrollY = 0;
		const guest = {
			id: 95,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Doc",
			focus: vi.fn(),
			sendInputEvent: vi.fn((event: Record<string, unknown>) => {
				events.push(event);
				// Simulate Electron accepting the event without moving the document
				// (wrong hit-target / no scrollable under point).
			}),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("window.scrollX") && script.includes("innerWidth")) {
					return { x: 0, y: scrollY, w: 800, h: 600 };
				}
				if (script.includes("window.scrollX") && script.includes("window.scrollY")) {
					return { x: 0, y: scrollY };
				}
				if (script.includes("window.scrollBy")) {
					const match = /window\.scrollBy\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/.exec(script);
					if (match) scrollY += Number(match[2]);
					return true;
				}
				if (script.includes("pointerLockElement")) {
					return {
						url: "http://127.0.0.1:3000/",
						title: "Doc",
						pointerLocked: false,
						pointerLockTag: null,
					};
				}
				return true;
			}),
			once: vi.fn(),
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-scroll", 95, { url: "http://127.0.0.1:3000/", title: "Doc" }).ok).toBe(
			true,
		);

		const scrolled = await controller.handleCommand({
			op: "scroll",
			direction: "down",
			amount: 400,
			tabId: "browser-scroll",
		});
		expect(scrolled.ok).toBe(true);
		expect(events).toEqual([
			{
				type: "mouseWheel",
				x: 400,
				y: 300,
				deltaX: 0,
				deltaY: 400,
				hasPreciseScrollingDeltas: true,
				canScroll: true,
			},
		]);
		expect(scrollY).toBe(400);
		expect(
			guest.executeJavaScript.mock.calls.some((call: string[]) => String(call[0]).includes("window.scrollBy")),
		).toBe(true);
	});

	it("does not crop HTML pages that only contain inline SVG icons", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const capturePage = vi.fn(async (rect?: unknown) => {
			expect(rect).toBeUndefined();
			return { toPNG: () => Buffer.from("png") };
		});
		const guest = {
			id: 93,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Game",
			once: vi.fn(),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("standalone") || script.includes("viewBox")) {
					// Inline HUD icons are not standalone SVG documents.
					return null;
				}
				return true;
			}),
			capturePage,
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-html", 93, { url: "http://127.0.0.1:3000/", title: "Game" }).ok).toBe(true);

		const screenshot = await controller.handleCommand({ op: "screenshot" });
		expect(screenshot.ok).toBe(true);
		expect(capturePage).toHaveBeenCalledWith();
	});

	it("reloads localhost same-URL navigate ignoring cache, but skips remote same-URL loadURL", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		let currentUrl = "http://127.0.0.1:3000/";
		const loadURL = vi.fn(async (next: string) => {
			currentUrl = next;
		});
		const reloadIgnoringCache = vi.fn(() => {
			queueMicrotask(() => guest.emit("did-finish-load"));
		});
		const guest = Object.assign(new EventEmitter(), {
			id: 94,
			isDestroyed: () => false,
			isLoading: () => false,
			getURL: () => currentUrl,
			getTitle: () => "Local",
			loadURL,
			reloadIgnoringCache,
			setZoomFactor: vi.fn(),
			getZoomFactor: vi.fn(() => 1),
			setVisualZoomLevelLimits: vi.fn(),
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes("metis-browser-fit-viewport")) {
					return {
						fitted: false,
						zoomFactor: 1,
						contentWidth: 400,
						contentHeight: 300,
						viewportWidth: 400,
						viewportHeight: 300,
						reason: "not-media-document",
					};
				}
				if (script.includes("requestAnimationFrame")) return true;
				return null;
			}),
		});
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-local", 94, { url: currentUrl, title: "Local" }).ok).toBe(true);

		const localAgain = await controller.handleCommand({
			op: "navigate",
			url: "http://127.0.0.1:3000/",
		});
		expect(localAgain.ok).toBe(true);
		expect(reloadIgnoringCache).toHaveBeenCalled();
		expect(loadURL).not.toHaveBeenCalled();

		currentUrl = "https://example.com/";
		loadURL.mockClear();
		reloadIgnoringCache.mockClear();
		expect(controller.bindTab("browser-remote", 94, { url: currentUrl, title: "Example" }).ok).toBe(true);
		const remoteAgain = await controller.handleCommand({
			op: "navigate",
			url: "https://example.com/",
		});
		expect(remoteAgain.ok).toBe(true);
		expect(reloadIgnoringCache).not.toHaveBeenCalled();
		expect(loadURL).not.toHaveBeenCalled();
	});

	it("evaluate returns JSON result text without mutating tools", async () => {
		const send = vi.fn();
		const controller = createBrowserHostController({
			token: "tok",
			getMainWindow: () => ({ webContents: { send } }),
		});
		controllers.push(controller);
		await controller.start();

		const guest = {
			id: 95,
			isDestroyed: () => false,
			getURL: () => "http://127.0.0.1:3000/",
			getTitle: () => "Game",
			executeJavaScript: vi.fn(async () => ({
				ok: true,
				resultText: "true",
				url: "http://127.0.0.1:3000/",
				title: "Game",
				pointerLocked: true,
				pointerLockTag: "canvas",
			})),
			once: vi.fn(),
		};
		controller.registerGuest(guest);
		expect(controller.bindTab("browser-eval", 95, { url: "http://127.0.0.1:3000/", title: "Game" }).ok).toBe(true);

		const evaluated = await controller.handleCommand({
			op: "evaluate",
			expression: "Boolean(document.pointerLockElement)",
		});
		expect(evaluated.ok).toBe(true);
		expect(evaluated.result).toBe(true);
		expect(evaluated.pointerLocked).toBe(true);
	});
});
