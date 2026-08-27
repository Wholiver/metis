import { describe, expect, test } from "vitest";
import {
	BUILTIN_AGENTS,
	BUILTIN_COORDINATOR,
	BUILTIN_IMPLEMENTER,
	BUILTIN_PLANNER,
	BUILTIN_REVIEWER,
	BUILTIN_VERIFIER,
	BUILTIN_DEPTH_PROBER,
	BUILTIN_FRESH_VERIFIER,
	BUILTIN_GOAL_CHECKER,
	BUILTIN_ARBITER,
	BUILTIN_FRAMEWORK_GENERATOR,
	BUILTIN_FRAMEWORK_VALIDATOR,
	BUILTIN_EXECHARNESS_RESOLVER,
	AgentRegistry,
	loadAgents,
} from "../src/core/agent-definition.ts";
import {
	ALL_PERFORMANCE_FRAMEWORKS,
	getPerformanceFramework,
	listPerformanceFrameworks,
	searchFrameworksByCategory,
} from "../src/core/performance-frameworks.ts";
import {
	isPerformanceModeActive,
	EXECUTION_TIERS,
	NEGATIVE_ROUTING_PROTOCOLS,
	PERFORMANCE_GATES,
} from "../src/core/performance-mode.ts";
import { buildSystemPrompt, DEFAULT_BASE_INSTRUCTIONS } from "../src/core/system-prompt.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("Performance Mode Engine & Fidelity", () => {
	test("performance framework corpus remains inert until a task starts the runtime", () => {
		expect(isPerformanceModeActive()).toBe(false);
	});

	test("built-in roles bind to the native run contract, not a missing marker or Skill", () => {
		for (const agent of BUILTIN_AGENTS) {
			expect(agent.systemPrompt).not.toContain("performance-mode-RUN-MARKER");
			expect(agent.systemPrompt).not.toContain("performance-mode skill");
		}
	});

	test("contains all 16 domain execution frameworks with unabridged operational protocols", () => {
		const frameworks = listPerformanceFrameworks();
		expect(frameworks.length).toBe(16);
		expect(ALL_PERFORMANCE_FRAMEWORKS.length).toBe(16);

		const expectedIds = [
			"apply",
			"backend-build",
			"backend-fix",
			"backend-implement",
			"composition",
			"docs",
			"frontend-build",
			"frontend-fix",
			"frontend-implement",
			"frontend-review",
			"generation",
			"plan-design",
			"plan-research",
			"plan-scope",
			"polish",
			"refactor",
		];

		for (const id of expectedIds) {
			const fw = getPerformanceFramework(id);
			expect(fw, `Framework ${id} should exist`).toBeDefined();
			expect(fw?.content).toBeTruthy();
			expect(fw?.content.length).toBeGreaterThan(500);
			expect(fw?.name).toBeTruthy();
			expect(fw?.category).toBeTruthy();
			expect(fw?.tier).toBeTruthy();
		}

		// Check search by category
		const backendFws = searchFrameworksByCategory("backend");
		expect(backendFws.length).toBeGreaterThanOrEqual(3);
		expect(backendFws.map((f) => f.id)).toContain("backend-fix");
		expect(backendFws.map((f) => f.id)).toContain("backend-implement");
	});

	test("frameworks contain gate paths, layer flows, and admission checks", () => {
		const applyFw = getPerformanceFramework("apply");
		expect(applyFw?.content).toContain("GATE PATH");
		expect(applyFw?.content).toContain("ADMISSION CHECK");

		const backendFixFw = getPerformanceFramework("backend-fix");
		expect(backendFixFw?.content).toContain("GATE PATH");
		expect(backendFixFw?.content).toContain("DEPTH-LOCK");
	});

	test("quality gates cover G1 through G7 with two-sided oracle invariants", () => {
		expect(PERFORMANCE_GATES.G1_PLANNING.gate).toBe("G1");
		expect(PERFORMANCE_GATES.G2_SCOPE.gate).toBe("G2");
		expect(PERFORMANCE_GATES.G3_DEPTH_LOCK.gate).toBe("G3.5");
		expect(PERFORMANCE_GATES.G4_IMPLEMENTATION.gate).toBe("G4");
		expect(PERFORMANCE_GATES.G5_REVIEW.gate).toBe("G5");
		expect(PERFORMANCE_GATES.G6_VERIFICATION.gate).toBe("G6");
		expect(PERFORMANCE_GATES.G7_SYNTHESIS.gate).toBe("G7");

		expect(PERFORMANCE_GATES.G6_VERIFICATION.invariant).toContain("fail-to-pass");
		expect(PERFORMANCE_GATES.G6_VERIFICATION.invariant).toContain("pass-to-pass");
	});

	test("execution tiers T0-T3 and negative routing protocols S1-S4 are defined", () => {
		expect(EXECUTION_TIERS.T0_MINIMAL.tier).toBe("T0");
		expect(EXECUTION_TIERS.T1_STANDARD.tier).toBe("T1");
		expect(EXECUTION_TIERS.T2_COMPLEX.tier).toBe("T2");
		expect(EXECUTION_TIERS.T3_MULTI_SURFACE.tier).toBe("T3");

		expect(NEGATIVE_ROUTING_PROTOCOLS.S1_BLOCKED).toContain("BLOCKED");
		expect(NEGATIVE_ROUTING_PROTOCOLS.S2_INELIGIBLE).toContain("heavier framework");
		expect(NEGATIVE_ROUTING_PROTOCOLS.S3_FLAW_BACKTRACK).toContain("loop back");
		expect(NEGATIVE_ROUTING_PROTOCOLS.S4_ORACLE_FAILURE).toContain("repair");
	});

	test("contains all 26 built-in personas with complete prompt contracts and tool boundaries", () => {
		expect(BUILTIN_AGENTS.length).toBe(26);

		const agentNames = BUILTIN_AGENTS.map((a) => a.name);
		const requiredPersonas = [
			"coordinator",
			"planner",
			"implementer",
			"reviewer",
			"verifier",
			"scope-coordinator",
			"feature-coordinator",
			"depth-prober",
			"fresh-verifier",
			"goal-checker",
			"arbiter",
			"framework-generator",
			"framework-validator",
			"execharness-resolver",
			"researcher",
			"scoper",
			"scribe",
			"sweep-coordinator",
			"sweeper",
			"synthesizer",
			"janitor",
			"juror",
			"manager",
			"preflight-probe",
			"re-anchor",
			"intake",
		];

		for (const name of requiredPersonas) {
			expect(agentNames, `Agent ${name} should be in BUILTIN_AGENTS`).toContain(name);
		}

		// Check tool boundaries
		expect(BUILTIN_PLANNER.tools).not.toContain("write");
		expect(BUILTIN_PLANNER.tools).not.toContain("edit");
		expect(BUILTIN_PLANNER.tools).not.toContain("spawn_agent");
		expect(BUILTIN_IMPLEMENTER.tools).toContain("write");
		expect(BUILTIN_IMPLEMENTER.tools).toContain("edit");
		expect(BUILTIN_IMPLEMENTER.tools).not.toContain("spawn_agent");
		expect(BUILTIN_COORDINATOR.tools).toContain("spawn_agent");

		// Check prompt substance
		expect(BUILTIN_DEPTH_PROBER.systemPrompt.length).toBeGreaterThan(100);
		expect(BUILTIN_FRESH_VERIFIER.systemPrompt.length).toBeGreaterThan(100);
		expect(BUILTIN_ARBITER.systemPrompt.length).toBeGreaterThan(100);
	});

	test("does not inject performance instructions into ordinary system prompts", () => {
		expect(DEFAULT_BASE_INSTRUCTIONS).not.toContain("Performance Engine");
		expect(DEFAULT_BASE_INSTRUCTIONS).not.toContain("G1 Plan");

		const prompt = buildSystemPrompt({
			cwd: "/test/workspace",
			selectedTools: ["read", "write", "bash"],
		});

		expect(prompt).not.toContain("Performance Engine");
		expect(prompt).not.toContain("G1 Plan");
		expect(prompt).not.toContain("T0 (Apply)");
	});

	test("live AgentSession exposes built-in roles without globally activating performance orchestration", async () => {
		const { session } = await createAgentSession({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			sessionManager: SessionManager.inMemory(),
		});

		expect(session.systemPrompt).not.toContain("Performance Engine");

		// Check registered agents on the session
		const sessionAgents = session.resourceLoader.getAgents().agents;
		expect(sessionAgents.length).toBeGreaterThanOrEqual(26);
		expect(sessionAgents.some((a) => a.name === "depth-prober")).toBe(true);
		expect(sessionAgents.some((a) => a.name === "fresh-verifier")).toBe(true);
		expect(sessionAgents.some((a) => a.name === "arbiter")).toBe(true);
	});
});

