import { afterEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { startServerMode } from "../src/modes/server/server-mode.ts";
import type { ServerHandle } from "../src/modes/server/server-types.ts";
import { getBuiltinHarness } from "../src/core/builtin-harness.ts";

function createRuntimeFixture(cwd: string) {
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
		workflowPlan: { plan: [], updatedAt: new Date().toISOString() },
		instructionSources: [],
		instructionDiagnostics: [],
		sessionFile: path.join(cwd, "session.jsonl"),
		sessionId: "session-test",
		sessionName: "Harness test",
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		pendingMessageCount: 0,
		steeringMessages: [],
		followUpMessages: [],
		messages: [],
		sessionManager: {
			getCwd: vi.fn(() => cwd),
			getSessionDir: vi.fn(() => path.join(cwd, "sessions")),
			usesDefaultSessionDir: vi.fn(() => true),
			getEntries: vi.fn(() => []),
			getBranch: vi.fn(() => []),
			getLeafId: vi.fn(() => "leaf"),
			getTree: vi.fn(() => []),
		},
		bindExtensions: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
		settingsManager: {
			getUiLanguage: vi.fn(() => "en"),
			getDefaultProvider: vi.fn(() => "test"),
			getDefaultModel: vi.fn(() => "model-1"),
			getDefaultThinkingLevel: vi.fn(() => "medium"),
		},
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
	};

	let rebindSession: (() => Promise<void>) | undefined;
	const runtime = {
		session,
		cwd,
		setRebindSession: vi.fn((hook: () => Promise<void>) => {
			rebindSession = hook;
		}),
		dispose: vi.fn(async () => {}),
		services: {
			agentDir: path.join(cwd, ".metis", "agent"),
			cwd,
		},
	} as unknown as AgentSessionRuntime;

	return { runtime, cwd };
}

describe("Server Harness endpoints", () => {
	const handles: ServerHandle[] = [];
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const handle of handles) {
			await handle.close();
		}
		handles.length = 0;
		for (const dir of tempDirs) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		tempDirs.length = 0;
	});

	test("GET /harness/seed returns built-in harness document", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-harness-"));
		tempDirs.push(tempDir);
		const { runtime } = createRuntimeFixture(tempDir);

		const handle = await startServerMode(runtime, { host: "127.0.0.1", port: 0, quiet: true });
		handles.push(handle);

		const response = await fetch(`http://127.0.0.1:${handle.address.port}/harness/seed`);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.harness).toBeDefined();
		expect(data.harness.version).toBe(1);
		expect(data.harness.nodes.length).toBeGreaterThan(50);
		expect(data.harness.edges.length).toBeGreaterThan(100);
	});

	test("GET /harness returns exists: false when .metis/harness.json is missing", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-harness-"));
		tempDirs.push(tempDir);
		const { runtime } = createRuntimeFixture(tempDir);

		const handle = await startServerMode(runtime, { host: "127.0.0.1", port: 0, quiet: true });
		handles.push(handle);

		const response = await fetch(`http://127.0.0.1:${handle.address.port}/harness?cwd=${encodeURIComponent(tempDir)}`);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.exists).toBe(false);
		expect(data.harness).toBeDefined();
		expect(data.harness.version).toBe(1);
	});

	test("PUT /harness writes valid document and GET /harness returns exists: true", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-harness-"));
		tempDirs.push(tempDir);
		const { runtime } = createRuntimeFixture(tempDir);

		const handle = await startServerMode(runtime, { host: "127.0.0.1", port: 0, quiet: true });
		handles.push(handle);

		const builtin = getBuiltinHarness();
		// Modify gate G6 with declarative checks
		const customDoc = {
			...builtin,
			nodes: builtin.nodes.map((n) =>
				n.id === "G6"
					? {
							...n,
							data: {
								...n.data,
								checks: [{ command: "npm test", expectExit: 0 }],
								rubric: "Strict test pass required",
							},
						}
					: n,
			),
		};

		const putRes = await fetch(`http://127.0.0.1:${handle.address.port}/harness`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: tempDir, harness: customDoc }),
		});
		expect(putRes.status).toBe(200);
		const putData = await putRes.json();
		expect(putData.success).toBe(true);

		const filePath = path.join(tempDir, ".metis", "harness.json");
		expect(fs.existsSync(filePath)).toBe(true);

		const getRes = await fetch(`http://127.0.0.1:${handle.address.port}/harness?cwd=${encodeURIComponent(tempDir)}`);
		expect(getRes.status).toBe(200);
		const getData = await getRes.json();
		expect(getData.exists).toBe(true);
		expect(getData.valid).toBe(true);
		const g6Node = getData.harness.nodes.find((n: any) => n.id === "G6");
		expect(g6Node.data.checks).toEqual([{ command: "npm test", expectExit: 0 }]);
	});

	test("PUT /harness rejects invalid document with 400", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-harness-"));
		tempDirs.push(tempDir);
		const { runtime } = createRuntimeFixture(tempDir);

		const handle = await startServerMode(runtime, { host: "127.0.0.1", port: 0, quiet: true });
		handles.push(handle);

		// Invalid: missing nodes array
		const invalidDoc = { version: 1, edges: [] };

		const putRes = await fetch(`http://127.0.0.1:${handle.address.port}/harness`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: tempDir, harness: invalidDoc }),
		});
		expect(putRes.status).toBe(400);
		const putData = await putRes.json();
		expect(putData.error.code).toBe("invalid_harness");
	});

	test("DELETE /harness removes .metis/harness.json", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-harness-"));
		tempDirs.push(tempDir);
		const { runtime } = createRuntimeFixture(tempDir);

		const handle = await startServerMode(runtime, { host: "127.0.0.1", port: 0, quiet: true });
		handles.push(handle);

		const filePath = path.join(tempDir, ".metis", "harness.json");
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify(getBuiltinHarness(), null, 2), "utf8");
		expect(fs.existsSync(filePath)).toBe(true);

		const delRes = await fetch(`http://127.0.0.1:${handle.address.port}/harness?cwd=${encodeURIComponent(tempDir)}`, {
			method: "DELETE",
		});
		expect(delRes.status).toBe(200);
		const delData = await delRes.json();
		expect(delData.success).toBe(true);
		expect(delData.deleted).toBe(true);
		expect(fs.existsSync(filePath)).toBe(false);

		const getRes = await fetch(`http://127.0.0.1:${handle.address.port}/harness?cwd=${encodeURIComponent(tempDir)}`);
		const getData = await getRes.json();
		expect(getData.exists).toBe(false);
	});
});
