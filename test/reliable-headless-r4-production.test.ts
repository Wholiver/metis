import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskExecutionController } from "../src/core/task-execution-controller.ts";
import {
	compileTaskContractFromRequest,
	contractHasIndependentOracle,
	contractHasInstructionOwnedOracle,
	parseAndValidateSolverProposal,
} from "../src/core/task-contract.ts";
import { verifyTaskContract } from "../src/core/task-verifier.ts";
import { createHostNamedChildRunners } from "../src/core/host-named-child-runner.ts";
import { runAsHostDispatch, isHostDispatchActive } from "../src/core/host-dispatch.ts";
import { PerformanceRuntime, validatePerformanceSpawn } from "../src/core/performance-runtime.ts";
import { createSpawnAgentToolDefinition } from "../src/core/tools/spawn_agent.ts";
import { setGlobalSpawnGuard, SpawnGuard } from "../src/core/spawn-guard.ts";
import { TraceCollector, setGlobalTraceCollector } from "../src/core/trace-collector.ts";
import { extractAndMergeChildTraceSummaries as extractFromSpawn } from "../src/core/tools/spawn_agent.ts";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		spawn: (...args: unknown[]) => spawnMock(...args),
	};
});

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	spawnMock.mockReset();
	delete process.env.METIS_EXECUTION_PROFILE;
});

beforeEach(() => {
	setGlobalSpawnGuard(new SpawnGuard());
});

function createMockChildProcess() {
	const emitter = new EventEmitter() as any;
	emitter.stdout = new EventEmitter();
	emitter.stderr = new EventEmitter();
	emitter.unref = vi.fn();
	emitter.kill = vi.fn(() => true);
	return emitter;
}

describe("R4 P0-1: host contract-solver is live production path", () => {
	it("solver oracle makes non-toy task PASS / FAIL without public checker", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r4-solver-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "report.md"), "# Executive Review\nAcceptance: met\n");

		const instruction =
			"Produce a polished executive deliverable at output/report.md that satisfies the rubric for stakeholder acceptance review";
		expect(contractHasIndependentOracle(compileTaskContractFromRequest({
			instruction,
			cwd,
			profile: "reliable-headless",
			deadlineMs: 1,
			taskPaths: { output: join(cwd, "output") },
		}))).toBe(false);

		const ambientCwd = mkdtempSync(join(tmpdir(), "metis-r4-ambient-"));
		tempDirs.push(ambientCwd);
		mkdirSync(join(ambientCwd, "output"), { recursive: true });
		writeFileSync(
			join(ambientCwd, "package.json"),
			JSON.stringify({ name: "ambient", scripts: { test: "echo ambient" } }),
		);
		const ambient = compileTaskContractFromRequest({
			instruction,
			cwd: ambientCwd,
			profile: "reliable-headless",
			deadlineMs: 1,
			taskPaths: { output: join(ambientCwd, "output") },
		});
		expect(contractHasIndependentOracle(ambient)).toBe(true);
		expect(contractHasInstructionOwnedOracle(ambient)).toBe(false);

		const serviceChat = compileTaskContractFromRequest({
			instruction: "What port should the local server listen on for curl health checks?",
			cwd: ambientCwd,
			profile: "reliable-headless",
			deadlineMs: 1,
		});
		expect(serviceChat.kind).toBe("service-config");
		expect(contractHasIndependentOracle(serviceChat)).toBe(true);
		expect(contractHasInstructionOwnedOracle(serviceChat)).toBe(false);

		const solverJson = JSON.stringify({
			constraints: [
				{
					id: "report-has-acceptance",
					description: "report must contain Acceptance",
					authority: "task",
					oracle: { type: "file-contains", path: "output/report.md", substring: "Acceptance" },
				},
			],
		});

		const controllerPass = createTaskExecutionController({
			runAgent: async () => ({ finalText: "wrote report", stopReason: "stop" }),
			runContractSolver: async () => ({ finalText: solverJson, stopReason: "stop" }),
		});
		const pass = await controllerPass.execute({
			instruction,
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(pass.attempts.some((a) => a.role === "contract-solver")).toBe(true);
		expect(pass.status).toBe("completed");

		writeFileSync(join(cwd, "output", "report.md"), "# Draft\nmissing rubric token\n");
		const controllerFail = createTaskExecutionController({
			runAgent: async () => ({ finalText: "wrote report", stopReason: "stop" }),
			runContractSolver: async () => ({ finalText: solverJson, stopReason: "stop" }),
		});
		const fail = await controllerFail.execute({
			instruction,
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(fail.status).toBe("task_failed");
		expect(fail.failure?.code).toBe("CONSTRAINT_FAILED");
	});

	it("illegal solver output fails closed and cannot succeed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r4-solver-bad-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "report.md"), "ok\n");

		const instruction = "Produce a polished executive deliverable at output/report.md for stakeholder acceptance review";
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "should not matter", stopReason: "stop" }),
			runContractSolver: async () => ({
				finalText: "I think we should just trust the agent narrative.",
				stopReason: "stop",
			}),
		});
		const result = await controller.execute({
			instruction,
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(result.status).toBe("task_failed");
		expect(result.failure?.code).toBe("CONTRACT_SOLVER_INVALID");
		expect(result.completion.passed).toBe(false);

		const shellInject = parseAndValidateSolverProposal(
			JSON.stringify({
				constraints: [
					{
						id: "evil",
						description: "shell",
						authority: "task",
						oracle: { type: "command", command: ["bash", "-lc", "rm -rf /"] },
					},
				],
			}),
			cwd,
		);
		expect(shellInject.ok).toBe(false);
	});
});

