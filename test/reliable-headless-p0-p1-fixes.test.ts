import { createConnection } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileTaskContract } from "../src/core/task-contract.ts";
import { verifyTaskContract, hashWorkspaceSnapshot } from "../src/core/task-verifier.ts";
import { createTaskExecutionController } from "../src/core/task-execution-controller.ts";
import { evaluateChildGateEvidence } from "../src/core/child-gate-evidence.ts";
import { TraceCollector, loadAndMergeTraceTree } from "../src/core/trace-collector.ts";
import { planExecution } from "../src/core/execution-policy.ts";

describe("P0: explicit constraints must be executed (fail closed)", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("proposed must-contain constraint fails when artifact content mismatches", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-constraint-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "bar\n");

		const contract = compileTaskContract({
			instruction: "Create output/a.txt containing foo",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			proposed: {
				requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
				constraints: [
					{
						id: "must-contain-foo",
						description: "artifact must contain foo",
						authority: "task",
					},
				],
				checks: [],
			},
		});

		expect(contract.constraints.some((c) => c.id === "must-contain-foo")).toBe(true);
		const verified = await verifyTaskContract({
			contract: { ...contract, checks: [] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(verified.completion.passed).toBe(false);
		const constraintResult = verified.constraints.find((c) => c.id === "must-contain-foo");
		expect(constraintResult).toBeDefined();
		expect(constraintResult?.passed).toBe(false);
	});

	it("unexecutable proposed constraint fails closed instead of being ignored", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-unexec-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "anything\n");
		const contract = compileTaskContract({
			instruction: "Create output/a.txt",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			proposed: {
				requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
				constraints: [
					{
						id: "vague-quality",
						description: "make it excellent somehow",
						authority: "task",
					},
				],
				checks: [],
			},
		});
		const verified = await verifyTaskContract({
			contract: { ...contract, checks: [] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(verified.completion.passed).toBe(false);
		expect(verified.constraints.some((c) => c.id === "vague-quality" && c.passed === false)).toBe(true);
		expect(verified.failures.some((f) => f.code === "CONSTRAINT_UNEXECUTABLE" || f.checkId === "vague-quality")).toBe(true);
	});
});

describe("P0: repair fingerprint uses workspace evidence hash", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("allows second repair when error text is identical but artifact hash changed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-fp-progress-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "v1\n");

		let repair = 0;
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "attempt", stopReason: "stop" }),
			runRepair: async () => {
				repair += 1;
				writeFileSync(join(cwd, "output", "a.txt"), `v${repair + 1}\n`);
				return { finalText: `repair-${repair}`, stopReason: "stop" };
			},
			resolveContract: () =>
				compileTaskContract({
					instruction: "Create output/a.txt containing FINAL",
					cwd,
					taskPaths: { output: join(cwd, "output") },
					proposed: {
						requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
						constraints: [{ id: "must-contain-FINAL", description: "artifact must contain FINAL", authority: "task" }],
						checks: [],
					},
				}),
			maxRepairAttempts: 2,
		});

		const result = await controller.execute({
			instruction: "Create output/a.txt containing FINAL",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});

		expect(result.failure?.code).not.toBe("NO_PROGRESS_FINGERPRINT");
		expect(repair).toBe(2);
		expect(result.status).toBe("task_failed");
	});

	it("stops with NO_PROGRESS when artifact content does not change", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-fp-stuck-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "stuck\n");

		let repair = 0;
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "attempt", stopReason: "stop" }),
			runRepair: async () => {
				repair += 1;
				return { finalText: `repair-${repair}`, stopReason: "stop" };
			},
			resolveContract: () =>
				compileTaskContract({
					instruction: "Create output/a.txt containing FINAL",
					cwd,
					taskPaths: { output: join(cwd, "output") },
					proposed: {
						requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
						constraints: [{ id: "must-contain-FINAL", description: "artifact must contain FINAL", authority: "task" }],
						checks: [],
					},
				}),
			maxRepairAttempts: 2,
		});

		const result = await controller.execute({
			instruction: "Create output/a.txt containing FINAL",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});

		expect(result.failure?.code).toBe("NO_PROGRESS_FINGERPRINT");
		expect(repair).toBe(1);
	});

	it("invalidates prior evidence after file content changes", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-stale-ws-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "foo\n");
		const contract = compileTaskContract({
			instruction: "Create output/a.txt containing foo",
			cwd,
			taskPaths: { output: join(cwd, "output") },
			proposed: {
				requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
				constraints: [{ id: "must-contain-foo", description: "artifact must contain foo", authority: "task" }],
				checks: [],
			},
		});
		const first = await verifyTaskContract({
			contract: { ...contract, checks: [] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(first.completion.passed).toBe(true);
		writeFileSync(join(cwd, "output", "a.txt"), "changed\n");
		const second = await verifyTaskContract({
			contract: { ...contract, checks: [] },
			cwd,
			taskPaths: { output: join(cwd, "output") },
			priorEvidenceHash: first.evidenceHash,
		});
		expect(second.failures.some((f) => f.code === "EVIDENCE_STALE")).toBe(true);
		expect(hashWorkspaceSnapshot(cwd, { output: join(cwd, "output") }, contract)).not.toBe(first.evidenceHash);
	});
});

