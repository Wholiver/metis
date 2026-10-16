import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { startServerMode } from "../src/modes/server/server-mode.ts";
import type { ServerHandle } from "../src/modes/server/server-types.ts";

function createRuntimeFixture(cwd: string) {
	const listeners = new Set<(event: object) => void>();
	const model = { provider: "test", id: "model-1", name: "Test Model" };
	const session = {
		model,
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		collaborationMode: "build",
		contextWindowId: "window-1",
		workflowPlan: { plan: [{ step: "Inspect", status: "in_progress" }], updatedAt: "2026-07-26T16:00:00.000Z" },
		instructionSources: [],
		instructionDiagnostics: [],
		sessionFile: path.join(cwd, "session.jsonl"),
		sessionId: "session-1",
		sessionName: "Server web test",
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		pendingMessageCount: 0,
		steeringMessages: [],
		followUpMessages: [],
		getRunningSubagentIds: vi.fn(() => []),
		messages: [{ role: "user", content: "hello" }],
		agent: { waitForIdle: vi.fn(async () => {}) },
		modelRegistry: {
			getAvailable: vi.fn(async () => [model]),
			getAll: vi.fn(() => [model]),
			refresh: vi.fn(),
			authStorage: {
				getOAuthProviders: vi.fn(() => []),
				list: vi.fn(() => ["test"]),
				set: vi.fn(),
				logout: vi.fn(),
			},
		},
		extensionRunner: { getRegisteredCommands: vi.fn(() => []) },
		sessionManager: {
			getCwd: vi.fn(() => cwd),
			getSessionDir: vi.fn(() => path.join(cwd, ".metis", "sessions")),
			usesDefaultSessionDir: vi.fn(() => false),
			getEntries: vi.fn(() => []),
			getBranch: vi.fn(() => []),
			getLeafId: vi.fn(() => "entry-1"),
			getTree: vi.fn(() => []),
		},
		settingsManager: {
			getDefaultProvider: vi.fn(() => "test"),
			getDefaultModel: vi.fn(() => "model-1"),
			getDefaultThinkingLevel: vi.fn(() => "medium"),
			getSettings: vi.fn(() => ({})),
		},
		bindExtensions: vi.fn(async () => {}),
		subscribe: vi.fn((listener: (event: object) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		prompt: vi.fn(async () => {}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		getSteeringMessages: vi.fn(() => []),
		getFollowUpMessages: vi.fn(() => []),
		removeQueuedMessage: vi.fn(),
		promoteFollowUpMessage: vi.fn(),
		abort: vi.fn(async () => {}),
		abortSubagent: vi.fn(() => true),
		abortSubagents: vi.fn(),
		compact: vi.fn(async () => ({ summary: "done" })),
		setModel: vi.fn(async () => {}),
		getAvailableThinkingLevels: vi.fn(() => ["off", "medium"]),
		supportsThinking: vi.fn(() => true),
		setThinkingLevel: vi.fn(),
		setCollaborationMode: vi.fn(),
		setAutoCompactionEnabled: vi.fn(),
		setAutoRetryEnabled: vi.fn(),
		exportToJsonl: vi.fn(async () => "[]"),
		appendUserMessage: vi.fn(async () => {}),
		restoreSessionState: vi.fn(async () => {}),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
	};

	return {
		cwd,
		session,
		setRebindSession: vi.fn(),
		newSession: vi.fn(async () => ({ cancelled: false })),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		fork: vi.fn(async () => ({ cancelled: false, selectedText: undefined })),
		importFromJsonl: vi.fn(async () => ({ cancelled: false })),
		dispose: vi.fn(async () => {}),
	} as unknown as AgentSessionRuntime;
}

describe("Server Mode Web & Workspace APIs", () => {
	let handle: ServerHandle | undefined;
	let tempDir: string | undefined;

	afterEach(async () => {
		if (handle) {
			await handle.close();
			handle = undefined;
		}
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	test("starts web server on webPort and sets webAddress", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			webPort: 0,
		});

		expect(handle.address.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(handle.webAddress).toBeDefined();
		expect(handle.webAddress?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(handle.webAddress?.url).not.toBe(handle.address.url);
	});

	test("disables web server when noWeb is true", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			noWeb: true,
		});

		expect(handle.address).toBeDefined();
		expect(handle.webAddress).toBeUndefined();
	});

	test("web server serves index.html and falls back for SPA routing", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			webPort: 0,
		});

		const res = await fetch(`${handle.webAddress?.url}/`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html.toLowerCase()).toContain("<!doctype html>");
		expect(html).toContain("Metis");

		// SPA route fallback
		const spaRes = await fetch(`${handle.webAddress?.url}/conversation/some-id`);
		expect(spaRes.status).toBe(200);
		const spaHtml = await spaRes.text();
		expect(spaHtml).toBe(html);
	});

	test("web server reverse proxies API endpoints to api server", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			webPort: 0,
		});

		// Fetch /session through the web server port
		const res = await fetch(`${handle.webAddress?.url}/session`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveProperty("sessionId", "session-1");
		expect(data).toHaveProperty("model");
		expect(data.model.id).toBe("model-1");
	});

	test("workspace/summary returns project info", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		fs.writeFileSync(path.join(tempDir, "README.md"), "# Hello Metis\n");
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			webPort: 0,
		});

		const res = await fetch(`${handle.address.url}/workspace/summary`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveProperty("path", tempDir);
		expect(data).toHaveProperty("name", path.basename(tempDir));
		expect(data).toHaveProperty("isGitRepo");
	});

	test("workspace/validate checks paths accurately", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const subDir = path.join(tempDir, "valid-sub");
		fs.mkdirSync(subDir);
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			noWeb: true,
		});

		// Valid path
		const validRes = await fetch(`${handle.address.url}/workspace/validate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: subDir }),
		});
		expect(validRes.status).toBe(200);
		const validData = await validRes.json();
		expect(validData.valid).toBe(true);
		expect(validData.resolved).toBe(subDir);
		expect(validData.name).toBe("valid-sub");

		// Non-existent path
		const invalidRes = await fetch(`${handle.address.url}/workspace/validate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: path.join(tempDir, "does-not-exist") }),
		});
		expect(invalidRes.status).toBe(200);
		const invalidData = await invalidRes.json();
		expect(invalidData.valid).toBe(false);
		expect(invalidData.error).toBeDefined();
	});

	test("workspace/tree lists files and directories", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		fs.writeFileSync(path.join(tempDir, "root.txt"), "root file");
		const subDir = path.join(tempDir, "src");
		fs.mkdirSync(subDir);
		fs.writeFileSync(path.join(subDir, "main.ts"), "console.log('hi');");

		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			noWeb: true,
		});

		const res = await fetch(`${handle.address.url}/workspace/tree?path=${encodeURIComponent(tempDir)}`);
		expect(res.status).toBe(200);
		const tree = await res.json();
		expect(tree).toHaveProperty("nodes");
		expect(Array.isArray(tree.nodes)).toBe(true);

		const names = tree.nodes.map((e: { name: string }) => e.name);
		expect(names).toContain("root.txt");
		expect(names).toContain("src");

		const srcEntry = tree.nodes.find((e: { name: string }) => e.name === "src");
		expect(srcEntry.type).toBe("directory");
		expect(srcEntry.children.some((c: { name: string }) => c.name === "main.ts")).toBe(true);
	});

	test("workspace/file reads file content and guards path traversal", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const testFile = path.join(tempDir, "sample.txt");
		fs.writeFileSync(testFile, "Hello World from Metis Workspace");

		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			noWeb: true,
		});

		// Read valid file
		const res = await fetch(`${handle.address.url}/workspace/file?path=${encodeURIComponent(testFile)}&root=${encodeURIComponent(tempDir)}`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.content).toBe("Hello World from Metis Workspace");
		expect(data.size).toBe(32);

		// Path traversal attempt should return 400
		const escapePath = path.resolve(tempDir, "../../../etc/passwd");
		const traversalRes = await fetch(`${handle.address.url}/workspace/file?path=${encodeURIComponent(escapePath)}&root=${encodeURIComponent(tempDir)}`);
		expect(traversalRes.status).toBe(400);

		// Missing file
		const missingRes = await fetch(`${handle.address.url}/workspace/file?path=${encodeURIComponent(path.join(tempDir, "none.txt"))}&root=${encodeURIComponent(tempDir)}`);
		expect(missingRes.status).toBe(404);
	});

	test("workspace/git-* endpoints return git status without throwing", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			noWeb: true,
		});

		// git-info on non-git dir returns fallback
		const infoRes = await fetch(`${handle.address.url}/workspace/git-info?path=${encodeURIComponent(tempDir)}`);
		expect(infoRes.status).toBe(200);
		const info = await infoRes.json();
		expect(info.isRepo).toBe(false);

		// git-status
		const statusRes = await fetch(`${handle.address.url}/workspace/git-status?path=${encodeURIComponent(tempDir)}`);
		expect(statusRes.status).toBe(200);
		const status = await statusRes.json();
		expect(Array.isArray(status.files)).toBe(true);

		// git-diff
		const diffRes = await fetch(`${handle.address.url}/workspace/git-diff?path=${encodeURIComponent(tempDir)}`);
		expect(diffRes.status).toBe(200);
		const diff = await diffRes.json();
		expect(diff.diff).toBe("");
	});

	test("web server protects against path traversal and handles malformed URLs", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			webPort: 0,
		});

		// Path traversal attempt on static web server should return 403
		const traversalRes = await fetch(`${handle.webAddress?.url}/....//....//etc/passwd`);
		expect([403, 404]).toContain(traversalRes.status);

		// Malformed URI should return 400
		const malformedRes = await fetch(`${handle.webAddress?.url}/%c0%ae%c0%ae`);
		expect(malformedRes.status).toBe(400);
	});

	test("web server supports /events SSE alias and proxies settings/commands", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			webPort: 0,
		});

		// /events should connect to SSE
		const eventRes = await fetch(`${handle.address.url}/events`);
		expect(eventRes.status).toBe(200);
		expect(eventRes.headers.get("content-type")).toContain("text/event-stream");
		eventRes.body?.cancel();

		// /commands should be proxied through web port
		const commandsRes = await fetch(`${handle.webAddress?.url}/commands`);
		expect(commandsRes.status).toBe(200);
		const commandsData = await commandsRes.json();
		expect(commandsData).toHaveProperty("commands");

		// /settings/defaults should be proxied through web port
		const settingsRes = await fetch(`${handle.webAddress?.url}/settings/defaults`);
		expect(settingsRes.status).toBe(200);
	});

	test("workspace/file protects against symlink escape", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-web-test-"));
		const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-ext-test-"));
		const secretFile = path.join(externalDir, "secret.txt");
		fs.writeFileSync(secretFile, "top-secret-content");

		// Create a symlink inside tempDir pointing to secretFile outside
		const symlinkPath = path.join(tempDir, "link-to-secret.txt");
		try {
			fs.symlinkSync(secretFile, symlinkPath);
		} catch {
			// If symlink creation fails (e.g. unprivileged on Windows), skip this check
			return;
		}

		const runtime = createRuntimeFixture(tempDir);
		handle = await startServerMode(runtime, {
			host: "127.0.0.1",
			port: 0,
			noWeb: true,
		});

		const res = await fetch(`${handle.address.url}/workspace/file?path=link-to-secret.txt&cwd=${encodeURIComponent(tempDir)}`);
		expect(res.status).toBe(400);

		fs.rmSync(externalDir, { recursive: true, force: true });
	});
});
