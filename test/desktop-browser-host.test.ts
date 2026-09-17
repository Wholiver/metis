import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { createBrowserHostController, isHttpUrl, resolveNavigateUrl } = require("../desktop/browser-host.cjs") as {
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
				if (script.includes("getBoundingClientRect")) {
					return {
						url: "http://127.0.0.1:3000/",
						title: "Demo",
						nodes: [{ ref: "e0", tag: "button", name: "Save" }],
					};
				}
				if (script.includes(".click()")) {
					return { ok: true, url: "http://127.0.0.1:3000/", title: "Demo" };
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
	});
});