describe("P0: ChildResult findings drive host gate evidence", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("failed/blocked/findings/non-zero commands prevent pass", () => {
		const failed = evaluateChildGateEvidence([
			{
				status: "failed",
				summary: "tests failed",
				filesChanged: [],
				commands: [{ argv: ["pytest"], cwd: ".", exitCode: 1 }],
				findings: [{ code: "TEST_FAIL", message: "assert 1 == 2" }],
			},
		]);
		expect(failed.passed).toBe(false);
		expect(failed.reasons.some((r) => r.code === "CHILD_RESULT_FAILED" || r.code === "CHECK_FAILED")).toBe(true);

		const findingsOnly = evaluateChildGateEvidence([
			{
				status: "completed",
				summary: "done with issues",
				filesChanged: [],
				commands: [{ argv: ["echo"], cwd: ".", exitCode: 0 }],
				findings: [{ code: "WARN", message: "still broken" }],
			},
		]);
		expect(findingsOnly.passed).toBe(false);
	});
	it("Controller gate fails on success+findings ChildResult (production chain)", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-child-gate-ctrl-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "done", stopReason: "stop" }),
			resolveContract: () =>
				compileTaskContract({
					instruction: "Create output/a.txt containing FINAL",
					cwd,
					taskPaths: { output: join(cwd, "output") },
					proposed: {
						requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
						constraints: [{ id: "must-contain-FINAL", description: "artifact must contain FINAL", authority: "task" }],
						checks: [],
					},
				}),
			getChildResults: () => [
				{
					status: "completed",
					summary: "finished with findings",
					filesChanged: ["output/a.txt"],
					commands: [],
					findings: [{ code: "STILL_BROKEN", message: "invariant violated" }],
				},
			],
		});
		const result = await controller.execute({
			instruction: "Create output/a.txt containing FINAL",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(result.status).toBe("task_failed");
		expect(result.completion.reasons.some((r) => r.code === "CHILD_FINDINGS_PRESENT")).toBe(true);
	});
});

