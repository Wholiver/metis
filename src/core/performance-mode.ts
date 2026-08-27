/**
 * Metis Performance Mode Engine
 *
 * Implements native closed-loop orchestration, quality gate verification (G1-G7),
 * dynamic stage backtracking, adaptive workflow tiers (T0-T3), L0-L4 hierarchy,
 * two-sided oracle verification (fail-to-pass ∧ pass-to-pass), and test-driven execution.
 */

import { listPerformanceFrameworks, type PerformanceFramework } from "./performance-frameworks.ts";

export function isPerformanceModeActive(): boolean {
	return Boolean(process.env.METIS_PERFORMANCE_RUN_ID);
}

/**
 * Authoritative Gate Contracts (G1 - G7)
 */
export const PERFORMANCE_GATES = {
	G1_PLANNING: {
		gate: "G1",
		name: "Architectural Planning & Depth Analysis",
		invariant: "Inspect codebase, trace dependencies, and produce an actionable phased plan before mutating files. Conditional: required for debug/depth-lock, explicit design forks, or worker plan conflicts.",
	},
	G2_SCOPE: {
		gate: "G2",
		name: "Executable Scope Roadmap",
		invariant: "ROADMAP.md is the sole scope/decomposition source. Produce canonical roadmap with disjoint boundaries, acceptance criteria, real verification commands, and >=95% changed-line test coverage bar.",
	},
	G3_DEPTH_LOCK: {
		gate: "G3.5",
		name: "Defect Depth-Lock",
		invariant: "Independently derive root cause function from defect description alone, blind to proposed fix layer. Depth-miss rejects back to G1 planning.",
	},
	G4_IMPLEMENTATION: {
		gate: "G4",
		name: "Test-Driven Implementation",
		invariant: "Write minimal focused changes within owned boundaries. Construct reproduction tests first (TDD). Touch only owned paths.",
	},
	G5_REVIEW: {
		gate: "G5",
		name: "Independent Code Review",
		invariant: "Mandatory author-independent review. Audit diff against real repository for correctness, security, style, and regression risk. Negative verdicts (CHANGES_REQUESTED) loop up to implementation or planning.",
	},
	G6_VERIFICATION: {
		gate: "G6",
		name: "Two-Sided Oracle Verification (failToPass ∧ passToPass)",
		invariant: "Execute real fail-to-pass tests (confirming RED -> GREEN) AND pass-to-pass test suite (confirming unchanged behavior stays GREEN). Never accept unverified claims or fake mocks.",
	},
	G7_SYNTHESIS: {
		gate: "G7",
		name: "Evidence Synthesis & Delivery",
		invariant: "Deliver structured final outcome citing concrete test execution proofs, command outputs, exit codes, and remaining risks.",
	},
} as const;

/**
 * Execution Tiers (Phase 0 Triage / T0 - T3)
 */
export const EXECUTION_TIERS = {
	CONVERSATIONAL: {
		tier: "FAST_PATH",
		name: "Conversational / Direct Q&A",
		description: "Greetings, chit-chat, conceptual questions, or inquiries with no code mutation requested.",
		path: "DIRECT_TEXT_RESPONSE (No tools, no subagents, no GATELOG/ROADMAP)",
	},
	T0_MINIMAL: {
		tier: "T0",
		name: "Minimal / Mechanical Apply",
		description: "Mechanical apply or single command where WHAT is 100% specified and zero design decisions remain.",
		path: "APPLY -> DIFF-REVIEW -> VERIFY-GREEN",
	},
	T1_STANDARD: {
		tier: "T1",
		name: "Standard Feature / Bugfix",
		description: "Focused single-surface feature or bugfix with reproduction test first.",
		path: "PLAN (optional) -> G4 IMPLEMENT (TDD) -> G5 REVIEW -> G6 VERIFY-ORACLE",
	},
	T2_COMPLEX: {
		tier: "T2",
		name: "Complex Architectural / Multi-Phase",
		description: "Multi-step architectural implementation, refactoring, or multi-component enhancement.",
		path: "G2 ROADMAP -> G1 PLAN -> G4 IMPLEMENT -> G5 REVIEW -> G6 VERIFY -> G7 SYNTHESIS",
	},
	T3_MULTI_SURFACE: {
		tier: "T3",
		name: "Multi-Surface / Fleet Scope",
		description: "Large disjoint multi-surface mission dispatched across parallel coordinated lanes.",
		path: "L1 SCOPE-COORDINATOR -> L1 FEATURE-COORDINATOR -> L2 MANAGER -> L3/L4 WORKERS -> L1 SWEEP-COORDINATOR",
	},
} as const;

/**
 * Negative Verdict Loop-Up Routing Protocols (S1 - S4)
 */
export const NEGATIVE_ROUTING_PROTOCOLS = {
	S1_BLOCKED: "When untouched baseline tests fail or environment is broken, halt with BLOCKED instead of attempting blind work.",
	S2_INELIGIBLE: "When an admission requirement is violated (e.g. design decision needed on apply framework), escalate to heavier framework.",
	S3_FLAW_BACKTRACK: "When code review or depth-probe finds flaws, loop back to implementation with numbered issues (or planning for architectural bugs).",
	S4_ORACLE_FAILURE: "When reproduction fails to flip RED->GREEN or existing tests regress, loop back to repair with exact failure trace.",
} as const;

/**
 * Native Performance Mode Base System Prompt Instructions
 */
export const PERFORMANCE_MODE_INSTRUCTIONS = `
## Performance Engine
- Phase 0 Admission: Direct text response for greetings/conversational questions (zero subagents, zero GATELOG/ROADMAP).
- Gates (G1-G7): G1 Plan (trace graphs) -> G2 Roadmap -> G3.5 Depth-Lock (root cause) -> G4 TDD -> G5 Review -> G6 Two-Sided Oracle (\`fail-to-pass\` RED->GREEN ∧ \`pass-to-pass\` GREEN) -> G7 Proof.
- Flow: T0 (Apply) / T1 (TDD) / T2 (Complex) / T3 (Fleet). Flattened dispatch for T0/T1; wave coordination with immediate convergence for T2/T3. Backtrack on S3 review / S4 oracle failure (max 3 loops, >=95% coverage floor).
- Roles: Primary Agent (Build=direct tools; Plan=read-only). Subagents (\`spawn_agent\`): \`coordinator\` (dispatch), \`planner\` (G1 planning), \`implementer\` (G4 code/tests), \`reviewer\` (G2/G5 review), \`verifier\` (G6 verification), and specialized personas (\`scope-coordinator\`, \`feature-coordinator\`, \`depth-prober\`, \`fresh-verifier\`, \`goal-checker\`, \`arbiter\`, \`execharness-resolver\`, \`sweeper\`, \`juror\`, etc.).
`.trim();