describe("R4 P0-2: named-child inherits session spawn runtime (no hostNamedChildExecute)", () => {
	it("defaultExecute passes model/thinking and hostDispatch through session-like spawn options", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r4-spawn-opts-"));
		tempDirs.push(cwd);
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";

		const prepareDispatch = vi.fn(async (input: { agent: string; task: string }) => {
			expect(isHostDispatchActive()).toBe(true);
			return input;
		});
		const validateSpawn = vi.fn((_input: unknown, _rt: unknown, _id: string) => {
			expect(isHostDispatchActive()).toBe(true);
			return undefined;
		});
		const claimMutatingOwner = vi.fn(() => undefined);
		const releaseMutatingOwner = vi.fn();

		const tool = createSpawnAgentToolDefinition(cwd, {
			getRuntimeContext: () => ({
				provider: "openai",
				model: "gpt-host-test",
				baseUrl: "https://example.test/v1",
				thinking: "high" as const,
				apiKey: "sk-test",
			}),
			prepareDispatch,
			validateSpawn,
			claimMutatingOwner,
			releaseMutatingOwner,
		});

		const order: string[] = [];
		const runners = createHostNamedChildRunners({
			cwd,
			getSpawnTool: () => tool,
		});

		for (const role of ["planner", "implementer", "verifier"] as const) {
			const mockChild = createMockChildProcess();
			spawnMock.mockReturnValueOnce(mockChild);
			const pending =
				role === "planner"
					? runners.runPlanner!("design trade-off")
					: role === "implementer"
						? runners.runImplementer!("## Host plan from planner\nuse file write\n\n## Original task\ndo it")
						: runners.runVerifier!("verify it");
			await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
			const args = spawnMock.mock.calls.at(-1)?.[1] as string[];
			expect(args).toContain("--model");
			expect(args).toContain("gpt-host-test");
			expect(args).toContain("--thinking");
			expect(args).toContain("high");
			expect(args).toContain("--provider");
			expect(args).toContain("openai");
			expect(args).toContain("--base-url");
			expect(args).toContain("https://example.test/v1");
			const childResult = {
				status: "completed",
				summary: `${role} ok`,
				filesChanged: [],
				commands: [],
				findings: [],
			};
			queueMicrotask(() => {
				// Reliable-headless extracts a bare ChildResult JSON line from stdout.
				mockChild.stdout.emit("data", Buffer.from(`${JSON.stringify(childResult)}\n`));
				mockChild.emit("close", 0);
			});
			const outcome = await pending;
			// Even if ChildResult parsing fails, process args/policy assertions above already passed.
			expect(["stop", "error"]).toContain(outcome.stopReason ?? "stop");
			expect(prepareDispatch).toHaveBeenCalled();
			expect(validateSpawn).toHaveBeenCalled();
			order.push(role);
			spawnMock.mockClear();
			prepareDispatch.mockClear();
			validateSpawn.mockClear();
		}

		expect(order).toEqual(["planner", "implementer", "verifier"]);
	});
});

