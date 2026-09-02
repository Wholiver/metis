import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	PerformanceRuntime,
	getPerformanceRunDirectory,
	validatePerformanceSpawn,
} from "../src/core/performance-runtime.ts";
import { createPerformanceGateToolDefinition } from "../src/core/tools/performance-gate.ts";

describe("built-in Performance runtime", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	type RoadmapItem = Partial<{
		id: string;
		category: string;
		tag: string;
		tier: string;
		framework: string;
		exactChangeSpecification: string;
		dependencies: string;
		ownedBoundaries: string;
		launchGroup: string;
		requiresDetailedPlan: boolean;
		detailedPlanReason: string;
	}>;

	function writeRoadmap(state: { governanceRoot: string }, items: RoadmapItem[]): void {
		const template = readFileSync(join(state.governanceRoot, "ROADMAP.md"), "utf8");
		const roadmap = template.slice(0, template.indexOf("## Item:"))
			.replace(/: TBD$/gm, ": confirmed from repository")
			.replace("requiresDetailedPlan: false", "requiresDetailedPlan: false")
			+ items.map((item, index) => `## Item: ${item.id ?? `item-${index + 1}`}
- Category: ${item.category ?? "backend"}
- Tag: ${item.tag ?? "none"}
- Tier: ${item.tier ?? "T2"}
- Framework: ${item.framework ?? "backend-implement"}
- Owned boundaries: ${item.ownedBoundaries ?? `src/core/${item.id ?? `item-${index + 1}`}.ts`}
- Dependencies: ${item.dependencies ?? "none"}
- Launch group: ${item.launchGroup ?? `build-${index + 1}`}
- Integration lane: ${item.id ?? `item-${index + 1}`} integration
- Implementation steps: add regression then repair behavior
- Acceptance criteria: valid observable behavior
- Unhappy paths: malformed input returns a typed failure
- Tests-first steps: add a red regression test
- Verification commands: npm test -- ${item.id ?? `item-${index + 1}`}
- Exact change specification: ${item.exactChangeSpecification ?? "rename parser flag in the named files"}
- requiresDetailedPlan: ${item.requiresDetailedPlan ?? false}
- Detailed plan reason: ${item.detailedPlanReason ?? (item.requiresDetailedPlan ? "unresolved architecture fork" : "not required")}
`).join("\n");
		writeFileSync(join(state.governanceRoot, "ROADMAP.md"), roadmap, "utf8");
	}

	function completeRoadmap(state: { governanceRoot: string }, requiresDetailedPlan = false): void {
		writeRoadmap(state, [{ id: "parser-fix", requiresDetailedPlan }]);
	}

	function receipt(state: { governanceRoot: string }, name: string): string {
		const path = join(state.governanceRoot, "artifacts", `${name}.md`);
		writeFileSync(path, `# ${name}\n\nOpened evidence.\n- changedFiles: src/core/${name}.ts\n- characterizationTests: test/${name}.test.ts\n- testCommand: npm test -- ${name}\n- redTestOutput: expected regression failure\n- greenTestOutput: 1 passed\n- exitCode: 0\n- testOutput: 1 passed\n- reproWasRed: true\n- reproNowGreen: true\n- preExistingRegressions: 0\n- coverage: 100%\n- openFindings: 0\n- endToEnd: pass\n`, "utf8");
		return `artifacts/${name}.md`;
	}

	function passScope(runtime: PerformanceRuntime, state: { governanceRoot: string }): void {
		runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") });
		runtime.recordGateReport({ gate: "G2-review", actor: "scope-reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "scope-review") });
		runtime.recordGateReport({ gate: "G2-verify", actor: "scope-verifier-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "scope-verify") });
	}

	it("persists governance outside cwd with a hash-bound mission pointer", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Repair the parser", concurrency: "tokensaver" });

		expect(state.governanceRoot).toBe(getPerformanceRunDirectory(agentDir, state.runId));
		expect(existsSync(join(state.governanceRoot, "PROMPTS.txt"))).toBe(true);
		expect(existsSync(join(state.governanceRoot, "ROADMAP.md"))).toBe(true);
		expect(existsSync(join(state.governanceRoot, "GATELOG.md"))).toBe(true);
		expect(readFileSync(join(state.governanceRoot, "PROMPTS.txt"), "utf8")).toContain("Repair the parser");
		expect(state.capabilityProbe).toMatchObject({ read: true, write: true, run: true, evidence: "artifacts/capability-probe.md" });
		expect(existsSync(join(state.governanceRoot, state.capabilityProbe.evidence))).toBe(true);
		expect(runtime.context()).toContain(`RUN-NONCE: ${state.nonce}`);
		expect(runtime.context()).toContain("SHA-256:");
		expect(runtime.context()).toContain("Native execution protocol: plan-scope");
		expect(runtime.context()).toContain("REPAIR_REQUIRED");
		expect(runtime.context()).toContain("structured spawn_agent error");

		const rehydrated = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		expect(rehydrated.state?.runId).toBe(state.runId);
		expect(new PerformanceRuntime(agentDir, {
			METIS_PERFORMANCE_RUN_ID: state.runId,
			METIS_PERFORMANCE_GOVERNANCE_ROOT: state.governanceRoot,
			METIS_PERFORMANCE_NONCE: "wrong",
		}).state).toBeUndefined();
		writeFileSync(join(state.governanceRoot, "PROMPTS.txt"), "tampered\n", "utf8");
		expect(new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId }).state).toBeUndefined();
	});

	it("keeps G2 active when a worker mistakes repairable roadmap validation for a blocker", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Repair the parser" });
		const evidence = receipt(state, "scope-repair");

		expect(() => runtime.recordGateReport({
			gate: "G2",
			actor: "scoper-1",
			role: "scoper",
			verdict: "pass",
			evidence,
		})).toThrow("REPAIR_REQUIRED");
		expect(() => runtime.recordGateReport({
			gate: "G2",
			actor: "scope-coordinator-2",
			role: "scope-coordinator",
			verdict: "blocked",
			evidence,
		})).toThrow("must repair ROADMAP.md");
		expect(runtime.state).toMatchObject({ status: "active", frontier: "G2" });

		const resumed = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		expect(resumed.context()).toContain("REPAIR REQUIRED at G2");
		expect(() => resumed.recordGateReport({
			gate: "G2",
			actor: "scope-coordinator-3",
			role: "scope-coordinator",
			verdict: "blocked",
			evidence,
		})).toThrow("must repair ROADMAP.md");

		completeRoadmap(state);
		resumed.recordGateReport({ gate: "G2", actor: "scoper-1", role: "scoper", verdict: "pass", evidence });
		expect(resumed.state?.frontier).toBe("G2-assurance");
		expect(resumed.state?.repairRequired).toBeUndefined();
	});

	it("rejects a stale worker blocker after another worker reports a repairable G2 error", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const parent = new PerformanceRuntime(agentDir);
		const state = parent.start({ kind: "start", mission: "Inspect repository scope" });
		const worker = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		const staleWorker = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		const evidence = receipt(state, "scope-repair");
		expect(() => worker.recordGateReport({ gate: "G2", actor: "scope-1", role: "scoper", verdict: "pass", evidence })).toThrow("REPAIR_REQUIRED");

		// Both workers were created before the validation error. The second must
		// see the persisted repair guard, not terminate the run from its old copy.
		expect.soft(() => staleWorker.recordGateReport({ gate: "G2", actor: "scope-2", role: "scoper", verdict: "blocked", evidence })).toThrow("must repair ROADMAP.md");
		expect(parent.reserveSpawn("root", "scoper", "retry-scope")).toEqual({ valid: true });
		expect(parent.state?.status).toBe("active");
	});

	it("preserves live leases when a previously loaded worker reports a gate", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const parent = new PerformanceRuntime(agentDir);
		const state = parent.start({ kind: "start", mission: "Inspect repository scope" });
		const worker = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		expect(parent.reserveSpawn("root", "scoper", "scope-live")).toEqual({ valid: true });
		completeRoadmap(state);
		worker.recordGateReport({ gate: "G2", actor: "scope-1", role: "scoper", verdict: "pass", evidence: receipt(state, "scope") });
		expect(parent.read(state.runId)?.leases.map((lease) => lease.agentId)).toEqual(["scope-live"]);
	});

	it("collects assurance reports from independently loaded workers without losing a verdict", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const parent = new PerformanceRuntime(agentDir);
		const state = parent.start({ kind: "start", mission: "Inspect repository scope" });
		completeRoadmap(state);
		parent.recordGateReport({ gate: "G2", actor: "scope-1", role: "scoper", verdict: "pass", evidence: receipt(state, "scope") });
		const reviewer = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		const verifier = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		reviewer.recordGateReport({ gate: "G2-review", actor: "review-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "review") });
		verifier.recordGateReport({ gate: "G2-verify", actor: "verify-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "verify") });
		const persisted = parent.read(state.runId);
		expect(persisted?.reports.map((report) => report.gate)).toEqual(["G2", "G2-review", "G2-verify"]);
		expect(persisted?.frontier).toBe("G4");
	});

	it("rejects steering from a stale parent while another process holds a live lease", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const parent = new PerformanceRuntime(agentDir);
		const state = parent.start({ kind: "start", mission: "Inspect repository scope" });
		const staleParent = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		expect(parent.reserveSpawn("root", "scoper", "scope-live")).toEqual({ valid: true });
		expect(() => staleParent.steer("Change scope")).toThrow("collected subagents");
		expect(parent.read(state.runId)?.missionSha256).toBe(state.missionSha256);
	});

	it("does not let a stale worker overwrite a newly steered mission", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const parent = new PerformanceRuntime(agentDir);
		const state = parent.start({ kind: "start", mission: "Inspect repository scope" });
		const staleWorker = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		const steered = parent.steer("Include malformed input");
		completeRoadmap(steered);
		expect(() => staleWorker.recordGateReport({ gate: "G2", actor: "old-scope", role: "scoper", verdict: "pass", evidence: receipt(steered, "stale") })).toThrow("binding changed");
		expect(parent.read(state.runId)).toMatchObject({ missionSha256: steered.missionSha256, reports: [] });
	});

	it("does not overwrite corrupted governance from a cached snapshot", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Inspect repository scope" });
		const prompt = join(state.governanceRoot, "PROMPTS.txt");
		writeFileSync(prompt, "changed outside the runtime", "utf8");
		expect(() => runtime.steer("New task")).toThrow("integrity validation failed");
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope", role: "scoper", verdict: "blocked", evidence: receipt(state, "blocked") })).toThrow("integrity validation failed");
		expect(readFileSync(prompt, "utf8")).toBe("changed outside the runtime");
	});

	it("does not revive a legitimately blocked run from a stale worker", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const parent = new PerformanceRuntime(agentDir);
		const state = parent.start({ kind: "start", mission: "Inspect repository scope" });
		const staleWorker = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });
		parent.recordGateReport({ gate: "G2", actor: "scope", role: "scoper", verdict: "blocked", evidence: receipt(state, "blocked") });
		completeRoadmap(state);
		expect(() => staleWorker.recordGateReport({ gate: "G2", actor: "old-scope", role: "scoper", verdict: "pass", evidence: receipt(state, "stale") })).toThrow("run is blocked");
		expect(parent.read(state.runId)?.status).toBe("blocked");
	});

	it("uses the same lock for gate reports and steering without removing another worker's lock", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Inspect repository scope" });
		completeRoadmap(state);
		const report = { gate: "G2", actor: "scope", role: "scoper", verdict: "pass", evidence: receipt(state, "scope") } as const;
		const lock = join(state.governanceRoot, ".run.lock");
		writeFileSync(lock, "another worker owns this lock", "utf8");
		expect(() => runtime.recordGateReport(report)).toThrow("governance is busy");
		expect(() => runtime.steer("New scope")).toThrow("governance is busy");
		expect(readFileSync(lock, "utf8")).toBe("another worker owns this lock");
		expect(runtime.read(state.runId)?.reports).toEqual([]);
		rmSync(lock);
		runtime.recordGateReport(report);
		expect(runtime.read(state.runId)?.frontier).toBe("G2-assurance");
	});

	it("hard-stops before scope when required read/write/run capability is unavailable", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		expect(() => new PerformanceRuntime(agentDir).start({
			kind: "start",
			mission: "Ship it",
			capabilities: { read: true, write: false, run: true },
		})).toThrow("capability probe failed");
	});

	it("passes capability probe under simulated electron environment", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const origElectron = (process.versions as Record<string, string>).electron;
		try {
			(process.versions as Record<string, string>).electron = "35.0.0";
			const runtime = new PerformanceRuntime(agentDir);
			const state = runtime.start({ kind: "start", mission: "Test Electron probe" });
			expect(state.capabilityProbe.run).toBe(true);
		} finally {
			if (origElectron === undefined) {
				delete (process.versions as Record<string, string>).electron;
			} else {
				(process.versions as Record<string, string>).electron = origElectron;
			}
		}
	});

	it("appends steering to the prompt ledger and reopens scope in the same run", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Repair the parser" });
		const steered = runtime.steer("Also cover malformed UTF-8 input.");

		expect(steered.runId).toBe(state.runId);
		expect(steered.frontier).toBe("G2");
		expect(readFileSync(join(state.governanceRoot, "PROMPTS.txt"), "utf8")).toContain("Also cover malformed UTF-8 input.");
		expect(readFileSync(join(state.governanceRoot, "ROADMAP.md"), "utf8")).toContain(`sha256=${steered.missionSha256}`);
	});

	it("re-anchors a resumed run to unchanged external governance receipts", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Repair the parser" });
		expect(new PerformanceRuntime(agentDir).resume(state.runId)?.runId).toBe(state.runId);

		const runPath = join(state.governanceRoot, "run.json");
		const persisted = JSON.parse(readFileSync(runPath, "utf8")) as { reports: unknown[] };
		persisted.reports = [{
			gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", at: new Date().toISOString(),
			evidence: "artifacts/capability-probe.md sha256=0000000000000000000000000000000000000000000000000000000000000000 bytes=0",
		}];
		writeFileSync(runPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
		expect(() => new PerformanceRuntime(agentDir).resume(state.runId)).toThrow("evidence receipt is unavailable or changed");
	});

	it("enforces L0-L4 dispatch edges and the live-worker ceiling", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const state = new PerformanceRuntime(agentDir).start({ kind: "start", mission: "Ship it", maxConcurrent: 2, concurrency: "custom" });

		expect(validatePerformanceSpawn({ parentRole: "root", childRole: "scope-coordinator", liveAgents: 0 }, state).valid).toBe(true);
		expect(validatePerformanceSpawn({ parentRole: "root", childRole: "feature-coordinator", liveAgents: 0 }, state).valid).toBe(true);
		expect(validatePerformanceSpawn({ parentRole: "root", childRole: "sweep-coordinator", liveAgents: 0 }, state).valid).toBe(true);
		expect(validatePerformanceSpawn({ parentRole: "root", childRole: "implementer", liveAgents: 0 }, state).valid).toBe(true);
		expect(validatePerformanceSpawn({ parentRole: "root", childRole: "invalid-role", liveAgents: 0 }, state).valid).toBe(false);
		expect(validatePerformanceSpawn({ parentRole: "manager", childRole: "verifier", liveAgents: 0 }, state).valid).toBe(true);
		expect(validatePerformanceSpawn({ parentRole: "reviewer", childRole: "implementer", liveAgents: 0 }, state).valid).toBe(false);
		expect(validatePerformanceSpawn({ parentRole: "implementer", childRole: "juror", liveAgents: 0 }, state).valid).toBe(true);
		expect(validatePerformanceSpawn({ parentRole: "manager", childRole: "verifier", liveAgents: 2 }, state).valid).toBe(false);
	});

	it("allows scope to route through planning before implementation", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state, true);
		runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") });
		runtime.recordGateReport({ gate: "G2-review", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "scope-review") });
		runtime.recordGateReport({ gate: "G2-verify", actor: "fresh-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "scope-verify") });
		expect(runtime.state?.frontier).toBe("G1");
		runtime.recordGateReport({ gate: "G1", actor: "planner-1", role: "planner", verdict: "pass", evidence: receipt(state, "plan") });
		expect(runtime.state?.frontier).toBe("G1-assurance");
		runtime.recordGateReport({ gate: "G1-review", actor: "plan-reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "plan-review") });
		runtime.recordGateReport({ gate: "G1-verify", actor: "plan-verifier-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "plan-verify") });
		expect(runtime.state?.frontier).toBe("G4");
	});

	it("accepts independent scope assurance receipts in either completion order", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state);

		runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") });
		runtime.recordGateReport({ gate: "G2-verify", actor: "fresh-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "scope-verify") });
		expect(runtime.state?.frontier).toBe("G2-assurance");
		runtime.recordGateReport({ gate: "G2-review", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "scope-review") });
		expect(runtime.state?.frontier).toBe("G4");
	});

	it("accepts independent implementation review and verification in either completion order", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state);

		runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") });
		runtime.recordGateReport({ gate: "G2-review", actor: "scope-reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "scope-review") });
		runtime.recordGateReport({ gate: "G2-verify", actor: "scope-verifier-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "scope-verify") });
		runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: receipt(state, "implementation") });
		runtime.recordGateReport({ gate: "G6", actor: "verifier-1", role: "verifier", verdict: "pass", evidence: receipt(state, "verify") });
		expect(runtime.state?.frontier).toBe("G4-assurance");
		runtime.recordGateReport({ gate: "G5", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "review") });
		expect(runtime.state?.frontier).toBe("G7");
	});

	it("enforces the worker ceiling across rehydrated run processes", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const first = new PerformanceRuntime(agentDir);
		const state = first.start({ kind: "start", mission: "Ship it", maxConcurrent: 2, concurrency: "custom" });
		const second = new PerformanceRuntime(agentDir, { METIS_PERFORMANCE_RUN_ID: state.runId });

		expect(first.reserveSpawn("root", "scope-coordinator", "scope-1").valid).toBe(true);
		expect(second.reserveSpawn("scope-coordinator", "implementer", "implementer-1").valid).toBe(true);
		expect(first.reserveSpawn("scope-coordinator", "reviewer", "reviewer-1")).toMatchObject({ valid: false, message: expect.stringContaining("ceiling") });
		second.releaseSpawn("implementer-1");
		expect(first.reserveSpawn("scope-coordinator", "reviewer", "reviewer-1").valid).toBe(true);
	});

	it("records only legal evidence-gate transitions in the governance ledger", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state);
		const tool = createPerformanceGateToolDefinition({ runtime: () => runtime, actor: () => ({ id: "scope-1", role: "scope-coordinator" }) });

		await tool.execute("call-1", { gate: "G2", verdict: "pass", evidence: receipt(state, "scope") });
		expect(runtime.state?.frontier).toBe("G2-assurance");
		expect(() => runtime.recordGateReport({ gate: "G2-review", actor: "scope-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "self-scope-review") })).toThrow("independent");
		await expect(tool.execute("call-2", { gate: "G7", verdict: "pass", evidence: receipt(state, "wrong-gate") })).rejects.toThrow("Evidence is for G7");
		expect(readFileSync(join(state.governanceRoot, "GATELOG.md"), "utf8")).toContain("FRONTIER G2-assurance");
		expect(readFileSync(join(state.governanceRoot, "GATELOG.md"), "utf8")).toContain("elapsed_ms=");
	});

	it("rejects placeholder roadmaps and non-governance evidence", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: "scope accepted" })).toThrow("artifacts");
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") })).toThrow("ROADMAP.md is incomplete");
	});

	it("rejects ROADMAP items without stable structured routing fields", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		writeRoadmap(state, [{ id: "bad-item", category: "backend", tier: "T2", framework: "not-a-framework" }]);
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") })).toThrow("unknown Framework");
		writeRoadmap(state, [{ id: "bad-dependency", dependencies: "missing-item" }]);
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope-retry") })).toThrow("unknown item");
		writeRoadmap(state, [{ id: "wrong-lane", category: "backend", framework: "frontend-implement" }]);
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope-wrong-lane") })).toThrow("frontend work, not backend");
		writeRoadmap(state, [{ id: "unmarked-fix", category: "backend", tag: "none", framework: "backend-fix" }]);
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope-unmarked-fix") })).toThrow("Tag: debug");
	});

	it("rejects cyclic, overlapping, and unexplained detailed ROADMAP plans", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship coordinated parser changes" });

		writeRoadmap(state, [
			{ id: "parser", dependencies: "lexer" },
			{ id: "lexer", dependencies: "parser" },
		]);
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope-cycle") })).toThrow("dependency graph contains a cycle");

		writeRoadmap(state, [
			{ id: "parser", ownedBoundaries: "src/core/parser" },
			{ id: "parser-token", ownedBoundaries: "src/core/parser/token.ts" },
		]);
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope-overlap") })).toThrow("overlapping owned boundaries");

		writeRoadmap(state, [{ id: "parser", requiresDetailedPlan: true }]);
		const roadmapPath = join(state.governanceRoot, "ROADMAP.md");
		writeFileSync(roadmapPath, readFileSync(roadmapPath, "utf8").replace(/^\- Detailed plan reason:.*\n/m, ""), "utf8");
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope-missing-plan-reason") })).toThrow("Detailed plan reason");
	});

	it("routes debug items through G0 characterization, G1, then independent G3.5 depth-lock", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Fix parser" });
		writeRoadmap(state, [{ id: "parser-defect", tag: "debug", tier: "T1", framework: "backend-fix" }]);
		passScope(runtime, state);
		expect(runtime.state).toMatchObject({ frontier: "G0", activeItemId: "parser-defect" });
		expect(runtime.context()).toContain("Native execution protocol: backend-fix");
		runtime.recordGateReport({ gate: "G0", actor: "implementer-0", role: "implementer", verdict: "pass", evidence: receipt(state, "characterization") });
		expect(runtime.state?.frontier).toBe("G1");
		runtime.recordGateReport({ gate: "G1", actor: "planner-1", role: "planner", verdict: "pass", evidence: receipt(state, "plan") });
		runtime.recordGateReport({ gate: "G1-review", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "plan-review") });
		runtime.recordGateReport({ gate: "G1-verify", actor: "fresh-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "plan-verify") });
		expect(runtime.state?.frontier).toBe("G3.5");
		runtime.recordGateReport({ gate: "G3.5", actor: "depth-1", role: "depth-prober", verdict: "pass", evidence: receipt(state, "depth-lock") });
		expect(runtime.state?.frontier).toBe("G4");
	});

	it("requires refactor characterization and keeps mechanical apply on proportional gates", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Restructure parser then rename an option" });
		writeRoadmap(state, [
			{ id: "reshape", framework: "refactor", tier: "T1" },
			{ id: "rename-option", framework: "apply", tier: "T0", dependencies: "reshape", exactChangeSpecification: "rename parserLegacy to parserCurrent in src/core/parser.ts and its test" },
		]);
		passScope(runtime, state);
		expect(runtime.state).toMatchObject({ frontier: "G0", activeItemId: "reshape" });
		runtime.recordGateReport({ gate: "G0", actor: "implementer-0", role: "implementer", verdict: "pass", evidence: receipt(state, "characterization") });
		expect(runtime.state?.frontier).toBe("G4");
		runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: receipt(state, "reshape-implementation") });
		runtime.recordGateReport({ gate: "G5", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "reshape-review") });
		runtime.recordGateReport({ gate: "G6", actor: "verifier-1", role: "verifier", verdict: "pass", evidence: receipt(state, "reshape-verify") });
		expect(runtime.state).toMatchObject({ frontier: "G4", activeItemId: "rename-option" });
	});

	it("rejects apply items that lack a falsifiable exact-change admission", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Rename a flag" });
		writeRoadmap(state, [{ id: "rename-option", framework: "apply", tier: "T0" }]);
		const roadmapPath = join(state.governanceRoot, "ROADMAP.md");
		writeFileSync(roadmapPath, readFileSync(roadmapPath, "utf8").replace(/^\- Exact change specification:.*\n/m, ""), "utf8");
		expect(() => runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") })).toThrow("Exact change specification");
	});

	it("applies T1 and T3 sign-off variants while honoring dependency order", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship two items" });
		writeRoadmap(state, [
			{ id: "first", tier: "T1", framework: "backend-implement", launchGroup: "wave-1" },
			{ id: "second", tier: "T3", framework: "frontend-build", category: "frontend", dependencies: "first", launchGroup: "wave-2" },
		]);
		passScope(runtime, state);
		expect(runtime.state).toMatchObject({ frontier: "G4", activeItemId: "first" });
		runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: receipt(state, "first-implementation") });
		runtime.recordGateReport({ gate: "G5", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "first-review") });
		runtime.recordGateReport({ gate: "G6", actor: "verifier-1", role: "verifier", verdict: "pass", evidence: receipt(state, "first-verify") });
		expect(runtime.state).toMatchObject({ frontier: "G4", activeItemId: "second", completedItemIds: ["first"] });
		runtime.recordGateReport({ gate: "G4", actor: "implementer-2", role: "implementer", verdict: "pass", evidence: receipt(state, "second-implementation") });
		runtime.recordGateReport({ gate: "G5", actor: "reviewer-2", role: "reviewer", verdict: "pass", evidence: receipt(state, "second-review") });
		runtime.recordGateReport({ gate: "G6", actor: "verifier-2", role: "verifier", verdict: "pass", evidence: receipt(state, "second-verify") });
		expect(runtime.state?.frontier).toBe("G7");
		for (const juror of ["juror-1", "juror-2"]) {
			runtime.recordGateReport({ gate: "G7", actor: juror, role: "juror", verdict: "pass", evidence: receipt(state, juror) });
			expect(runtime.state?.frontier).toBe("G7-assurance");
		}
		runtime.recordGateReport({ gate: "G7", actor: "juror-3", role: "juror", verdict: "pass", evidence: receipt(state, "juror-3") });
		expect(runtime.state).toMatchObject({ frontier: "sweep", completedItemIds: ["first", "second"] });
		runtime.recordGateReport({ gate: "sweep", actor: "sweeper-1", role: "sweeper", verdict: "pass", evidence: receipt(state, "convergence-sweep") });
		expect(runtime.state?.frontier).toBe("goal-check");
	});

	it("requires independent review, verification, and sign-off evidence", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state);
		runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") });
		runtime.recordGateReport({ gate: "G2-review", actor: "scope-reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "scope-review") });
		runtime.recordGateReport({ gate: "G2-verify", actor: "scope-verifier-1", role: "fresh-verifier", verdict: "pass", evidence: receipt(state, "scope-verify") });
		runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: receipt(state, "implementation") });
		expect(runtime.state?.frontier).toBe("G4-assurance");
		expect(() => runtime.recordGateReport({ gate: "G5", actor: "implementer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "self-review") })).toThrow("independent");
		runtime.recordGateReport({ gate: "G5", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "review") });
		expect(runtime.state?.frontier).toBe("G4-assurance");
		expect(() => runtime.recordGateReport({ gate: "G6", actor: "reviewer-1", role: "verifier", verdict: "pass", evidence: receipt(state, "self-verify") })).toThrow("independent");
		runtime.recordGateReport({ gate: "G6", actor: "verifier-1", role: "verifier", verdict: "pass", evidence: receipt(state, "verify") });
		expect(runtime.state?.frontier).toBe("G7");
		expect(() => runtime.recordGateReport({ gate: "G7", actor: "implementer-1", role: "juror", verdict: "pass", evidence: receipt(state, "self-signoff") })).toThrow("independent");
		runtime.recordGateReport({ gate: "G7", actor: "juror-1", role: "juror", verdict: "pass", evidence: receipt(state, "signoff") });
		expect(runtime.state?.frontier).toBe("goal-check");
		expect(runtime.reserveSpawn("root", "scope-coordinator", "live-child").valid).toBe(true);
		expect(() => runtime.recordGateReport({ gate: "goal-check", actor: "goal-checker-1", role: "goal-checker", verdict: "pass", evidence: receipt(state, "goal-check-live") })).toThrow("zero live subagents");
		runtime.releaseSpawn("live-child");
		runtime.recordGateReport({ gate: "goal-check", actor: "goal-checker-1", role: "goal-checker", verdict: "pass", evidence: receipt(state, "goal-check") });
		expect(runtime.state?.status).toBe("completed");
	});

	it("rejects unverifiable G6 receipts", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state);
		passScope(runtime, state);
		runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: receipt(state, "implementation") });
		runtime.recordGateReport({ gate: "G5", actor: "reviewer-1", role: "reviewer", verdict: "pass", evidence: receipt(state, "review") });
		const weak = join(state.governanceRoot, "artifacts", "weak.md");
		writeFileSync(weak, "# weak\n- coverage: 100%\n- preExistingRegressions: 0\n", "utf8");
		expect(() => runtime.recordGateReport({ gate: "G6", actor: "verifier-1", role: "verifier", verdict: "pass", evidence: "artifacts/weak.md" })).toThrow("testCommand");
	});

	it("rejects G4 implementation reports without a real red-to-green TDD record", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Ship it" });
		completeRoadmap(state);
		passScope(runtime, state);
		const weak = join(state.governanceRoot, "artifacts", "weak-implementation.md");
		writeFileSync(weak, "# weak\n- changedFiles: src/core/parser.ts\n- testCommand: npm test -- parser\n- testOutput: 1 passed\n", "utf8");
		expect(() => runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: "artifacts/weak-implementation.md" })).toThrow("redTestOutput");
	});

	it("allows a mechanical apply receipt to prove its real verification without inventing red-to-green", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Apply the exact config rename" });
		writeRoadmap(state, [{ id: "rename", framework: "apply", tier: "T0", exactChangeSpecification: "rename parserLegacy to parserCurrent in src/core/parser.ts" }]);
		passScope(runtime, state);
		const evidence = join(state.governanceRoot, "artifacts", "apply.md");
		writeFileSync(evidence, "# apply\n- changedFiles: src/core/parser.ts\n- testCommand: npm test -- parser\n- testOutput: 1 passed\n", "utf8");
		runtime.recordGateReport({ gate: "G4", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: "artifacts/apply.md" });
		expect(runtime.state?.frontier).toBe("G4-assurance");
	});

	it("requires refactor characterization evidence before reshape work", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Restructure parser without behavior change" });
		writeRoadmap(state, [{ id: "reshape", framework: "refactor" }]);
		passScope(runtime, state);
		const evidence = join(state.governanceRoot, "artifacts", "weak-characterization.md");
		writeFileSync(evidence, "# characterization\n- testCommand: npm test -- parser\n- testOutput: 1 passed\n", "utf8");
		expect(() => runtime.recordGateReport({ gate: "G0", actor: "implementer-1", role: "implementer", verdict: "pass", evidence: "artifacts/weak-characterization.md" })).toThrow("characterizationTests");
	});

	it("accepts model-paraphrased ROADMAP item headings and category aliases for G2", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "metis-performance-"));
		roots.push(agentDir);
		const runtime = new PerformanceRuntime(agentDir);
		const state = runtime.start({ kind: "start", mission: "Optimize README" });
		const loose = `# Performance roadmap
Run: ${state.runId}
**MISSION POINTER**: \`${join(state.governanceRoot, "PROMPTS.txt")}\` sha256=${state.missionSha256}; bytes=${state.missionBytes}
Run nonce: ${state.nonce}

## Scope profile
- Scope profile: bounded
## Repository intelligence
- Repository intelligence: TypeScript CLI package with Vitest
## Framework and tool decisions
- Framework/tool decisions: documentation via docs framework
## Items
- Items: DOC-01
- Stable item IDs: DOC-01
## Boundaries and dependencies
- Owned boundaries: README.md
- Dependencies: none
- Launch groups: Group 1
- Integration lane: docs-evolution
## Delivery contract
- Implementation steps: rewrite README against real CLI contracts
- Acceptance criteria: accurate install/CLI/API docs
- Unhappy paths: drifted snippets
- Tests-first steps: run node dist/cli.js --help
- Verification commands: npm test
- Coverage requirement: >=95% changed-line and touched-module coverage
- requiresDetailedPlan: false

### Item: \`DOC-01\`
- **category**: \`documentation\`
- **Tag**: none
- **Tier**: T1
- **Framework**: build-docs
- **Owned boundaries**: README.md
- **Dependencies**: none
- **Launch group**: Group 1
- **Integration lane**: docs-evolution
- **Implementation steps**: rewrite README against real CLI contracts
- **Acceptance criteria**: accurate install/CLI/API docs
- **Unhappy paths**: drifted snippets
- **Tests-first steps**: run node dist/cli.js --help
- **Verification commands**: npm test
- **requiresDetailedPlan**: false
`;
		writeFileSync(join(state.governanceRoot, "ROADMAP.md"), loose, "utf8");
		runtime.recordGateReport({ gate: "G2", actor: "scope-1", role: "scope-coordinator", verdict: "pass", evidence: receipt(state, "scope") });
		expect(runtime.state?.frontier).toBe("G2-assurance");
		expect(runtime.state?.roadmapItems).toEqual([
			expect.objectContaining({ id: "DOC-01", category: "docs", framework: "docs", tier: "T1" }),
		]);
	});
});