describe("P1: short-loop attempt order is honest", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("records root when only runAgent is provided even if plan prefers implementer", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-route-root-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");
		const controller = createTaskExecutionController({
			runAgent: async () => ({ finalText: "root did it", stopReason: "stop" }),
			resolveContract: () =>
				compileTaskContract({
					instruction: "Create output/a.txt containing FINAL",
					cwd,
					taskPaths: { output: join(cwd, "output") },
					proposed: {
						requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
						constraints: [{ id: "must-contain-FINAL", description: "artifact must contain FINAL", authority: "task" }],
						checks: [],
					},
				}),
		});
		const result = await controller.execute({
			instruction: "design a trade-off then Create output/a.txt containing FINAL",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		const plan = planExecution({
			request: {
				instruction: "design a trade-off then Create output/a.txt containing FINAL",
				cwd,
				profile: "reliable-headless",
				deadlineMs: 1,
			},
			contract: result.contract,
		});
		expect(plan.plannerRequired || plan.implementationOwner === "implementer").toBe(true);
		expect(result.attempts[0]?.role).toBe("root");
	});

	it("dispatches planner → implementer → verify order when role runners exist", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-route-dispatch-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		const order: string[] = [];
		const controller = createTaskExecutionController({
			runAgent: async () => {
				order.push("root-fallback");
				return { finalText: "should not run", stopReason: "stop" };
			},
			runPlanner: async () => {
				order.push("planner");
				return { finalText: "plan ready", stopReason: "stop" };
			},
			runImplementer: async () => {
				order.push("implementer");
				writeFileSync(join(cwd, "output", "a.txt"), "FINAL\n");
				return { finalText: "implemented", stopReason: "stop" };
			},
			resolveContract: () =>
				compileTaskContract({
					instruction: "choose an architecture trade-off and Create output/a.txt containing FINAL",
					cwd,
					taskPaths: { output: join(cwd, "output") },
					proposed: {
						requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
						constraints: [{ id: "must-contain-FINAL", description: "artifact must contain FINAL", authority: "task" }],
						checks: [],
					},
				}),
		});
		const result = await controller.execute({
			instruction: "choose an architecture trade-off and Create output/a.txt containing FINAL",
			cwd,
			profile: "reliable-headless",
			deadlineMs: 5000,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(order).toEqual(["planner", "implementer"]);
		expect(result.attempts.map((a) => a.role)).toEqual(["planner", "implementer"]);
		expect(result.status).toBe("completed");
	});
});

describe("P1: recursive trace aggregation across processes", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("merges parent→child→grandchild envelopes from disk into root summary", () => {
		const rootDir = mkdtempSync(join(tmpdir(), "metis-trace-tree-"));
		tempDirs.push(rootDir);
		const traceRoot = join(rootDir, "trace");
		mkdirSync(join(traceRoot, "child-a"), { recursive: true });
		mkdirSync(join(traceRoot, "child-a", "grandchild-1"), { recursive: true });

		const grandchild = new TraceCollector("run-gc");
		grandchild.recordUsage("grandchild-1", { input: 3, output: 1 });
		grandchild.recordChildResult({
			agentId: "grandchild-1",
			role: "verifier",
			cwd: rootDir,
			workspacePolicy: "shared",
			exitCode: 0,
			outcome: "pass",
		});
		writeFileSync(join(traceRoot, "child-a", "grandchild-1", "summary.json"), JSON.stringify(grandchild.getSummary()));

		const child = new TraceCollector("run-child");
		child.recordUsage("child-a", { input: 5, output: 2 });
		child.recordChildResult({
			agentId: "child-a",
			role: "implementer",
			cwd: rootDir,
			workspacePolicy: "shared",
			exitCode: 0,
			outcome: "pass",
		});
		const childSummary = loadAndMergeTraceTree(join(traceRoot, "child-a"), child);
		writeFileSync(join(traceRoot, "child-a", "summary.json"), JSON.stringify(childSummary));

		const root = new TraceCollector("run-root");
		root.recordUsage("root", { input: 9, output: 4 });
		const merged = loadAndMergeTraceTree(traceRoot, root);
		expect(merged.agents.some((a) => a.agentId === "root")).toBe(true);
		expect(merged.agents.some((a) => a.agentId === "child-a")).toBe(true);
		expect(merged.agents.some((a) => a.agentId === "grandchild-1")).toBe(true);
		expect(merged.children?.some((c) => c.agentId === "grandchild-1")).toBe(true);
	});
});