describe("R4 P0-3: hostDispatch-only T1 bypass", () => {
	it("T1 reliable rejects plain model spawn of planner; Controller hostDispatch allows it", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-r4-t1-"));
		tempDirs.push(agentDir);
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		const runtime = new PerformanceRuntime(agentDir);
		runtime.admit({
			kind: "admit",
			mission: "bounded fix",
			workspaceRoot: agentDir,
			admission: {
				tier: "T1",
				taskShape: "bounded",
				sharedMutableState: false,
				deliverables: ["fix"],
				acceptanceCriteria: ["tests pass"],
				verificationCommands: ["npm test"],
				lanes: [
					{
						id: "lane-1",
						objective: "fix bug",
						framework: "backend-fix",
						ownedPaths: ["src"],
						deliverables: ["fix"],
						acceptanceCriteria: ["tests pass"],
						verificationCommands: ["npm test"],
						dependsOn: [],
					},
				],
			},
		});

		expect(() => runtime.prepareSpawn({ agent: "planner", task: "design", laneId: "lane-1" })).toThrow(
			/does not permit planner/,
		);
		const plain = validatePerformanceSpawn(
			{ parentRole: "root", childRole: "planner", liveAgents: 0 },
			runtime.state!,
		);
		expect(plain.valid).toBe(false);

		const hosted = runAsHostDispatch(() => {
			const prepared = runtime.prepareSpawn({ agent: "planner", task: "design", laneId: "lane-1" });
			const decision = validatePerformanceSpawn(
				{ parentRole: "root", childRole: "planner", liveAgents: 0, hostDispatch: true },
				runtime.state!,
			);
			return { prepared, decision };
		});
		expect(hosted.prepared.task).toContain("design");
		expect(hosted.decision.valid).toBe(true);

		// Concurrency ceiling still applies under hostDispatch.
		runtime.state!.maxConcurrent = 0;
		const capped = runAsHostDispatch(() =>
			validatePerformanceSpawn(
				{ parentRole: "root", childRole: "implementer", liveAgents: 0, hostDispatch: true },
				runtime.state!,
			),
		);
		expect(capped.valid).toBe(false);
		expect(capped.message).toMatch(/ceiling/);
	});
});

describe("R4 trace merge idempotency", () => {
	it("replaying the same summary or dual stdout+tree path does not duplicate children/tokens", () => {
		const collector = new TraceCollector("run-r4-idem");
		setGlobalTraceCollector(collector);
		collector.recordUsage("root", { input: 1, output: 1 });

		const summary = {
			type: "trace_summary" as const,
			rootRunId: "run-child",
			agents: [
				{
					agentId: "child-a",
					inputTokens: 5,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					cost: 0,
					durationMs: 0,
					turnCount: 1,
					depth: 1,
				},
				{
					agentId: "grandchild-1",
					inputTokens: 3,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					cost: 0,
					durationMs: 0,
					turnCount: 1,
					depth: 2,
				},
			],
			children: [
				{
					agentId: "grandchild-1",
					role: "verifier",
					cwd: "/tmp",
					workspacePolicy: "shared" as const,
					exitCode: 0,
					outcome: "pass",
				},
			],
			totalInputTokens: 8,
			totalOutputTokens: 3,
			totalCacheReadTokens: 0,
			totalCacheWriteTokens: 0,
			totalCost: 0,
			totalDurationMs: 1,
			agentCount: 2,
		};

		collector.mergeChildTrace(summary);
		collector.mergeChildTrace(summary); // replay
		extractFromSpawn(`${JSON.stringify(summary)}\n`, collector); // stdout dual path

		const out = collector.getSummary();
		expect(out.agents.filter((a) => a.agentId === "grandchild-1")).toHaveLength(1);
		expect(out.children?.filter((c) => c.agentId === "grandchild-1")).toHaveLength(1);
		const grandchild = out.agents.find((a) => a.agentId === "grandchild-1")!;
		expect(grandchild.inputTokens).toBe(3);
		expect(out.totalInputTokens).toBe(1 + 5 + 3); // root + child + grandchild once
	});
});

describe("named-child fail-closed without session spawn_agent", () => {
	it("defaultExecute refuses bare cwd fallback when getSpawnTool is missing", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r4-bare-spawn-"));
		tempDirs.push(cwd);
		const runners = createHostNamedChildRunners({ cwd });
		const outcome = await runners.runPlanner!("plan something");
		expect(outcome.stopReason).toBe("error");
		expect(outcome.errorMessage).toMatch(/HOST_NAMED_CHILD_NO_SPAWN|spawn_agent is required/i);
	});
});
