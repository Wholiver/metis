import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		spawn: (...args: any[]) => spawnMock(...args),
	};
});

import {
	createKillAgentToolDefinition,
	createListAgentsToolDefinition,
	createMessageAgentToolDefinition,
	createWaitAgentToolDefinition,
} from "../src/core/tools/agent-management.ts";
import {
	createSpawnAgentToolDefinition,
	type ChildAgentResultPayload,
} from "../src/core/tools/spawn_agent.ts";
import {
	computeTaskHash,
	DEFAULT_MAX_CHILDREN_PER_AGENT,
	DEFAULT_MAX_CONCURRENT_AGENTS,
	DEFAULT_MAX_SPAWN_DEPTH,
	setGlobalSpawnGuard,
	SpawnGuard,
} from "../src/core/spawn-guard.ts";

describe("SpawnGuard & Lifecycle Management (Bundle 3)", () => {
	let guard: SpawnGuard;
	const tempDirs: string[] = [];

	beforeEach(() => {
		guard = new SpawnGuard({
			maxSpawnDepth: 5,
			maxChildrenPerAgent: 3,
			maxTotalChildren: 10,
			maxConcurrentAgents: 2,
			defaultTimeoutMs: 5000,
		});
		setGlobalSpawnGuard(guard);
	});

	afterEach(() => {
		spawnMock.mockReset();
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	function createMockChildProcess(pid = 1234) {
		const emitter = new EventEmitter() as any;
		emitter.pid = pid;
		emitter.stdout = new EventEmitter();
		emitter.stderr = new EventEmitter();
		emitter.unref = vi.fn();
		emitter.kill = vi.fn((sig?: string) => {
			emitter.emit("close", sig === "SIGKILL" ? 137 : 143);
			return true;
		});
		return emitter;
	}

	it("has correct default configuration constants", () => {
		expect(DEFAULT_MAX_SPAWN_DEPTH).toBe(5);
		expect(DEFAULT_MAX_CHILDREN_PER_AGENT).toBe(8);
		expect(DEFAULT_MAX_CONCURRENT_AGENTS).toBe(4);
	});

	it("enforces maxSpawnDepth limit (Feat 12)", () => {
		const checkOk = guard.canSpawn({
			agent: "planner",
			task: "Plan task",
			depth: 5,
		});
		expect(checkOk.valid).toBe(true);

		const checkExceeded = guard.canSpawn({
			agent: "planner",
			task: "Plan task",
			depth: 6,
		});
		expect(checkExceeded.valid).toBe(false);
		expect(checkExceeded.errorCode).toBe("DEPTH_LIMIT_EXCEEDED");
		expect(checkExceeded.errorMessage).toContain("Maximum spawn depth (5) exceeded");
	});

	it("enforces maxChildrenPerAgent limit (Feat 13)", () => {
		for (let i = 1; i <= 3; i++) {
			guard.registerChild({
				agentId: `agent-${i}`,
				agent: "implementer",
				task: `Task ${i}`,
				taskHash: computeTaskHash(`Task ${i}`),
				mode: "sync",
				depth: 1,
				parentId: "root",
				rootRunId: "run-1",
				status: "completed",
				startTime: Date.now(),
			});
		}

		const check = guard.canSpawn({
			agent: "implementer",
			task: "Task 4",
			depth: 1,
			parentId: "root",
		});
		expect(check.valid).toBe(false);
		expect(check.errorCode).toBe("MAX_CHILDREN_EXCEEDED");
		expect(check.errorMessage).toContain("Maximum children per agent (3) reached");
	});

	it("enforces maxConcurrentAgents limit (Feat 14)", () => {
		for (let i = 1; i <= 2; i++) {
			guard.registerChild({
				agentId: `running-${i}`,
				agent: "implementer",
				task: `Running task ${i}`,
				taskHash: computeTaskHash(`Running task ${i}`),
				mode: "async",
				depth: 1,
				parentId: "root",
				rootRunId: "run-1",
				status: "running",
				startTime: Date.now(),
			});
		}

		const check = guard.canSpawn({
			agent: "implementer",
			task: "Running task 3",
			depth: 1,
			parentId: "root",
		});
		expect(check.valid).toBe(false);
		expect(check.errorCode).toBe("CONCURRENCY_LIMIT_EXCEEDED");
		expect(check.errorMessage).toContain("Maximum concurrent running agents (2) reached");
	});

	it("detects duplicate tasks and allows rationale / force bypass (Feat 15)", () => {
		guard.registerChild({
			agentId: "implementer-1",
			agent: "implementer",
			task: "Fix authorization middleware bug",
			taskHash: computeTaskHash("Fix authorization middleware bug"),
			mode: "sync",
			depth: 1,
			parentId: "root",
			rootRunId: "run-1",
			status: "completed",
			startTime: Date.now(),
		});

		// 1. Same task with no rationale or force -> DUPLICATE_TASK_WARNING
		const checkDuplicate = guard.canSpawn({
			agent: "implementer",
			task: "Fix authorization middleware bug",
			depth: 1,
		});
		expect(checkDuplicate.valid).toBe(false);
		expect(checkDuplicate.errorCode).toBe("DUPLICATE_TASK_WARNING");
		expect(checkDuplicate.requiresRationale).toBe(true);
		expect(checkDuplicate.hint).toContain("provide 'rationale'");

		// 2. Same task with rationale -> Allowed
		const checkWithRationale = guard.canSpawn({
			agent: "implementer",
			task: "Fix authorization middleware bug",
			depth: 1,
			rationale: "Retrying implementation because test dependencies were missing in step 1",
		});
		expect(checkWithRationale.valid).toBe(true);

		// 3. Same task with force: true -> Allowed
		const checkWithForce = guard.canSpawn({
			agent: "implementer",
			task: "Fix authorization middleware bug",
			depth: 1,
			force: true,
		});
		expect(checkWithForce.valid).toBe(true);

		// 4. Different task -> Allowed
		const checkDifferentTask = guard.canSpawn({
			agent: "implementer",
			task: "Add unit tests for auth middleware",
			depth: 1,
		});
		expect(checkDifferentTask.valid).toBe(true);
	});

	it("integrates guard checks into spawn_agent tool execution (Feat 16)", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "metis-guard-test-"));
		tempDirs.push(tempDir);

		const definition = createSpawnAgentToolDefinition(tempDir, {
			guard,
			runtimeContext: {
				currentDepth: 5, // Next depth is 6 > maxSpawnDepth (5)
			},
		});

		const result = await definition.execute(
			"call-1",
			{ agent: "planner", task: "Plan something" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;
		expect(payload.status).toBe("error");
		expect(payload.errorCode).toBe("DEPTH_LIMIT_EXCEEDED");
		expect(payload.error).toContain("Maximum spawn depth (5) exceeded");
	});

	it("executes list_agents tool correctly (Feat 21)", async () => {
		guard.registerChild({
			agentId: "agent-a",
			agent: "planner",
			task: "Plan task",
			taskHash: "hash-a",
			mode: "sync",
			depth: 1,
			parentId: "root",
			rootRunId: "run-1",
			status: "completed",
			startTime: Date.now() - 5000,
			endTime: Date.now(),
			exitCode: 0,
			result: "Planning successful",
		});

		guard.registerChild({
			agentId: "agent-b",
			agent: "implementer",
			task: "Write code",
			taskHash: "hash-b",
			mode: "async",
			depth: 1,
			parentId: "root",
			rootRunId: "run-1",
			status: "running",
			startTime: Date.now() - 1000,
		});

		const listTool = createListAgentsToolDefinition({ guard });
		const resultAll = await listTool.execute("call-list-1", { status: "all" }, new AbortController().signal, () => {}, undefined as never);
		const parsedAll = JSON.parse(resultAll.content[0].text);
		expect(parsedAll.total).toBe(2);
		expect(parsedAll.agents[0].agentId).toBe("agent-a");
		expect(parsedAll.agents[1].agentId).toBe("agent-b");

		const resultRunning = await listTool.execute("call-list-2", { status: "running" }, new AbortController().signal, () => {}, undefined as never);
		const parsedRunning = JSON.parse(resultRunning.content[0].text);
		expect(parsedRunning.total).toBe(1);
		expect(parsedRunning.agents[0].agentId).toBe("agent-b");
	});

	it("executes wait_agent and kill_agent tools correctly (Feat 21, 22)", async () => {
		const mockChild = createMockChildProcess(5678);

		guard.registerChild({
			agentId: "async-agent-1",
			agent: "verifier",
			task: "Run tests",
			taskHash: "hash-v",
			mode: "async",
			depth: 1,
			parentId: "root",
			rootRunId: "run-1",
			status: "running",
			startTime: Date.now(),
			process: mockChild,
			pid: 5678,
		});

		// Test kill_agent
		const killTool = createKillAgentToolDefinition({ guard });
		const killResult = await killTool.execute("call-kill-1", { agentId: "async-agent-1" }, new AbortController().signal, () => {}, undefined as never);
		const killParsed = JSON.parse(killResult.content[0].text);
		expect(killParsed.status).toBe("success");
		expect(mockChild.kill).toHaveBeenCalled();

		const killedState = guard.getChild("async-agent-1");
		expect(killedState?.status).toBe("killed");

		// Test wait_agent on completed/killed agent
		const waitTool = createWaitAgentToolDefinition({ guard });
		const waitResult = await waitTool.execute("call-wait-1", { agentId: "async-agent-1" }, new AbortController().signal, () => {}, undefined as never);
		const waitParsed = JSON.parse(waitResult.content[0].text);
		expect(waitParsed.status).toBe("killed");
	});

	it("executes message_agent tool to send messages to child agent (Feat 21)", async () => {
		guard.registerChild({
			agentId: "target-agent-1",
			agent: "implementer",
			task: "Build frontend",
			taskHash: "hash-f",
			mode: "async",
			depth: 1,
			parentId: "root",
			rootRunId: "run-1",
			status: "running",
			startTime: Date.now(),
		});

		const sentMessages: Array<[string, string]> = [];
		const msgTool = createMessageAgentToolDefinition({
			guard,
			sendMessage: (id, msg) => sentMessages.push([id, msg]),
		});

		const result = await msgTool.execute(
			"call-msg-1",
			{ agentId: "target-agent-1", message: "Please prioritize index.css first" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.status).toBe("delivered");
		expect(sentMessages.length).toBe(1);
		expect(sentMessages[0][0]).toBe("target-agent-1");
		expect(sentMessages[0][1]).toBe("Please prioritize index.css first");
	});

	it("handles deterministic execution timeout (Feat 50)", async () => {
		const mockChild = createMockChildProcess();
		spawnMock.mockReturnValue(mockChild);

		const tempDir = mkdtempSync(join(tmpdir(), "metis-timeout-test-"));
		tempDirs.push(tempDir);

		const definition = createSpawnAgentToolDefinition(tempDir, {
			guard,
		});

		// Execute with 1 second timeout
		const executePromise = definition.execute(
			"call-timeout-1",
			{ agent: "implementer", task: "Long running task", timeoutSeconds: 1 },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		await new Promise((r) => setTimeout(r, 1100));

		const result = await executePromise;
		const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

		expect(payload.status).toBe("timed_out");
		expect(payload.errorCode).toBe("TIMEOUT");
		expect(payload.error).toContain("timed out after 1s");
	});
});

