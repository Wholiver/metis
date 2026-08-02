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
		sessionFile: "/tmp/session.jsonl",
		sessionId: "session-1",
		sessionName: "Server test",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		steeringMessages: ["steer queued"],
		followUpMessages: ["follow-up queued"],
		getRunningSubagentIds: vi.fn(() => ["job-1"]),
		messages: [{ role: "user", content: "hello" }],
		agent: { waitForIdle: vi.fn(async () => {}) },
		modelRegistry: { getAvailable: vi.fn(async () => [model]) },
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
		}),
		abort: vi.fn(async () => {}),
		compact: vi.fn(async () => ({ summary: "done" })),
		setModel: vi.fn(async () => {}),
		getAvailableThinkingLevels: vi.fn(() => ["off", "low", "medium", "high"]),
		supportsThinking: vi.fn(() => true),
		setThinkingLevel: vi.fn(),
		setAutoCompactionEnabled: vi.fn((enabled: boolean) => {
			session.autoCompactionEnabled = enabled;
		}),
		setSteeringMode: vi.fn((mode: "all" | "one-at-a-time") => {
			session.steeringMode = mode;
		}),
		setFollowUpMode: vi.fn((mode: "all" | "one-at-a-time") => {
			session.followUpMode = mode;
		}),
		setSessionName: vi.fn(),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
	};
	const runtime = {
		cwd: "/tmp",
		session,
		setRebindSession: vi.fn(),
		newSession: vi.fn(async () => ({ cancelled: false })),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		fork: vi.fn(async () => ({ cancelled: false, selectedText: undefined })),
		dispose: vi.fn(async () => {}),
	};
	return {
		runtime: runtime as unknown as AgentSessionRuntime,
		session,
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
		expect(spec.paths).toHaveProperty("/session/queue");
		expect(spec.paths).toHaveProperty("/session/queue/promote");
		expect(spec.paths).toHaveProperty("/session/settings");
		expect(spec.paths).toHaveProperty("/commands");
		expect(spec.paths).toHaveProperty("/session/command");

		const commandData = (await fetch(`${handle.address.url}/commands`).then((response) => response.json())) as {
			commands: Array<{ name: string; source: string }>;
		};
		expect(commandData.commands.filter((command) => command.source === "builtin")).toHaveLength(23);
		expect(commandData.commands.map((command) => command.name)).toEqual(expect.arrayContaining(["settings", "model", "compact", "quit"]));

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
		};
		expect(state.sessionId).toBe("session-1");
		expect(state.cwd).toBe("/tmp");
		expect(state.thinkingLevels).toEqual(["off", "low", "medium", "high"]);
		expect(state.supportsThinking).toBe(true);
		expect(state.followUpMessages).toEqual(["follow-up queued"]);
		expect(state.runningSubagentIds).toEqual(["job-1"]);

		const messageData = (await fetch(`${handle.address.url}/session/messages`).then((response) => response.json())) as {
			messageTimings: Array<{ messageTimestamp: number; completedAt: number }>;
		};
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

		const removeResponse = await fetch(`${handle.address.url}/session/queue`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ queue: "steering", index: 1 }),
		});
		expect(removeResponse.status).toBe(200);
		expect(await removeResponse.json()).toMatchObject({ message: { text: "follow-up queued" } });

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

		const settingsResponse = await fetch(`${handle.address.url}/session/settings`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				autoCompactionEnabled: false,
				steeringMode: "one-at-a-time",
				followUpMode: "one-at-a-time",
			}),
		});
		expect(settingsResponse.status).toBe(200);
		expect(fixture.session.setAutoCompactionEnabled).toHaveBeenCalledWith(false);
		expect(fixture.session.setSteeringMode).toHaveBeenCalledWith("one-at-a-time");
		expect(fixture.session.setFollowUpMode).toHaveBeenCalledWith("one-at-a-time");
		expect(await settingsResponse.json()).toMatchObject({
			autoCompactionEnabled: false,
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
		});

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
			body: JSON.stringify({ cwd: "/tmp" }),
		});
		expect(newWorkspaceResponse.status).toBe(200);
		expect(fixture.runtime.newSession).toHaveBeenLastCalledWith({ cwd: "/tmp", parentSession: undefined });
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
		fixture.emit({ type: "message_start", message: { role: "assistant" } });
		const event = decoder.decode((await reader.read()).value);
		expect(event).toContain('"type":"message_start"');
		const newSessionResponse = await fetch(`${handle.address.url}/session/new`, { method: "POST" });
		expect(newSessionResponse.status).toBe(200);
		const sessionChanged = decoder.decode((await reader.read()).value);
		expect(sessionChanged).toContain('"type":"server.session_changed"');
		expect(sessionChanged).toContain('"sessionId":"session-1"');
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
