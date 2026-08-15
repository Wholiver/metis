import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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

describe("Bundle 8: Benchmark Harness, Concurrency, Failures & Safety (Feats 58, 60)", () => {
	let guard: SpawnGuard;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-benchmark-harness-"));
		guard = new SpawnGuard({
			maxSpawnDepth: 5,
			maxChildrenPerAgent: 5,
			maxTotalChildren: 20,
			maxConcurrentAgents: 4,
			defaultTimeoutMs: 3000,
		});
		setGlobalSpawnGuard(guard);
	});

	afterEach(async () => {
		spawnMock.mockReset();
		guard.killAllChildren("SIGKILL");
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	function createMockChild(pid = 2000) {
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

	describe("1. Parallel Grandchildren & Multi-Child Execution (Feat 58)", () => {
		it("should manage concurrent async grandchildren and update statuses deterministically", async () => {
			const child1 = createMockChild(2101);
			const child2 = createMockChild(2102);
			const grandChild1 = createMockChild(2103);
			const grandChild2 = createMockChild(2104);

			// Register L1 children
			guard.registerChild({
				agentId: "planner-01",
				agent: "planner",
				task: "Plan Module A",
				taskHash: computeTaskHash("Plan Module A"),
				mode: "async",
				depth: 1,
				parentId: "root",
				rootRunId: "run-bench-01",
				status: "running",
				startTime: Date.now(),
				process: child1,
				pid: 2101,
			});

			guard.registerChild({
				agentId: "planner-02",
				agent: "planner",
				task: "Plan Module B",
				taskHash: computeTaskHash("Plan Module B"),
				mode: "async",
				depth: 1,
				parentId: "root",
				rootRunId: "run-bench-01",
				status: "running",
				startTime: Date.now(),
				process: child2,
				pid: 2102,
			});

			// Register L2 grandchildren spawned by L1
			guard.registerChild({
				agentId: "implementer-01",
				agent: "implementer",
				task: "Implement Module A sub-feature",
				taskHash: computeTaskHash("Implement Module A sub-feature"),
				mode: "async",
				depth: 2,
				parentId: "planner-01",
				rootRunId: "run-bench-01",
				status: "running",
				startTime: Date.now(),
				process: grandChild1,
				pid: 2103,
			});

			guard.registerChild({
				agentId: "implementer-02",
				agent: "implementer",
				task: "Implement Module B sub-feature",
				taskHash: computeTaskHash("Implement Module B sub-feature"),
				mode: "async",
				depth: 2,
				parentId: "planner-02",
				rootRunId: "run-bench-01",
				status: "running",
				startTime: Date.now(),
				process: grandChild2,
				pid: 2104,
			});

			// Verify active running count
			expect(guard.listChildren({ status: "running" }).length).toBe(4);

			// Query via list_agents tool
			const listTool = createListAgentsToolDefinition({ guard });
			const listResult = await listTool.execute("call-list", { status: "running" }, new AbortController().signal, () => {}, undefined as any);
			const listParsed = JSON.parse(listResult.content[0].text);
			expect(listParsed.total).toBe(4);
			expect(listParsed.agents.map((a: any) => a.agentId)).toContain("implementer-01");
			expect(listParsed.agents.map((a: any) => a.agentId)).toContain("implementer-02");

			// Complete grandchildren
			guard.updateChildStatus("implementer-01", { status: "completed", exitCode: 0, result: "Module A sub-feature done" });
			guard.updateChildStatus("implementer-02", { status: "completed", exitCode: 0, result: "Module B sub-feature done" });

			expect(guard.listChildren({ status: "running" }).length).toBe(2);

			const waitTool = createWaitAgentToolDefinition({ guard });
			const waitGrandchild = await waitTool.execute("call-wait", { agentId: "implementer-01" }, new AbortController().signal, () => {}, undefined as any);
			const waitParsed = JSON.parse(waitGrandchild.content[0].text);
			expect(waitParsed.status).toBe("success");
			expect(waitParsed.result).toBe("Module A sub-feature done");
		});
	});

	describe("2. Structured Child Failure Handling & Attribution (Feat 58)", () => {
		it("should attribute authentication errors and return actionable hints", async () => {
			const mockChild = createMockChild(3001);
			spawnMock.mockReturnValue(mockChild);

			const definition = createSpawnAgentToolDefinition(tempDir, { guard });
			const execPromise = definition.execute(
				"call-auth-err",
				{ agent: "implementer", task: "Query remote model" },
				new AbortController().signal,
				() => {},
				undefined as any,
			);

			await new Promise((r) => setTimeout(r, 20));

			mockChild.stderr.emit("data", Buffer.from("Error: 401 Unauthorized: Invalid API Key provided for openrouter"));
			mockChild.emit("close", 1);

			const result = await execPromise;
			const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

			expect(payload.status).toBe("error");
			expect(payload.error).toContain("Authentication / Credential Error");
			expect(payload.hint).toContain("API key");
		});

		it("should attribute model access errors and return actionable hints", async () => {
			const mockChild = createMockChild(3002);
			spawnMock.mockReturnValue(mockChild);

			const definition = createSpawnAgentToolDefinition(tempDir, { guard });
			const execPromise = definition.execute(
				"call-model-err",
				{ agent: "planner", task: "Plan with missing model" },
				new AbortController().signal,
				() => {},
				undefined as any,
			);

			await new Promise((r) => setTimeout(r, 20));

			mockChild.stderr.emit("data", Buffer.from("Model 'unreleased-experimental-model' not found on endpoint"));
			mockChild.emit("close", 1);

			const result = await execPromise;
			const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

			expect(payload.status).toBe("error");
			expect(payload.error).toContain("Model Access Error");
			expect(payload.hint).toContain("Check the model identifier");
		});

		it("should attribute tool permission errors and return actionable hints", async () => {
			const mockChild = createMockChild(3003);
			spawnMock.mockReturnValue(mockChild);

			const definition = createSpawnAgentToolDefinition(tempDir, { guard });
			const execPromise = definition.execute(
				"call-tool-err",
				{ agent: "reviewer", task: "Write code (unauthorized)" },
				new AbortController().signal,
				() => {},
				undefined as any,
			);

			await new Promise((r) => setTimeout(r, 20));

			mockChild.stderr.emit("data", Buffer.from("Tool 'write' not allowed for role 'reviewer'"));
			mockChild.emit("close", 1);

			const result = await execPromise;
			const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

			expect(payload.status).toBe("error");
			expect(payload.error).toContain("Tool Permission Error");
			expect(payload.hint).toContain("allowlist");
		});
	});

	describe("3. Execution Timeout & Cancellation Propagation (Feat 58)", () => {
		it("should cleanly terminate long-running child upon timeout", async () => {
			const mockChild = createMockChild(4001);
			spawnMock.mockReturnValue(mockChild);

			const definition = createSpawnAgentToolDefinition(tempDir, { guard });
			const execPromise = definition.execute(
				"call-timeout",
				{ agent: "verifier", task: "Infinite loop task", timeoutSeconds: 1 },
				new AbortController().signal,
				() => {},
				undefined as any,
			);

			await new Promise((r) => setTimeout(r, 1100));

			const result = await execPromise;
			const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

			expect(payload.status).toBe("timed_out");
			expect(payload.errorCode).toBe("TIMEOUT");
			expect(payload.error).toContain("timed out after 1s");
			expect(mockChild.kill).toHaveBeenCalled();
		});

		it("should cascade kill signals across active children without leaving orphans", async () => {
			const childA = createMockChild(4002);
			const childB = createMockChild(4003);

			guard.registerChild({
				agentId: "agent-a",
				agent: "implementer",
				task: "Task A",
				taskHash: "hash-a",
				mode: "async",
				depth: 1,
				parentId: "root",
				rootRunId: "run-cancel-1",
				status: "running",
				startTime: Date.now(),
				process: childA,
				pid: 4002,
			});

			guard.registerChild({
				agentId: "agent-b",
				agent: "verifier",
				task: "Task B",
				taskHash: "hash-b",
				mode: "async",
				depth: 1,
				parentId: "root",
				rootRunId: "run-cancel-1",
				status: "running",
				startTime: Date.now(),
				process: childB,
				pid: 4003,
			});

			expect(guard.listChildren({ status: "running" }).length).toBe(2);

			// Trigger killAllChildren
			guard.killAllChildren("SIGTERM");

			expect(childA.kill).toHaveBeenCalledWith("SIGTERM");
			expect(childB.kill).toHaveBeenCalledWith("SIGTERM");
			expect(guard.listChildren({ status: "running" }).length).toBe(0);
		});
	});

	describe("4. Recursion Limits & Runaway Tree Guard (Feat 60)", () => {
		it("should block runaway spawning when maxSpawnDepth is reached", () => {
			const checkUnder = guard.canSpawn({ agent: "planner", task: "Step 5", depth: 5 });
			expect(checkUnder.valid).toBe(true);

			const checkOver = guard.canSpawn({ agent: "planner", task: "Step 6", depth: 6 });
			expect(checkOver.valid).toBe(false);
			expect(checkOver.errorCode).toBe("DEPTH_LIMIT_EXCEEDED");
			expect(checkOver.errorMessage).toContain("Maximum spawn depth (5) exceeded");
		});

		it("should detect infinite spawn loops and duplicate tasks without orphaning processes", () => {
			const taskDescription = "Refactor payment service gateway";
			const taskHash = computeTaskHash(taskDescription);

			guard.registerChild({
				agentId: "agent-loop-1",
				agent: "implementer",
				task: taskDescription,
				taskHash,
				mode: "sync",
				depth: 1,
				parentId: "root",
				rootRunId: "run-loop-1",
				status: "completed",
				startTime: Date.now(),
			});

			// Re-spawning identical task without rationale or force should be intercepted
			const loopCheck = guard.canSpawn({
				agent: "implementer",
				task: taskDescription,
				depth: 1,
			});

			expect(loopCheck.valid).toBe(false);
			expect(loopCheck.errorCode).toBe("DUPLICATE_TASK_WARNING");
			expect(loopCheck.requiresRationale).toBe(true);
			expect(loopCheck.hint).toContain("rationale");

			// Providing rationale should safely permit execution
			const allowedWithRationale = guard.canSpawn({
				agent: "implementer",
				task: taskDescription,
				depth: 1,
				rationale: "Retrying after updating database mock configuration",
			});
			expect(allowedWithRationale.valid).toBe(true);
		});
	});
});
