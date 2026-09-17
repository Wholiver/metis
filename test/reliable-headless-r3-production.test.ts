import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/metis-ai";
import { compileTaskContractFromRequest } from "../src/core/task-contract.ts";
import { verifyTaskContract } from "../src/core/task-verifier.ts";
import { createTaskExecutionController } from "../src/core/task-execution-controller.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { TraceCollector, setGlobalTraceCollector } from "../src/core/trace-collector.ts";
import { extractAndMergeChildTraceSummaries } from "../src/core/tools/spawn_agent.ts";
import { createHostNamedChildRunners } from "../src/core/host-named-child-runner.ts";
import { runAsHostDispatch } from "../src/core/host-dispatch.ts";
import { PerformanceRuntime, validatePerformanceSpawn } from "../src/core/performance-runtime.ts";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("R3 P0: production compileTaskContractFromRequest extracts semantic oracles", () => {
	it("correct content PASSes without proposed injection", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r3-oracle-pass-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "foo\n");
		const contract = compileTaskContractFromRequest({
			instruction: "Create output/a.txt containing foo",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 1,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(contract.constraints.some((c) => c.oracle?.type === "file-contains")).toBe(true);
		const verified = await verifyTaskContract({
			contract,
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(verified.completion.passed).toBe(true);
	});

	it("wrong content yields CONSTRAINT_FAILED without proposed injection", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r3-oracle-fail-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "bar\n");
		const contract = compileTaskContractFromRequest({
			instruction: "Create output/a.txt containing foo",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 1,
			taskPaths: { output: join(cwd, "output") },
		});
		const verified = await verifyTaskContract({
			contract,
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(verified.completion.passed).toBe(false);
		expect(verified.failures.some((f) => f.code === "CONSTRAINT_FAILED")).toBe(true);
		expect(verified.failures.some((f) => f.code === "INSUFFICIENT_EVIDENCE")).toBe(false);
	});
});

describe("R3 P0: runPrintMode named-child seam dispatches roles and passes plan brief", () => {
	function createAssistantMessage(text: string): AssistantMessage {
		return {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-4o-mini",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
	}

	function createRuntimeHost() {
		const state = { messages: [createAssistantMessage("root idle")] };
		const session = {
			sessionManager: { getHeader: () => undefined },
			agent: { waitForIdle: async () => {} },
			state,
			model: { provider: "openai", id: "gpt-4o-mini", baseUrl: undefined },
			thinkingLevel: "off",
			collaborationMode: "build",
			contextWindowId: undefined,
			workflowPlan: undefined,
			instructionSources: undefined,
			instructionDiagnostics: undefined,
			memoryState: undefined,
			performanceRun: undefined,
			extensionRunner: { hasHandlers: () => false, emit: vi.fn(async () => {}) },
			bindExtensions: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
			prompt: vi.fn(async () => {}),
			reload: vi.fn(async () => {}),
		};
		return {
			session,
			newSession: vi.fn(async () => undefined),
			fork: vi.fn(async () => ({ selectedText: "" })),
			switchSession: vi.fn(async () => undefined),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn(),
		};
	}

	it("print-mode host runners call planner then implementer with plan in brief", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r3-print-roles-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");

		const calls: Array<{ agent: string; task: string }> = [];
		const runtimeHost = createRuntimeHost();
		const previous = process.env.METIS_EXECUTION_PROFILE;
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		try {
			const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
				mode: "json",
				initialMessage: "choose an architecture trade-off then Create output/a.txt containing FINAL",
				cwd,
				executionProfile: "reliable-headless",
				taskPaths: { output: join(cwd, "output") },
				hostNamedChildExecute: async ({ agent, task }) => {
					calls.push({ agent, task });
					if (agent === "planner") {
						return {
							finalText: "PLAN: use simple file write",
							stopReason: "stop",
							childResult: {
								status: "completed",
								summary: "planned",
								filesChanged: [],
								commands: [],
								findings: [],
							},
						};
					}
					if (agent === "implementer") {
						expect(task).toContain("PLAN: use simple file write");
						expect(task).toContain("Create output/a.txt containing FINAL");
						return {
							finalText: "implemented",
							stopReason: "stop",
							childResult: {
								status: "completed",
								summary: "wrote file",
								filesChanged: ["output/a.txt"],
								commands: [],
								findings: [],
							},
						};
					}
					return { finalText: `${agent} done`, stopReason: "stop" };
				},
			});
			expect(exitCode).toBe(0);
			expect(calls[0]?.agent).toBe("planner");
			expect(calls[1]?.agent).toBe("implementer");
			expect(calls.map((c) => c.agent)).toContain("planner");
			expect(calls.map((c) => c.agent)).toContain("implementer");
		} finally {
			if (previous === undefined) delete process.env.METIS_EXECUTION_PROFILE;
			else process.env.METIS_EXECUTION_PROFILE = previous;
		}
	});
});

