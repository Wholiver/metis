import { afterEach, describe, expect, test, vi } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { startServerMode } from "../src/modes/server/server-mode.ts";
import type { ServerHandle } from "../src/modes/server/server-types.ts";

function createRuntimeFixture() {
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
		instructionSources: [{ id: "base", channel: "base", source: "metis", trust: "builtin", byteCount: 12, truncated: false }],
		instructionDiagnostics: [],
		sessionFile: "/tmp/session.jsonl",
		sessionId: "session-1",
		sessionName: "Server test",
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		memoryState: { enabled: true, recordCount: 1, pendingJobs: 0 },
		get pendingMessageCount() {
			return session.steeringMessages.length + session.followUpMessages.length;
		},
		steeringMessages: ["steer queued"],
		followUpMessages: ["follow-up queued"],
		getRunningSubagentIds: vi.fn(() => ["job-1"]),
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
		extensionRunner: { getRegisteredCommands: vi.fn(() => [{ name: "dream", description: "Dream mode" }]) },
		sessionManager: {
			getCwd: vi.fn(() => "/tmp"),
			getSessionDir: vi.fn(() => "/tmp/metis-server-test-sessions"),
			usesDefaultSessionDir: vi.fn(() => false),
			getEntries: vi.fn(() => [{ id: "entry-1", type: "message" }]),
			getBranch: vi.fn(() => [{
				id: "entry-1",
				type: "message",
				timestamp: "2026-07-26T16:00:05.000Z",
				message: { role: "assistant", timestamp: 1785081600000, content: [] },
			}]),
			getLeafId: vi.fn(() => "entry-1"),
			getTree: vi.fn(() => [{ id: "entry-1", children: [] }]),
		},
		bindExtensions: vi.fn(async () => {}),
		subscribe: vi.fn((listener: (event: object) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		prompt: vi.fn(async (_message: string, options: { images?: unknown[]; preflightResult?: (ok: boolean) => void }) => {
			options.preflightResult?.(true);
		}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		getSteeringMessages: vi.fn(() => session.steeringMessages),
		getFollowUpMessages: vi.fn(() => session.followUpMessages),
		removeQueuedMessage: vi.fn((queue: "steering" | "followUp", index: number) => {
			const messages = queue === "steering" ? session.steeringMessages : session.followUpMessages;
			const [text] = messages.splice(index, 1);
			if (!text) throw new Error("queue item not found");
			return { text, timestamp: Date.now() };
		}),
		promoteFollowUpMessage: vi.fn((index: number) => {
			const [text] = session.followUpMessages.splice(index, 1);
			if (!text) throw new Error("queue item not found");
			session.steeringMessages.push(text);
			return { text, timestamp: Date.now() };
		}),
		abort: vi.fn(async () => {}),
		compact: vi.fn(async () => ({ summary: "done" })),
		setModel: vi.fn(async () => {}),
		getAvailableThinkingLevels: vi.fn(() => ["off", "low", "medium", "high"]),
		supportsThinking: vi.fn(() => true),
		setThinkingLevel: vi.fn(),
		setCollaborationMode: vi.fn((mode: "build" | "plan") => {
			session.collaborationMode = mode;
		}),
		setAutoCompactionEnabled: vi.fn((enabled: boolean) => {
			session.autoCompactionEnabled = enabled;
		}),
		setAutoRetryEnabled: vi.fn((enabled: boolean) => {
			session.autoRetryEnabled = enabled;
		}),
		settingsManager: {
			getUiLanguage: vi.fn(() => "en"),
			setUiLanguage: vi.fn(),
			getDefaultProvider: vi.fn(() => undefined),
			getDefaultModel: vi.fn(() => undefined),
			getDefaultThinkingLevel: vi.fn(() => undefined),
			setDefaultModelAndProvider: vi.fn(),
			clearDefaultModelAndProvider: vi.fn(),
			setDefaultThinkingLevel: vi.fn(),
			clearDefaultThinkingLevel: vi.fn(),
		},
		setSteeringMode: vi.fn((mode: "all" | "one-at-a-time") => {
			session.steeringMode = mode;
		}),
		setFollowUpMode: vi.fn((mode: "all" | "one-at-a-time") => {
			session.followUpMode = mode;
		}),
		setMemoryEnabled: vi.fn((enabled: boolean) => ({ ...session.memoryState, enabled })),
		runMemory: vi.fn(async () => ({ ...session.memoryState, lastRunProcessed: 1 })),
		searchMemory: vi.fn((query: string) => query ? [{ id: "memory-1", content: `match:${query}` }] : []),
		forgetMemory: vi.fn((id: string) => id === "memory-1"),
		resetMemory: vi.fn((confirmation: string) => {
			if (confirmation !== "RESET_MEMORY") throw new Error("confirmation required");
		}),
		setSessionName: vi.fn(),
		syncModelFromRegistry: vi.fn(),
		exportToHtml: vi.fn(async (filePath?: string) => filePath || "/tmp/session.html"),
		exportToJsonl: vi.fn(async (filePath?: string) => filePath || "/tmp/session.jsonl"),
		ensureSessionName: vi.fn(async () => undefined),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
	};
	// The real AgentSessionRuntime invokes the rebindSession hook exactly once per session
	// replacement, from finishSessionReplacement(). Model that here: server-mode relies on it
	// instead of re-binding from each route, so a stub that swallowed the hook would let a
	// missing bind (and its server.session_changed broadcast) pass unnoticed.
	let rebindSession: (() => Promise<void>) | undefined;
	const replaceSession = async () => {
		await rebindSession?.();
	};
	const runtime = {
		cwd: "/tmp",
		session,
		setRebindSession: vi.fn((hook: () => Promise<void>) => {
			rebindSession = hook;
		}),
		newSession: vi.fn(async () => {
			await replaceSession();
			return { cancelled: false };
		}),
		switchSession: vi.fn(async () => {
			await replaceSession();
			return { cancelled: false };
		}),
		fork: vi.fn(async () => {
			await replaceSession();
			return { cancelled: false, selectedText: undefined };
		}),
		importFromJsonl: vi.fn(async () => ({ cancelled: false })),
		dispose: vi.fn(async () => {}),
	};
	const createSiblingRuntime = (sessionId: string, sessionFile: string) => {
		const siblingSession = {
			...session,
			sessionId,
			sessionFile,
			isStreaming: false,
			isCompacting: false,
			messages: [],
		};
		return {
			cwd: "/tmp",
			session: siblingSession,
			setRebindSession: vi.fn(),
			newSession: vi.fn(async () => ({ cancelled: false })),
			switchSession: vi.fn(async () => ({ cancelled: false })),
			fork: vi.fn(async () => ({ cancelled: false, selectedText: undefined })),
			importFromJsonl: vi.fn(async () => ({ cancelled: false })),
			dispose: vi.fn(async () => {}),
		};
	};
	const switchedSibling = createSiblingRuntime("session-2", "/tmp/other.jsonl");
	const newSibling = createSiblingRuntime("session-3", "/tmp/new.jsonl");
	Object.assign(runtime, {
		createSiblingForSession: vi.fn(async () => switchedSibling),
		createSiblingNewSession: vi.fn(async () => newSibling),
	});
	return {
		runtime: runtime as unknown as AgentSessionRuntime,
		session,
		switchedSibling,
		newSibling,
		emit: (event: object) => {
			for (const listener of listeners) listener(event);
		},
	};
}

describe("server CLI arguments", () => {
	test("recognizes server command and transport options", () => {
		const args = parseArgs([
			"server",
			"--hostname",
			"localhost",
			"--port",
			"4123",
			"--cors",
			"http://localhost:5173",
		]);
		expect(args.mode).toBe("server");
		expect(args.hostname).toBe("localhost");
		expect(args.port).toBe(4123);
		expect(args.cors).toEqual(["http://localhost:5173"]);
		expect(args.messages).toEqual([]);
	});

	test("rejects invalid port", () => {
		const args = parseArgs(["server", "--port", "70000"]);
		expect(args.diagnostics).toEqual([{ type: "error", message: "Invalid port: 70000" }]);
	});
});

describe("server mode", () => {
	let handle: ServerHandle | undefined;

	afterEach(async () => {
		await handle?.close();
		handle = undefined;
	});

	test("serves health, OpenAPI, state, prompt, and abort routes", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, { port: 0 });

		const health = await fetch(`${handle.address.url}/global/health`).then((response) => response.json());
		expect(health).toMatchObject({ healthy: true });

		const spec = (await fetch(`${handle.address.url}/openapi.json`).then((response) => response.json())) as {
			openapi: string;
			paths: Record<string, unknown>;
		};
		expect(spec.openapi).toBe("3.1.0");
		expect(spec.paths).toHaveProperty("/event");
		expect(spec.paths).toHaveProperty("/session/prompt");
		expect(spec.paths).toHaveProperty("/sessions");
		expect(spec.paths).toHaveProperty("/desktop/work-stats");
		expect(spec.paths).toHaveProperty("/session/queue");
		expect(spec.paths).toHaveProperty("/session/queue/promote");
		expect(spec.paths).toHaveProperty("/session/settings");
		expect(spec.paths).toHaveProperty("/commands");
		expect(spec.paths).toHaveProperty("/session/command");
		expect(spec.paths).toHaveProperty("/session/user-input/{requestId}");
		expect(spec.paths).toHaveProperty("/config/providers");
		expect(spec.paths).toHaveProperty("/session/model");

		const expiredInput = await fetch(`${handle.address.url}/session/user-input/missing`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cancelled: true, answers: [] }),
		});
		expect(expiredInput.status).toBe(404);

		const workStats = (await fetch(`${handle.address.url}/desktop/work-stats`).then((response) => response.json())) as {
			rangeStart: string;
			rangeEnd: string;
			days: unknown[];
		};
		expect(workStats.rangeStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(workStats.rangeEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(workStats.days).toEqual([]);

		const commandData = (await fetch(`${handle.address.url}/commands`).then((response) => response.json())) as {
			commands: Array<{ name: string; source: string }>;
		};
		expect(commandData.commands.filter((command) => command.source === "builtin")).toHaveLength(27);
		expect(commandData.commands.map((command) => command.name)).not.toContain("performance");
		expect(commandData.commands.map((command) => command.name)).toEqual(expect.arrayContaining(["settings", "model", "compact", "memory", "quit", "agents"]));

		const settingsCommandResponse = await fetch(`${handle.address.url}/session/command`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "/settings" }),
		});
		expect(settingsCommandResponse.status).toBe(200);
		expect(await settingsCommandResponse.json()).toMatchObject({ command: "settings", action: "open-panel", panel: "agent" });

		const state = (await fetch(`${handle.address.url}/session`).then((response) => response.json())) as {
			cwd: string;
			sessionId: string;
			thinkingLevels: string[];
			supportsThinking: boolean;
			followUpMessages: string[];
			runningSubagentIds: string[];
			collaborationMode: string;
			contextWindowId: string;
			autoRetryEnabled: boolean;
		};
		expect(state.sessionId).toBe("session-1");
		expect(state.cwd).toBe("/tmp");
		expect(state.thinkingLevels).toEqual(["off", "low", "medium", "high"]);
		expect(state.supportsThinking).toBe(true);
		expect(state.followUpMessages).toEqual(["follow-up queued"]);
		expect(state.runningSubagentIds).toEqual(["job-1"]);
		expect(state.collaborationMode).toBe("build");
		expect(state.contextWindowId).toBe("window-1");
		expect(state.autoRetryEnabled).toBe(true);

		const providerModels = await fetch(`${handle.address.url}/config/providers`).then((response) => response.json());
		expect(providerModels).toEqual({
			models: [{ provider: "test", id: "model-1", name: "Test Model", thinkingLevels: ["off"] }],
		});

		const modelResponse = await fetch(`${handle.address.url}/session/model`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: "test", modelId: "model-1" }),
		});
		expect(modelResponse.status).toBe(200);
		expect(await modelResponse.json()).toEqual({ provider: "test", id: "model-1", name: "Test Model" });
		expect(fixture.session.setModel).toHaveBeenCalledWith(fixture.session.model);

		const initialDefaultsResponse = await fetch(`${handle.address.url}/settings/defaults`);
		expect(initialDefaultsResponse.status).toBe(200);
		expect(await initialDefaultsResponse.json()).toEqual({});

		const messageData = (await fetch(`${handle.address.url}/session/messages`).then((response) => response.json())) as {
			serverInstanceId: string;
			serverSequence: number;
			messageTimings: Array<{ messageTimestamp: number; completedAt: number }>;
		};
		expect(messageData.serverInstanceId).toBeTypeOf("string");
		expect(messageData.serverSequence).toBeGreaterThan(0);
		expect(messageData.messageTimings).toEqual([{
			messageTimestamp: 1785081600000,
			completedAt: Date.parse("2026-07-26T16:00:05.000Z"),
		}]);

		const promoteResponse = await fetch(`${handle.address.url}/session/queue/promote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ index: 0 }),
		});
		expect(promoteResponse.status).toBe(200);
		expect(fixture.session.promoteFollowUpMessage).toHaveBeenCalledWith(0);
		expect(await promoteResponse.json()).toMatchObject({
			message: { text: "follow-up queued" },
			pendingMessageCount: 2,
			steeringMessages: ["steer queued", "follow-up queued"],
			followUpMessages: [],
		});

		const removeResponse = await fetch(`${handle.address.url}/session/queue`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ queue: "steering", index: 1 }),
		});
		expect(removeResponse.status).toBe(200);
		expect(await removeResponse.json()).toMatchObject({
			message: { text: "follow-up queued" },
			pendingMessageCount: 1,
			steeringMessages: ["steer queued"],
			followUpMessages: [],
		});

		const thinkingResponse = await fetch(`${handle.address.url}/session/thinking`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ level: "high" }),
		});
		expect(thinkingResponse.status).toBe(200);
		expect(fixture.session.setThinkingLevel).toHaveBeenCalledWith("high");

		const unsupportedThinkingResponse = await fetch(`${handle.address.url}/session/thinking`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ level: "xhigh" }),
		});
		expect(unsupportedThinkingResponse.status).toBe(400);

		const workflowResponse = await fetch(`${handle.address.url}/session/collaboration-mode`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode: "plan" }),
		});
		expect(workflowResponse.status).toBe(200);
		expect(fixture.session.setCollaborationMode).toHaveBeenCalledWith("plan");

		fixture.session.isStreaming = true;
		const busyWorkflowResponse = await fetch(`${handle.address.url}/session/collaboration-mode`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode: "build" }),
		});
		expect(busyWorkflowResponse.status).toBe(409);
		fixture.session.isStreaming = false;

		const settingsResponse = await fetch(`${handle.address.url}/session/settings`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				autoCompactionEnabled: false,
				autoRetryEnabled: false,
				steeringMode: "one-at-a-time",
				followUpMode: "one-at-a-time",
			}),
		});
		expect(settingsResponse.status).toBe(200);
		expect(fixture.session.setAutoCompactionEnabled).toHaveBeenCalledWith(false);
		expect(fixture.session.setAutoRetryEnabled).toHaveBeenCalledWith(false);
		expect(fixture.session.setSteeringMode).toHaveBeenCalledWith("one-at-a-time");
		expect(fixture.session.setFollowUpMode).toHaveBeenCalledWith("one-at-a-time");
		expect(await settingsResponse.json()).toMatchObject({
			autoCompactionEnabled: false,
			autoRetryEnabled: false,
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
		});

		const defaultsResponse = await fetch(`${handle.address.url}/settings/defaults`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: "test", modelId: "model-1", thinkingLevel: "low" }),
		});
		expect(defaultsResponse.status).toBe(200);
		expect(fixture.session.settingsManager.setDefaultModelAndProvider).toHaveBeenCalledWith("test", "model-1");
		expect(fixture.session.settingsManager.setDefaultThinkingLevel).toHaveBeenCalledWith("low");

		const clearDefaultsResponse = await fetch(`${handle.address.url}/settings/defaults`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: null, modelId: null, thinkingLevel: null }),
		});
		expect(clearDefaultsResponse.status).toBe(200);
		expect(fixture.session.settingsManager.clearDefaultModelAndProvider).toHaveBeenCalledOnce();
		expect(fixture.session.settingsManager.clearDefaultThinkingLevel).toHaveBeenCalledOnce();

		const invalidDefaultsResponse = await fetch(`${handle.address.url}/settings/defaults`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: "test" }),
		});
		expect(invalidDefaultsResponse.status).toBe(400);

		const invalidSettingsResponse = await fetch(`${handle.address.url}/session/settings`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ steeringMode: "invalid" }),
		});
		expect(invalidSettingsResponse.status).toBe(400);

		const promptResponse = await fetch(`${handle.address.url}/session/prompt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "do work" }),
		});
		expect(promptResponse.status).toBe(202);
		expect(fixture.session.prompt).toHaveBeenCalledWith("do work", expect.objectContaining({ source: "rpc" }));

		const processResponse = await fetch(`${handle.address.url}/session/prompt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "process it", workflowAction: "process_proposal" }),
		});
		expect(processResponse.status).toBe(202);
		expect(fixture.session.prompt).toHaveBeenLastCalledWith("process it", expect.objectContaining({ workflowAction: "process_proposal" }));

		const invalidProcessResponse = await fetch(`${handle.address.url}/session/prompt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "process it", workflowAction: "unknown" }),
		});
		expect(invalidProcessResponse.status).toBe(400);

		const imageResponse = await fetch(`${handle.address.url}/session/prompt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message: "inspect image",
				images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
			}),
		});
		expect(imageResponse.status).toBe(202);
		expect(fixture.session.prompt).toHaveBeenLastCalledWith("inspect image", expect.objectContaining({
			images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
		}));

		const legacyImageResponse = await fetch(`${handle.address.url}/session/prompt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message: "inspect legacy image",
				images: [{ type: "image", image: { data: "data:image/jpeg;base64,/9j/4AAQ" } }],
			}),
		});
		expect(legacyImageResponse.status).toBe(202);
		expect(fixture.session.prompt).toHaveBeenLastCalledWith("inspect legacy image", expect.objectContaining({
			images: [{ type: "image", mimeType: "image/jpeg", data: "/9j/4AAQ" }],
		}));

		const abortResponse = await fetch(`${handle.address.url}/session/abort`, { method: "POST" });
		expect(abortResponse.status).toBe(200);
		expect(fixture.session.abort).toHaveBeenCalledOnce();

		const newWorkspaceResponse = await fetch(`${handle.address.url}/session/new`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: "/tmp", collaborationMode: "plan" }),
		});
		expect(newWorkspaceResponse.status).toBe(200);
		expect(fixture.runtime.newSession).toHaveBeenLastCalledWith({
			cwd: "/tmp",
			parentSession: undefined,
			collaborationMode: "plan",
		});
	});

	test("serves every Memory control used by Desktop settings", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, { port: 0 });

		const stateResponse = await fetch(`${handle.address.url}/memory`);
		expect(stateResponse.status).toBe(200);
		expect(await stateResponse.json()).toMatchObject({ enabled: true, recordCount: 1 });

		const settingResponse = await fetch(`${handle.address.url}/memory/settings`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: false }),
		});
		expect(settingResponse.status).toBe(200);
		expect(fixture.session.setMemoryEnabled).toHaveBeenCalledWith(false);

		const runResponse = await fetch(`${handle.address.url}/memory/run`, { method: "POST" });
		expect(runResponse.status).toBe(200);
		expect(fixture.session.runMemory).toHaveBeenCalledOnce();

		const searchResponse = await fetch(`${handle.address.url}/memory/search?q=needle`);
		expect(searchResponse.status).toBe(200);
		expect(await searchResponse.json()).toEqual([{ id: "memory-1", content: "match:needle" }]);
		expect(fixture.session.searchMemory).toHaveBeenCalledWith("needle");

		const forgetResponse = await fetch(`${handle.address.url}/memory/memory-1`, { method: "DELETE" });
		expect(forgetResponse.status).toBe(200);
		expect(await forgetResponse.json()).toEqual({ forgotten: true });
		expect(fixture.session.forgetMemory).toHaveBeenCalledWith("memory-1");

		const resetResponse = await fetch(`${handle.address.url}/memory/reset`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirm: "RESET_MEMORY" }),
		});
		expect(resetResponse.status).toBe(200);
		expect(fixture.session.resetMemory).toHaveBeenCalledWith("RESET_MEMORY");
	});

	test("preserves active work when a client tries to replace the session", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, { port: 0 });
		fixture.session.isStreaming = true;

		const requests = [
			fetch(`${handle.address.url}/session/new`, { method: "POST" }),
			fetch(`${handle.address.url}/session/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionPath: "/tmp/other.jsonl" }),
			}),
			fetch(`${handle.address.url}/session/fork`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ entryId: "entry-1" }),
			}),
		];
		for (const response of await Promise.all(requests)) {
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: {
					code: "session_busy",
					message: "Agent is running or compacting context. Wait for the current run to finish.",
				},
			});
		}

		expect(fixture.runtime.newSession).not.toHaveBeenCalled();
		expect(fixture.runtime.switchSession).not.toHaveBeenCalled();
		expect(fixture.runtime.fork).not.toHaveBeenCalled();

		fixture.session.isStreaming = false;
		fixture.session.isCompacting = true;
		const compactingResponse = await fetch(`${handle.address.url}/session/switch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionPath: "/tmp/other.jsonl" }),
		});
		expect(compactingResponse.status).toBe(409);
		expect(fixture.runtime.switchSession).not.toHaveBeenCalled();
	});

	test("lets Desktop switch and create sessions without cancelling active work", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, { port: 0 });
		fixture.session.isStreaming = true;
		const desktopHeaders = { "Content-Type": "application/json", "X-Metis-Desktop": "1" };

		const switchResponse = await fetch(`${handle.address.url}/session/switch`, {
			method: "POST",
			headers: desktopHeaders,
			body: JSON.stringify({ sessionPath: "/tmp/other.jsonl" }),
		});
		expect(switchResponse.status).toBe(200);
		expect(await switchResponse.json()).toMatchObject({ cancelled: false, sessionId: "session-2" });
		expect(fixture.runtime.createSiblingForSession).toHaveBeenCalledWith("/tmp/other.jsonl");
		expect(fixture.session.abort).not.toHaveBeenCalled();
		expect(fixture.runtime.dispose).not.toHaveBeenCalled();

		const switchBackResponse = await fetch(`${handle.address.url}/session/switch`, {
			method: "POST",
			headers: desktopHeaders,
			body: JSON.stringify({ sessionPath: "/tmp/session.jsonl" }),
		});
		expect(switchBackResponse.status).toBe(200);
		expect(await switchBackResponse.json()).toMatchObject({ sessionId: "session-1", isStreaming: true });
		expect(fixture.runtime.createSiblingForSession).toHaveBeenCalledTimes(1);

		const newResponse = await fetch(`${handle.address.url}/session/new`, {
			method: "POST",
			headers: desktopHeaders,
			body: JSON.stringify({ cwd: "/tmp", collaborationMode: "plan" }),
		});
		expect(newResponse.status).toBe(200);
		expect(await newResponse.json()).toMatchObject({ cancelled: false, sessionId: "session-3" });
		expect(fixture.runtime.createSiblingNewSession).toHaveBeenCalledWith({
			cwd: "/tmp",
			parentSession: undefined,
			collaborationMode: "plan",
		});
		expect(fixture.session.abort).not.toHaveBeenCalled();
	});

	test("serves session, language, credential, import, export, and reload settings actions", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, { port: 0 });
		const command = (value: string) => fetch(`${handle!.address.url}/session/command`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: value }),
		});

		const nameResponse = await fetch(`${handle.address.url}/session/name`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: " Renamed session " }),
		});
		expect(nameResponse.status).toBe(200);
		expect(fixture.session.setSessionName).toHaveBeenCalledWith("Renamed session");

		const compactResponse = await fetch(`${handle.address.url}/session/compact`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(compactResponse.status).toBe(200);
		expect(fixture.session.compact).toHaveBeenCalledWith(undefined);

		expect((await command("/language")).status).toBe(200);
		expect((await command("/language zh-CN")).status).toBe(200);
		expect(fixture.session.settingsManager.setUiLanguage).toHaveBeenCalledWith("zh-CN");
		expect(await (await command("/login")).json()).toMatchObject({ providers: ["test"], oauthProviders: [] });
		expect(await (await command("/logout")).json()).toMatchObject({ providers: ["test"] });
		expect((await command("/logout test")).status).toBe(200);
		expect(fixture.session.modelRegistry.authStorage.logout).toHaveBeenCalledWith("test");

		const htmlPath = "/tmp/session export.html";
		expect((await command(`/export ${htmlPath}`)).status).toBe(200);
		expect(fixture.session.exportToHtml).toHaveBeenCalledWith(htmlPath);
		const jsonlPath = "/tmp/session import.jsonl";
		expect((await command(`/import ${jsonlPath}`)).status).toBe(200);
		expect(fixture.runtime.importFromJsonl).toHaveBeenCalledWith(jsonlPath);
		expect((await command("/reload")).status).toBe(200);
		expect(fixture.session.reload).toHaveBeenCalledOnce();
	});

	test("starts title generation before dispatching the first Desktop prompt", async () => {
		const fixture = createRuntimeFixture();
		fixture.session.sessionName = undefined as unknown as string;
		fixture.session.messages = [];
		const order: string[] = [];
		fixture.session.ensureSessionName.mockImplementation(async (options?: { prompt?: string }) => {
			order.push(`title:${options?.prompt}`);
			return undefined;
		});
		fixture.session.prompt.mockImplementation(async (_message, options) => {
			order.push("prompt");
			options.preflightResult?.(true);
		});
		handle = await startServerMode(fixture.runtime, { port: 0 });

		const response = await fetch(`${handle.address.url}/session/prompt`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "首个用户 prompt" }),
		});

		expect(response.status).toBe(202);
		expect(fixture.session.ensureSessionName).toHaveBeenCalledWith({ prompt: "首个用户 prompt" });
		expect(order).toEqual(["title:首个用户 prompt", "prompt"]);
	});

	test("returns Dream migration guidance without generating a title", async () => {
		const fixture = createRuntimeFixture();
		fixture.session.sessionName = undefined as unknown as string;
		fixture.session.messages = [];
		handle = await startServerMode(fixture.runtime, { port: 0 });

		const response = await fetch(`${handle.address.url}/session/command`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "/dream on" }),
		});

		expect(response.status).toBe(200);
		expect(fixture.session.prompt).not.toHaveBeenCalled();
		expect(fixture.session.ensureSessionName).not.toHaveBeenCalled();
	});

	test("waits for the localhost OAuth callback before showing fallback input", async () => {
		const fixture = createRuntimeFixture();
		const login = vi.fn(async (_providerId: string, callbacks: {
			onAuth: (info: { url: string }) => void;
			onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		}) => {
			expect(callbacks.onAuth).toBeTypeOf("function");
			expect(callbacks.onPrompt).toBeTypeOf("function");
			expect(callbacks.onManualCodeInput).toBeUndefined();
		});
		Object.assign(fixture.session.modelRegistry, {
			authStorage: {
				getOAuthProviders: vi.fn(() => [{ id: "anthropic" }]),
				login,
			},
			getAll: vi.fn(() => [{ provider: "anthropic", id: "claude-test" }]),
			refresh: vi.fn(),
		});
		Object.assign(fixture.session, { syncModelFromRegistry: vi.fn() });
		handle = await startServerMode(fixture.runtime, { port: 0 });

		const response = await fetch(`${handle.address.url}/session/command`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "/login anthropic" }),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ command: "login", provider: "anthropic" });
		expect(login).toHaveBeenCalledOnce();
	});

	test("streams connection and session events over SSE", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, { port: 0 });
		const response = await fetch(`${handle.address.url}/event`);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		const connected = decoder.decode((await reader.read()).value);
		expect(connected).toContain('"type":"server.connected"');
		const connectedPayload = JSON.parse(connected.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as {
			serverInstanceId: string;
			serverSequence: number;
			serverSessionId: string;
		};
		expect(connected).toContain(`id: ${connectedPayload.serverInstanceId}:${connectedPayload.serverSequence}`);
		expect(connectedPayload.serverSessionId).toBe("session-1");
		fixture.emit({ type: "message_start", message: { role: "assistant" } });
		const event = decoder.decode((await reader.read()).value);
		expect(event).toContain('"type":"message_start"');
		const eventPayload = JSON.parse(event.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as {
			serverInstanceId: string;
			serverSequence: number;
		};
		expect(eventPayload.serverInstanceId).toBe(connectedPayload.serverInstanceId);
		expect(eventPayload.serverSequence).toBeGreaterThan(connectedPayload.serverSequence);
		const newSessionResponse = await fetch(`${handle.address.url}/session/new`, { method: "POST" });
		expect(newSessionResponse.status).toBe(200);
		const sessionChanged = decoder.decode((await reader.read()).value);
		expect(sessionChanged).toContain('"type":"server.session_changed"');
		expect(sessionChanged).toContain('"sessionId":"session-1"');
		// Replacing a session must bind exactly once. While the routes re-bound on top of the
		// runtime's rebindSession hook, /session/new broadcast server.session_changed twice, and
		// each broadcast costs the renderer a full session sync. The next event's sequence proves
		// nothing was emitted in between.
		const changedPayload = JSON.parse(sessionChanged.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as {
			serverSequence: number;
		};
		fixture.emit({ type: "message_start", message: { role: "assistant" } });
		const afterChange = decoder.decode((await reader.read()).value);
		expect(afterChange).toContain('"type":"message_start"');
		const afterPayload = JSON.parse(afterChange.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as {
			serverSequence: number;
		};
		expect(afterPayload.serverSequence).toBe(changedPayload.serverSequence + 1);
		await reader.cancel();
	});

	test("enforces CORS allowlist and Basic authentication", async () => {
		const fixture = createRuntimeFixture();
		handle = await startServerMode(fixture.runtime, {
			port: 0,
			cors: ["http://localhost:5173"],
			password: "secret",
		});
		const deniedOrigin = await fetch(`${handle.address.url}/global/health`, {
			headers: { Origin: "http://evil.example" },
		});
		expect(deniedOrigin.status).toBe(403);

		const unauthorized = await fetch(`${handle.address.url}/global/health`, {
			headers: { Origin: "http://localhost:5173" },
		});
		expect(unauthorized.status).toBe(401);

		const authorized = await fetch(`${handle.address.url}/global/health`, {
			headers: {
				Origin: "http://localhost:5173",
				Authorization: `Basic ${Buffer.from("metis:secret").toString("base64")}`,
			},
		});
		expect(authorized.status).toBe(200);
		expect(authorized.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
	});

	test("requires authentication when listening beyond loopback", async () => {
		const fixture = createRuntimeFixture();
		await expect(startServerMode(fixture.runtime, { hostname: "0.0.0.0", port: 0 })).rejects.toThrow(
			"METIS_SERVER_PASSWORD",
		);
	});
});