describe("P1: oracle safety", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("shell checker under software uses software cwd not task root", () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-check-cwd-"));
		tempDirs.push(cwd);
		const software = join(cwd, "software");
		mkdirSync(software, { recursive: true });
		writeFileSync(join(software, "check.sh"), "#!/bin/sh\ntest -f ./marker && exit 0 || exit 1\n");
		writeFileSync(join(software, "marker"), "ok\n");
		const contract = compileTaskContract({
			instruction: "run check",
			cwd,
			taskPaths: { software },
		});
		const check = contract.checks.find((c) => c.id === "public:check.sh");
		expect(check?.cwd).toBe(software);
	});

	it("pyproject.toml alone does not invent a pytest check", () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-pyproject-"));
		tempDirs.push(cwd);
		writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname='x'\n");
		const contract = compileTaskContract({ instruction: "build artifact", cwd });
		expect(contract.checks.some((c) => c.id === "public:pytest")).toBe(false);
	});

	it("service probe does not use shell string interpolation", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-svc-"));
		tempDirs.push(cwd);
		const server = createConnection;
		void server;
		const contract = compileTaskContract({
			instruction: "ensure service on port",
			cwd,
			proposed: { kind: "service-config", checks: [], constraints: [], requiredArtifacts: [], forbiddenArtifacts: [], unresolved: [], environment: { requiredPaths: [], requiredCommands: [] }, compiled: true, contractHash: "x", evidenceLevel: "structural" },
		});
		const verified = await verifyTaskContract({
			contract: { ...contract, checks: [], requiredArtifacts: [], unresolved: [] },
			cwd,
			serviceTargets: [{ id: "svc", host: "127.0.0.1", port: 1 }],
		});
		// Unreachable port should fail without throwing injection; and implementation must not use bash -lc.
		expect(verified.failures.some((f) => f.code === "SERVICE_UNREACHABLE")).toBe(true);
		const source = readFileSync(new URL("../src/core/task-verifier.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/bash", "-lc"/);
		expect(source).not.toMatch(/\/dev\/tcp\//);
	});
});

describe("P1: artifact-only remains fail-closed without semantic oracle", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
	});

	it("file existence alone does not PASS without constraint/check oracle", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "metis-artifact-only-"));
		tempDirs.push(cwd);
		mkdirSync(join(cwd, "output"), { recursive: true });
		writeFileSync(join(cwd, "output", "result.bin"), "bytes");
		const contract = compileTaskContract({
			instruction: "produce an output artifact",
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		const verified = await verifyTaskContract({
			contract: {
				...contract,
				checks: [],
				constraints: contract.constraints.filter((c) => c.id === "output-not-polluted"),
				requiredArtifacts: [{ path: "output/result.bin", nonEmpty: true }],
			},
			cwd,
			taskPaths: { output: join(cwd, "output") },
		});
		expect(verified.completion.passed).toBe(false);
		expect(verified.failures.some((f) => f.code === "INSUFFICIENT_EVIDENCE")).toBe(true);
		expect(existsSync(join(cwd, "output", "result.bin"))).toBe(true);
	});
});

describe("P1: print-mode contract covers full message sequence", () => {
	it("buildContractInstruction joins initial + follow-up constraints", async () => {
		const { buildContractInstruction } = await import("../src/core/task-contract.ts");
		const instruction = buildContractInstruction("Create output/a.txt", [
			"artifact must contain FINAL",
			"do not invent secrets",
		]);
		expect(instruction).toContain("Create output/a.txt");
		expect(instruction).toContain("artifact must contain FINAL");
		expect(instruction).toContain("do not invent secrets");
		const contract = compileTaskContract({
			instruction,
			cwd: process.cwd(),
			proposed: {
				requiredArtifacts: [{ path: "output/a.txt", nonEmpty: true }],
				constraints: [{ id: "must-contain-FINAL", description: "artifact must contain FINAL", authority: "task" }],
				checks: [],
			},
		});
		expect(contract.constraints.some((c) => c.id === "must-contain-FINAL")).toBe(true);
	});
});