describe("R3 P0: reliable-headless not blocked by legacy active performance", () => {
	it("correct artifact PASSes despite performance status=active", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-r3-perf-active-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "foo\n");
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "done", stopReason: "stop" }),
			getPerformanceSnapshot: () => ({ status: "active", frontier: "G6" }),
			resolveContract: (request) => compileTaskContractFromRequest(request),
		});
		const result = await controller.execute({
			instruction: "Create output/a.txt containing foo",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(result.status).toBe("completed");
		expect(result.failure?.code).not.toBe("FALSE_COMPLETION_AFTER_VERIFIER_FAIL");
	});

	it("T1 admission allows host planner only under hostDispatch", () => {
		const previous = process.env.METIS_EXECUTION_PROFILE;
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		const agentDir = mkdtempSync(join(tmpdir(), "metis-r3-t1-"));
		tempDirs.push(agentDir);
		try {
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
			expect(() => runtime.prepareSpawn({ agent: "planner", task: "design approach", laneId: "lane-1" })).toThrow(
				/does not permit planner/,
			);
			const prepared = runAsHostDispatch(() =>
				runtime.prepareSpawn({ agent: "planner", task: "design approach", laneId: "lane-1" }),
			);
			expect(prepared.task).toContain("design approach");
			const decision = validatePerformanceSpawn(
				{ parentRole: "root", childRole: "planner", liveAgents: 0, hostDispatch: true },
				runtime.state!,
			);
			expect(decision.valid).toBe(true);
		} finally {
			if (previous === undefined) delete process.env.METIS_EXECUTION_PROFILE;
			else process.env.METIS_EXECUTION_PROFILE = previous;
		}
	});
});

describe("R3 P1: parent merges grandchild from child stdout trace_summary", () => {
	it("extractAndMergeChildTraceSummaries merges nested agents from child output", () => {
		const collector = new TraceCollector("run-r3-trace");
		setGlobalTraceCollector(collector);
		collector.recordUsage("root", { input: 1, output: 1 });

		const childStdout = [
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
			JSON.stringify({
				type: "trace_summary",
				rootRunId: "run-child",
				agents: [
					{ agentId: "child-a", inputTokens: 2, outputTokens: 1 },
					{ agentId: "grandchild-1", inputTokens: 3, outputTokens: 1 },
				],
				children: [
					{
						agentId: "grandchild-1",
						role: "verifier",
						cwd: "/tmp",
						workspacePolicy: "shared",
						exitCode: 0,
						outcome: "pass",
					},
				],
			}),
		].join("\n");

		const merged = extractAndMergeChildTraceSummaries(childStdout, collector);
		expect(merged).toBe(1);
		const summary = collector.getSummary();
		expect(summary.agents.some((a) => a.agentId === "grandchild-1")).toBe(true);
		expect(summary.children?.some((c) => c.agentId === "grandchild-1")).toBe(true);
	});
});

describe("R3 host named-child runner builds implementer brief from planner", () => {
	it("createHostNamedChildRunners forwards planner text into implementer task", async () => {
		const calls: Array<{ agent: string; task: string }> = [];
		const runners = createHostNamedChildRunners({
			cwd: process.cwd(),
			execute: async ({ agent, task }) => {
				calls.push({ agent, task });
				if (agent === "planner") {
					return {
						finalText: "PLAN_BODY",
						stopReason: "stop",
						childResult: { status: "completed", summary: "ok", filesChanged: [], commands: [], findings: [] },
					};
				}
				return {
					finalText: "IMPL_BODY",
					stopReason: "stop",
					childResult: { status: "completed", summary: "ok", filesChanged: [], commands: [], findings: [] },
				};
			},
		});
		const plan = await runners.runPlanner!("original task");
		expect(plan.finalText).toBe("PLAN_BODY");
		const { buildImplementerBrief } = await import("../src/core/host-named-child-runner.ts");
		const impl = await runners.runImplementer!(buildImplementerBrief("original task", plan.finalText));
		expect(impl.finalText).toBe("IMPL_BODY");
		expect(calls[1]?.task).toContain("PLAN_BODY");
	});
});
