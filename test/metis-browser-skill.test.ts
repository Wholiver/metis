import { createServer } from "node:http";
import { readFileSync } from "node:fs";
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

	it("documents local file preview and forbids system browser fallback in skill text", () => {
		const skill = BUILTIN_SKILLS.find((entry) => entry.name === "metis-browser");
		expect(skill).toBeDefined();
		const body = readFileSync(skill!.filePath, "utf8");
		expect(body).toContain("file://");
		expect(body).toMatch(/open -a Safari|Safari\/Chrome|qlmanage/);
		expect(body).toContain("browser_take_screenshot");
		expect(body).toMatch(/Prefer `browser_take_screenshot`/);
		expect(skill!.description.toLowerCase()).toContain("svg");
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
