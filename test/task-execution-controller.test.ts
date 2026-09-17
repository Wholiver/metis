import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskExecutionController, mapExecutionStatusToExitCode } from "../src/core/task-execution-controller.ts";
import { compileTaskContractFromRequest } from "../src/core/task-contract.ts";
import { planExecution } from "../src/core/execution-policy.ts";
import { TraceCollector } from "../src/core/trace-collector.ts";
import { resolveAgentConfig, BUILTIN_AGENTS } from "../src/core/agent-definition.ts";

describe("task-execution-controller reliable-headless", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
		delete process.env.METIS_EXECUTION_PROFILE;
	});

	it("execute() is fail-closed without sufficient oracle evidence", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-ctrl-fail-"));
		tempDirs.push(cwd);
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "done", stopReason: "stop" }),
			resolveContract: (request) => compileTaskContractFromRequest(request),
		});
		const result = await controller.execute({
			instruction: "say hello",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 1000,
		});
		expect(result.status).toBe("task_failed");
		expect(mapExecutionStatusToExitCode(result.status)).toBe(1);
		expect(result.completion.passed).toBe(false);
	});

	it("execute() passes only when host verifier oracle succeeds", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-ctrl-pass-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "result.json"), '{"ok":true}');
		writeFileSync(join(cwd, "check.sh"), "#!/bin/sh\nexit 0\n");

		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "wrote result", stopReason: "stop" }),
			resolveContract: (request) => compileTaskContractFromRequest(request),
		});
		const result = await controller.execute({
			instruction: "Create output/result.json and run check.sh",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(result.contract.compiled).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.completion.passed).toBe(true);
	});

	it("repair loop stops on identical failure fingerprint", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-ctrl-repair-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		let repairs = 0;
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "attempt", stopReason: "stop" }),
			runRepair: async () => {
				repairs += 1;
				return { finalText: `repair-${repairs}`, stopReason: "stop" };
			},
			resolveContract: (request) => compileTaskContractFromRequest({
				...request,
				instruction: "Create output/missing.json",
			}),
			maxRepairAttempts: 2,
		});
		const result = await controller.execute({
			instruction: "Create output/missing.json",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(result.status).toBe("task_failed");
		expect(result.failure?.code === "NO_PROGRESS_FINGERPRINT" || result.completion.passed === false).toBe(true);
		expect(repairs).toBeGreaterThan(0);
	});
});

describe("execution-policy short loop", () => {
	it("defaults to shared short loop without coordinator fleet", () => {
		const plan = planExecution({
			request: {
				instruction: "write output/result.json",
				cwd: "/tmp",
				profile: "reliable-headless",
				deadlineMs: 1,
			},
			contract: compileTaskContractFromRequest({
				instruction: "write output/result.json",
				cwd: "/tmp",
				profile: "reliable-headless",
				deadlineMs: 1,
			}),
		});
		expect(plan.workspacePolicy).toBe("shared");
		expect(plan.maxRepairAttempts).toBe(2);
		expect(plan.plannerRequired).toBe(false);
	});

	it("requires planner only for design uncertainty", () => {
		const plan = planExecution({
			request: {
				instruction: "choose an architecture trade-off and design the API",
				cwd: "/tmp",
				profile: "reliable-headless",
				deadlineMs: 1,
			},
			contract: compileTaskContractFromRequest({
				instruction: "choose an architecture trade-off and design the API",
				cwd: "/tmp",
				profile: "reliable-headless",
				deadlineMs: 1,
			}),
		});
		expect(plan.plannerRequired).toBe(true);
	});
});

describe("reliable-headless agent prompt/tool stripping", () => {
	it("removes performance_gate from workers and adds ChildResult contract", () => {
		process.env.METIS_EXECUTION_PROFILE = "reliable-headless";
		const implDef = BUILTIN_AGENTS.find((agent) => agent.name === "implementer");
		const verifierDef = BUILTIN_AGENTS.find((agent) => agent.name === "verifier");
		expect(implDef).toBeDefined();
		expect(verifierDef).toBeDefined();
		const impl = resolveAgentConfig({ agent: implDef! });
		const verifier = resolveAgentConfig({ agent: verifierDef! });
		expect(impl.tools ?? []).not.toContain("performance_gate");
		expect(verifier.tools ?? []).not.toContain("performance_gate");
		expect(impl.systemPrompt).toContain("ChildResult");
		expect(impl.systemPrompt).not.toContain("call the `performance_gate` tool");
	});
});

describe("trace aggregation", () => {
	it("aggregates child results and execution metadata", () => {
		const collector = new TraceCollector("run-agg");
		collector.recordUsage("root", { input: 10, output: 5, cost: 0.1 });
		collector.recordChildResult({
			agentId: "implementer-1",
			role: "implementer",
			cwd: "/tmp/task",
			workspacePolicy: "shared",
			exitCode: 0,
			outcome: "pass",
			childResult: {
				status: "completed",
				summary: "ok",
				filesChanged: ["output/a.txt"],
				commands: [{ argv: ["echo"], cwd: ".", exitCode: 0 }],
				findings: [],
			},
		});
		collector.recordExecution({
			profile: "reliable-headless",
			contractHash: "c1",
			repairAttempts: 1,
			completion: {
				passed: true,
				reasons: [],
				requiredArtifactsPresent: true,
				forbiddenArtifactsAbsent: true,
				checksPassed: true,
				unresolvedFindings: 0,
			},
		});
		const summary = collector.getSummary();
		expect(summary.children?.length).toBe(1);
		expect(summary.execution?.profile).toBe("reliable-headless");
		expect(collector.getChildResults()[0]?.status).toBe("completed");
	});
});
