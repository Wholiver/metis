import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createBrowserHostFromEnv,
	createHttpBrowserHostClient,
	type BrowserHostResult,
} from "../src/core/browser-host.ts";
import { BROWSER_TOOL_NAMES, createBrowserToolDefinitions } from "../src/core/tools/browser.ts";
import { BUILTIN_SKILLS, formatSkillsForPrompt, loadSkills } from "../src/core/skills.ts";
import { DEFAULT_BASE_INSTRUCTIONS, buildInstructionStack, compileInstructionStack } from "../src/core/system-prompt.ts";

describe("metis-browser skill + browser host tools", () => {
	const previousHost = process.env.METIS_BROWSER_HOST;
	const previousToken = process.env.METIS_BROWSER_HOST_TOKEN;

	afterEach(() => {
		if (previousHost === undefined) delete process.env.METIS_BROWSER_HOST;
		else process.env.METIS_BROWSER_HOST = previousHost;
		if (previousToken === undefined) delete process.env.METIS_BROWSER_HOST_TOKEN;
		else process.env.METIS_BROWSER_HOST_TOKEN = previousToken;
	});

	it("ships metis-browser as a builtin skill without polluting base instructions", () => {
		expect(BUILTIN_SKILLS.some((skill) => skill.name === "metis-browser")).toBe(true);
		const loaded = loadSkills({ cwd: process.cwd(), includeBuiltins: true, includeDefaults: false });
		const skill = loaded.skills.find((entry) => entry.name === "metis-browser");
		expect(skill).toBeDefined();
		expect(skill?.filePath).toContain("metis-browser");
		expect(DEFAULT_BASE_INSTRUCTIONS).not.toContain("browser_navigate");
		expect(DEFAULT_BASE_INSTRUCTIONS).not.toContain("metis-browser");
		expect(DEFAULT_BASE_INSTRUCTIONS).not.toContain("browser_snapshot");

		const stack = buildInstructionStack({
			cwd: "/workspace",
			selectedTools: ["read"],
			skills: [skill!],
		});
		const compiled = compileInstructionStack(stack);
		expect(compiled).toContain("metis-browser");
		expect(stack.base.content).not.toContain("Prefer browser_snapshot");
		expect(formatSkillsForPrompt([skill!])).toContain("<name>metis-browser</name>");
	});

	it("createBrowserHostFromEnv only accepts localhost http(s)", () => {
		delete process.env.METIS_BROWSER_HOST;
		expect(createBrowserHostFromEnv()).toBeUndefined();

		process.env.METIS_BROWSER_HOST = "http://example.com:9";
		expect(createBrowserHostFromEnv()).toBeUndefined();

		process.env.METIS_BROWSER_HOST = "http://127.0.0.1:34567";
		process.env.METIS_BROWSER_HOST_TOKEN = "secret";
		expect(createBrowserHostFromEnv()).toBeDefined();
	});

	it("browser tools call host and format snapshot results", async () => {
		const execute = vi.fn(async (): Promise<BrowserHostResult> => ({
			ok: true,
			tabId: "browser-1",
			url: "http://127.0.0.1:3000",
			title: "App",
			snapshot: "nodes:\n[e0] button \"Save\"",
		}));
		const defs = createBrowserToolDefinitions({ host: { execute } });
		expect(defs.map((def) => def.name)).toEqual([...BROWSER_TOOL_NAMES]);
		const snapshot = defs.find((def) => def.name === "browser_snapshot");
		expect(snapshot).toBeDefined();
		const result = await snapshot!.execute!("call-1", { interactive: true }, undefined);
		expect(execute).toHaveBeenCalledWith({ op: "snapshot", interactive: true, tabId: undefined }, undefined);
		expect(result.content.some((part) => part.type === "text" && String(part.text).includes("[e0]"))).toBe(true);
	});

	it("rejects browser_navigate and browser_tabs to reserved Desktop Vite port 5173", async () => {
		const { isReservedPreviewPortUrl, RESERVED_PREVIEW_PORT_REJECTION } = await import(
			"../src/core/tools/browser.ts"
		);
		expect(isReservedPreviewPortUrl("http://127.0.0.1:5173")).toBe(true);
		expect(isReservedPreviewPortUrl("http://localhost:5173/app")).toBe(true);
		expect(isReservedPreviewPortUrl("localhost:5173")).toBe(true);
		expect(isReservedPreviewPortUrl("http://127.0.0.1:4173")).toBe(false);
		expect(isReservedPreviewPortUrl("pelican.svg")).toBe(false);
		expect(isReservedPreviewPortUrl("about:blank")).toBe(false);

		const execute = vi.fn(async (): Promise<BrowserHostResult> => ({
			ok: true,
			url: "http://127.0.0.1:4173/",
			title: "Ok",
		}));
		const defs = createBrowserToolDefinitions({ host: { execute } });
		const navigate = defs.find((def) => def.name === "browser_navigate");
		const tabs = defs.find((def) => def.name === "browser_tabs");
		expect(navigate).toBeDefined();
		expect(tabs).toBeDefined();

		const blocked = await navigate!.execute!("nav-5173", { url: "http://127.0.0.1:5173" }, undefined);
		expect(execute).not.toHaveBeenCalled();
		expect(blocked.content.some((part) => part.type === "text" && String(part.text).includes("5173"))).toBe(
			true,
		);
		expect(blocked.content.some((part) => part.type === "text" && String(part.text).includes("reserved"))).toBe(
			true,
		);
		expect(String((blocked as { details?: { error?: string } }).details?.error || "")).toContain(
			RESERVED_PREVIEW_PORT_REJECTION.slice(0, 20),
		);

		const blockedTab = await tabs!.execute!(
			"tabs-5173",
			{ action: "new", url: "http://localhost:5173/" },
			undefined,
		);
		expect(execute).not.toHaveBeenCalled();
		expect(blockedTab.content.some((part) => part.type === "text" && String(part.text).includes("5173"))).toBe(
			true,
		);

		const allowed = await navigate!.execute!("nav-4173", { url: "http://127.0.0.1:4173" }, undefined);
		expect(execute).toHaveBeenCalledWith(
			{ op: "navigate", url: "http://127.0.0.1:4173", newTab: undefined, tabId: undefined },
			undefined,
		);
		expect(allowed.content.some((part) => part.type === "text" && String(part.text).includes("4173"))).toBe(true);
	});

	it("documents local file preview and forbids system browser fallback in skill text", () => {
		const skill = BUILTIN_SKILLS.find((entry) => entry.name === "metis-browser");
		expect(skill).toBeDefined();
		const body = readFileSync(skill!.filePath, "utf8");
		expect(body).toContain("file://");
		expect(body).toMatch(/open -a Safari|Safari\/Chrome|qlmanage/);
		expect(body).toContain("browser_take_screenshot");
		expect(body).toMatch(/Prefer `browser_take_screenshot`/);
		expect(body).toContain("performance_admit");
		expect(body).toContain("Do not always `browser_navigate` first");
		expect(body).toContain("Viewport sizing");
		expect(body).toMatch(/100vw|100vh/);
		expect(body).toMatch(/hardcode|Inspector panel|design target/i);
		expect(body).toContain("movementX");
		expect(body).toContain("browser_mouse");
		expect(body).toContain("KeyW");
		expect(body).toContain("holdMs");
		expect(body).toContain("browser_evaluate");
		expect(body).toMatch(/reload ignoring cache|ignoring cache/i);
		expect(body).toMatch(/ref not found|stale refs/i);
		expect(body).toMatch(/5173/);
		expect(body).toMatch(/reserved|Desktop Vite/i);
		expect(skill!.description.toLowerCase()).toContain("svg");
		const workflow = readFileSync(join(skill!.baseDir, "references/workflow.md"), "utf8");
		expect(workflow).toContain("browser_snapshot");
		expect(workflow).toContain("require `performance_admit`");
		expect(workflow).toContain("Do not always `browser_navigate` first");
		expect(workflow).toMatch(/hardcode|Inspector panel|fluid viewport/i);
		expect(workflow).toContain("browser_mouse");
		expect(workflow).toContain("sendInputEvent");
		expect(workflow).toContain("pointerLocked");
		expect(workflow).toContain("movementX");
		expect(workflow).toMatch(/5173/);
		expect(workflow).toMatch(/reserved|Desktop/i);
	});

	it("http browser host client posts commands with token", async () => {
		const server = createServer((req, res) => {
			expect(req.method).toBe("POST");
			expect(req.url).toBe("/browser/command");
			expect(req.headers["x-metis-browser-token"]).toBe("tok");
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				expect(JSON.parse(body)).toEqual({ op: "tabs", action: "list" });
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true, tabs: [] }));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("expected tcp address");
		const client = createHttpBrowserHostClient({
			baseUrl: `http://127.0.0.1:${address.port}`,
			token: "tok",
		});
		const result = await client.execute({ op: "tabs", action: "list" });
		expect(result.ok).toBe(true);
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
});
