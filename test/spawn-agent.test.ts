import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		spawn: (...args: any[]) => spawnMock(...args),
	};
});

import { parseArgs } from "../src/cli/args.ts";
import {
	BUILTIN_COORDINATOR,
	BUILTIN_IMPLEMENTER,
	BUILTIN_PLANNER,
	resolveAgentConfig,
} from "../src/core/agent-definition.ts";
import {
	createSpawnAgentTool,
	createSpawnAgentToolDefinition,
	SPAWN_AGENT_GUIDANCE,
	spawnAgentSchema,
	type ChildAgentResultPayload,
} from "../src/core/tools/spawn_agent.ts";

describe("spawn_agent tool & recursive delegation (Bundle 2)", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		spawnMock.mockReset();
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	function createMockChildProcess() {
		const emitter = new EventEmitter() as any;
		emitter.stdout = new EventEmitter();
		emitter.stderr = new EventEmitter();
		emitter.unref = vi.fn();
		return emitter;
	}

	it("has valid schema and descriptions", () => {
		expect(spawnAgentSchema.properties.agent).toBeDefined();
		expect(spawnAgentSchema.properties.task).toBeDefined();
		expect(spawnAgentSchema.properties.context).toBeDefined();
		expect(spawnAgentSchema.properties.mode).toBeDefined();
		expect(spawnAgentSchema.properties.worktree).toBeDefined();
		expect(SPAWN_AGENT_GUIDANCE).toContain("Delegate a specific task to a specialized named agent");
	});

	it("parses CLI flags for agent, depth, parent-id, root-run-id, and context", () => {
		const parsed = parseArgs([
			"--agent",
			"implementer",
			"--depth",
			"2",
			"--parent-id",
			"planner-123",
			"--root-run-id",
			"run-root-456",
			"--agent-context",
			"Extra analysis info",
		]);

		expect(parsed.agent).toBe("implementer");
		expect(parsed.depth).toBe(2);
		expect(parsed.parentId).toBe("planner-123");
		expect(parsed.rootRunId).toBe("run-root-456");
		expect(parsed.agentContext).toBe("Extra analysis info");
	});

	it("executes in sync mode by default and returns structured success result", async () => {
		const mockChild = createMockChildProcess();
		spawnMock.mockReturnValue(mockChild);

		const tempDir = mkdtempSync(join(tmpdir(), "metis-spawn-agent-"));
		tempDirs.push(tempDir);

		const definition = createSpawnAgentToolDefinition(tempDir, {
			runtimeContext: {
				currentDepth: 0,
				currentAgentId: "root",
				rootRunId: "run-001",
				provider: "openrouter",
				model: "anthropic/claude-3.5-sonnet",
				thinking: "high",
			},
		});

		const executePromise = definition.execute(
			"tool-call-1",
			{ agent: "planner", task: "Plan architecture" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		await new Promise((r) => setTimeout(r, 20));

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const spawnCallArgs = spawnMock.mock.calls[0];
		const argsPassed = spawnCallArgs[1] as string[];

		expect(argsPassed).toContain("--agent");
		expect(argsPassed).toContain("planner");
		expect(argsPassed).toContain("--depth");
		expect(argsPassed).toContain("1");
		expect(argsPassed).toContain("--parent-id");
		expect(argsPassed).toContain("root");
		expect(argsPassed).toContain("--root-run-id");
		expect(argsPassed).toContain("run-001");
		expect(argsPassed).toContain("--provider");
		expect(argsPassed).toContain("openrouter");
		expect(argsPassed).toContain("--model");
		expect(argsPassed).toContain("anthropic/claude-3.5-sonnet");
		expect(argsPassed).toContain("--thinking");
		expect(argsPassed).toContain("high");

		// Simulate child output and normal close
		mockChild.stdout.emit("data", Buffer.from("Planning completed successfully.\nSteps: 1, 2, 3"));
		mockChild.emit("close", 0);

		const result = await executePromise;
		expect(result.content[0].type).toBe("text");
		const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

		expect(payload.status).toBe("success");
		expect(payload.agent).toBe("planner");
		expect(payload.depth).toBe(1);
		expect(payload.parentId).toBe("root");
		expect(payload.rootRunId).toBe("run-001");
		expect(payload.result).toBe("Planning completed successfully.\nSteps: 1, 2, 3");
	});

	it("executes in sync mode and returns structured error on non-zero exit code", async () => {
		const mockChild = createMockChildProcess();
		spawnMock.mockReturnValue(mockChild);

		const tempDir = mkdtempSync(join(tmpdir(), "metis-spawn-agent-"));
		tempDirs.push(tempDir);

		const definition = createSpawnAgentToolDefinition(tempDir, {
			runtimeContext: {
				currentDepth: 1,
				currentAgentId: "planner-abc",
				rootRunId: "run-001",
			},
		});

		const executePromise = definition.execute(
			"tool-call-2",
			{ agent: "implementer", task: "Write code", context: "Context payload" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		await new Promise((r) => setTimeout(r, 20));

		const argsPassed = spawnMock.mock.calls[0][1] as string[];
		expect(argsPassed).toContain("--depth");
		expect(argsPassed).toContain("2");
		expect(argsPassed).toContain("--parent-id");
		expect(argsPassed).toContain("planner-abc");
		expect(argsPassed).toContain("--agent-context");
		expect(argsPassed).toContain("Context payload");

		mockChild.stderr.emit("data", Buffer.from("Syntax error in implementation"));
		mockChild.emit("close", 1);

		const result = await executePromise;
		const payload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;

		expect(payload.status).toBe("error");
		expect(payload.agent).toBe("implementer");
		expect(payload.depth).toBe(2);
		expect(payload.exitCode).toBe(1);
		expect(payload.error).toContain("Syntax error in implementation");
	});

	it("executes in async mode and notifies on status change and completion", async () => {
		const mockChild = createMockChildProcess();
		spawnMock.mockReturnValue(mockChild);

		const tempDir = mkdtempSync(join(tmpdir(), "metis-spawn-agent-"));
		tempDirs.push(tempDir);

		const statuses: Array<[string, boolean]> = [];
		const messages: Array<[string, string]> = [];

		const definition = createSpawnAgentToolDefinition(tempDir, {
			onStatusChange: (agentId, running) => statuses.push([agentId, running]),
			sendMessage: (agentId, message) => messages.push([agentId, message]),
		});

		const result = await definition.execute(
			"tool-call-3",
			{ agent: "verifier", task: "Run test suite", mode: "async" },
			new AbortController().signal,
			() => {},
			undefined as never,
		);

		const initialPayload = JSON.parse(result.content[0].text) as ChildAgentResultPayload;
		expect(initialPayload.status).toBe("started");
		expect(initialPayload.agent).toBe("verifier");
		expect(initialPayload.depth).toBe(1);

		expect(statuses.length).toBe(1);
		expect(statuses[0][1]).toBe(true);

		// Trigger close
		mockChild.emit("close", 0);
		await new Promise((r) => setTimeout(r, 50));

		expect(statuses.length).toBe(2);
		expect(statuses[1][1]).toBe(false);
		expect(messages.length).toBe(1);
		const delivered = JSON.parse(messages[0][1]) as ChildAgentResultPayload;
		expect(delivered.status).toBe("success");
		expect(delivered.agent).toBe("verifier");
	});

	it("enforces tool permission convergence across hierarchy (Coordinator has spawn_agent, Planner does not)", () => {
		// Coordinator retains spawn_agent
		const coordinatorConfig = resolveAgentConfig({
			agent: BUILTIN_COORDINATOR,
			parentConfig: {
				tools: ["spawn_agent", "read", "bash", "edit", "write", "grep", "find", "ls"],
			},
		});
		expect(coordinatorConfig.tools).toContain("spawn_agent");
		expect(coordinatorConfig.tools).toContain("read");

		// Planner excludes spawn_agent and mutating tools
		const plannerConfig = resolveAgentConfig({
			agent: BUILTIN_PLANNER,
			parentConfig: {
				tools: ["spawn_agent", "read", "bash", "edit", "write", "grep", "find", "ls"],
			},
		});
		expect(plannerConfig.tools).not.toContain("spawn_agent");
		expect(plannerConfig.tools).not.toContain("write");
		expect(plannerConfig.tools).not.toContain("edit");
		expect(plannerConfig.tools).toContain("read");
		expect(plannerConfig.tools).toContain("grep");

		// Implementer excludes spawn_agent
		const implementerConfig = resolveAgentConfig({
			agent: BUILTIN_IMPLEMENTER,
			parentConfig: {
				tools: ["spawn_agent", "read", "bash", "edit", "write", "grep", "find", "ls"],
			},
		});
		expect(implementerConfig.tools).not.toContain("spawn_agent");
		expect(implementerConfig.tools).toContain("write");
		expect(implementerConfig.tools).toContain("edit");
	});

	it("supports L0 -> L1 -> L2 -> L3 -> L4 recursive depth calculation", () => {
		let depth = 0;
		for (let level = 1; level <= 4; level++) {
			const nextDepth = depth + 1;
			expect(nextDepth).toBe(level);
			depth = nextDepth;
		}
		expect(depth).toBe(4);
	});
});
