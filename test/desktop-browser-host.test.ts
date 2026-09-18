import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { createBrowserHostController, isHttpUrl, resolveNavigateUrl, computeSvgContentRect } = require("../desktop/browser-host.cjs") as {
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
			executeJavaScript: vi.fn(async (script: string) => {
				if (script.includes(".click()")) {
					return { ok: true, url: "http://127.0.0.1:3000/", title: "Demo" };
				}
				if (script.includes("interactiveOnly")) {
					return {
						url: "http://127.0.0.1:3000/",
						title: "Demo",
						nodes: [{ ref: "e0", tag: "button", name: "Save" }],
					};
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

		const click = await controller.handleCommand({ op: "click", ref: "e0" });
		expect(click.ok).toBe(true);

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

	it("locks Inspector webview zoom in the browser panel", () => {
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const { resolve } = require("node:path") as typeof import("node:path");
		const panel = readFileSync(
			resolve(process.cwd(), "desktop/src/components/inspector/InspectorBrowserPanel.tsx"),
			"utf8",
		);
		expect(panel).toContain("setVisualZoomLevelLimits?.(1, 1)");
		expect(panel).toContain('data-browser-viewport=""');
		expect(panel).toContain("loadURL('about:blank')");
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
			expect(guest.loadURL).toHaveBeenCalledWith("about:blank");
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
			expect(guest.loadURL.mock.calls.length).toBeGreaterThanOrEqual(3);
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
				if (script.includes("viewBox")) {
					return { x: 0, y: 0, width: 1700, height: 1736, viewBox: { width: 1200, height: 800 } };
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
});
