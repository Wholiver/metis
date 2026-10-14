import { BUILTIN_AGENTS } from "./agent-definition.ts";
import { EXECUTION_TIERS, PERFORMANCE_GATES } from "./performance-mode.ts";
import { listPerformanceFrameworks } from "./performance-frameworks.ts";
import type {
	HarnessDocument,
	HarnessEdge,
	HarnessFrameworkNodeData,
	HarnessGateNodeData,
	HarnessNode,
	HarnessRoleNodeData,
	HarnessTierNodeData,
} from "./harness-document.ts";

/**
 * Built-in Agent Harness seed.
 * Combines built-in tiers, frameworks, gates, roles, and delegations
 * into a single unified architecture graph document.
 */
function createBuiltinHarnessSeed(): HarnessDocument {
	const nodes: HarnessNode[] = [];
	const edges: HarnessEdge[] = [];

	// 1. Tiers (Column 1, x: 60)
	const tierConfigs: Array<{ id: string; name: string; description: string; y: number }> = [
		{
			id: "tier-fast-path",
			name: EXECUTION_TIERS.CONVERSATIONAL.name,
			description: EXECUTION_TIERS.CONVERSATIONAL.description,
			y: 80,
		},
		{
			id: "tier-t0",
			name: EXECUTION_TIERS.T0_MINIMAL.name,
			description: EXECUTION_TIERS.T0_MINIMAL.description,
			y: 260,
		},
		{
			id: "tier-t1",
			name: EXECUTION_TIERS.T1_STANDARD.name,
			description: EXECUTION_TIERS.T1_STANDARD.description,
			y: 520,
		},
		{
			id: "tier-t2",
			name: EXECUTION_TIERS.T2_COMPLEX.name,
			description: EXECUTION_TIERS.T2_COMPLEX.description,
			y: 860,
		},
		{
			id: "tier-t3",
			name: EXECUTION_TIERS.T3_MULTI_SURFACE.name,
			description: EXECUTION_TIERS.T3_MULTI_SURFACE.description,
			y: 1200,
		},
	];

	for (const t of tierConfigs) {
		const tierData: HarnessTierNodeData = {
			id: t.id,
			name: t.name,
			description: t.description,
		};
		nodes.push({
			id: t.id,
			type: "tier",
			data: tierData,
			position: { x: 60, y: t.y },
		});
	}

	// 2. 16 Frameworks arranged by tier in Column 2 (x: 420)
	const fwOrder = [
		"apply", "backend-fix", "frontend-fix", "docs", "polish",
		"backend-build", "backend-implement", "frontend-build", "frontend-implement",
		"frontend-review", "plan-design", "plan-research", "plan-scope", "refactor",
		"composition", "generation",
	];
	const fwOrderMap = new Map(fwOrder.map((id, index) => [id, index]));
	const frameworks = [...listPerformanceFrameworks()].sort(
		(a, b) => (fwOrderMap.get(a.id) ?? 99) - (fwOrderMap.get(b.id) ?? 99)
	);

	for (let i = 0; i < frameworks.length; i++) {
		const fw = frameworks[i];
		const fwData: HarnessFrameworkNodeData = {
			id: fw.id,
			name: fw.name,
			category: fw.category,
			tier: fw.tier,
			description: fw.description,
		};
		nodes.push({
			id: fw.id,
			type: "framework",
			data: fwData,
			position: { x: 420, y: 70 + i * 86 },
		});
	}

	// 3. Quality Gates (Column 3, x: 780)
	const gateConfigs: Array<{ id: string; name: string; invariant: string; y: number }> = [
		{ id: "G0", name: "Characterization & Baseline", invariant: "Prove the untouched baseline runs", y: 70 },
		{ id: "G1", name: PERFORMANCE_GATES.G1_PLANNING.name, invariant: PERFORMANCE_GATES.G1_PLANNING.invariant, y: 160 },
		{ id: "G2", name: PERFORMANCE_GATES.G2_SCOPE.name, invariant: PERFORMANCE_GATES.G2_SCOPE.invariant, y: 270 },
		{ id: "G3.5", name: PERFORMANCE_GATES.G3_DEPTH_LOCK.name, invariant: PERFORMANCE_GATES.G3_DEPTH_LOCK.invariant, y: 380 },
		{ id: "G4", name: PERFORMANCE_GATES.G4_IMPLEMENTATION.name, invariant: PERFORMANCE_GATES.G4_IMPLEMENTATION.invariant, y: 490 },
		{ id: "G5", name: PERFORMANCE_GATES.G5_REVIEW.name, invariant: PERFORMANCE_GATES.G5_REVIEW.invariant, y: 600 },
		{ id: "G6", name: PERFORMANCE_GATES.G6_VERIFICATION.name, invariant: PERFORMANCE_GATES.G6_VERIFICATION.invariant, y: 765 },
		{ id: "G7", name: PERFORMANCE_GATES.G7_SYNTHESIS.name, invariant: PERFORMANCE_GATES.G7_SYNTHESIS.invariant, y: 985 },
		{ id: "sweep", name: "Neighborhood / Convergence Sweep", invariant: "Audit sibling modules and verify convergence", y: 1150 },
		{ id: "goal-check", name: "Goal Check", invariant: "Confirm every mission ask on opened evidence", y: 1260 },
		{ id: "complete", name: "Completion", invariant: "Mission verified and run completed", y: 1370 },
	];

	for (const g of gateConfigs) {
		const gateData: HarnessGateNodeData = {
			id: g.id,
			name: g.name,
			invariant: g.invariant,
		};
		nodes.push({
			id: g.id,
			type: "gate",
			data: gateData,
			position: { x: 780, y: g.y },
		});
	}

	// 4. Roles: Column 4 for Gate Execution Roles (x: 1140), Column 5 for Orchestrators & Support Roles (x: 1520)
	const gateRolePositions: Record<string, number> = {
		planner: 160,
		scoper: 270,
		"depth-prober": 380,
		implementer: 490,
		reviewer: 600,
		verifier: 710,
		"fresh-verifier": 820,
		synthesizer: 930,
		juror: 1040,
		sweeper: 1150,
		"goal-checker": 1260,
	};

	const orchestratorOrder = [
		"coordinator", "scope-coordinator", "feature-coordinator", "sweep-coordinator", "manager",
		"architect", "researcher", "arbiter", "janitor", "scribe", "preflight-probe", "re-anchor",
		"intake", "framework-generator", "framework-validator", "execharness-resolver",
	];
	const orchestratorOrderMap = new Map(orchestratorOrder.map((id, index) => [id, index]));

	const agents = [...BUILTIN_AGENTS].sort((a, b) => {
		const isAGate = a.name in gateRolePositions;
		const isBGate = b.name in gateRolePositions;
		if (isAGate && !isBGate) return -1;
		if (!isAGate && isBGate) return 1;
		if (isAGate && isBGate) return (gateRolePositions[a.name] ?? 0) - (gateRolePositions[b.name] ?? 0);
		return (orchestratorOrderMap.get(a.name) ?? 99) - (orchestratorOrderMap.get(b.name) ?? 99);
	});

	let orchestratorIndex = 0;
	for (const agent of agents) {
		const roleData: HarnessRoleNodeData = {
			id: agent.name,
			name: agent.name,
			description: agent.description,
			systemPrompt: agent.systemPrompt,
			tools: agent.tools ? [...agent.tools] : undefined,
			model: agent.model,
			thinking: agent.thinking,
			maxSpawnDepth: agent.maxSpawnDepth,
		};

		const isGateRole = agent.name in gateRolePositions;
		const posX = isGateRole ? 1140 : 1520;
		const posY = isGateRole ? gateRolePositions[agent.name]! : 70 + orchestratorIndex++ * 110;

		nodes.push({
			id: agent.name,
			type: "role",
			data: roleData,
			position: { x: posX, y: posY },
		});
	}

	// 5. Edges
	let edgeCounter = 1;
	const addEdge = (source: string, target: string, type: string, order?: number) => {
		edges.push({
			id: `e-${edgeCounter++}`,
			source,
			target,
			type,
			order,
		});
	};

	// 5.1 Tier -> Framework edges
	addEdge("tier-fast-path", "complete", "tier-gate");
	addEdge("tier-t0", "apply", "tier-framework");
	addEdge("tier-t1", "apply", "tier-framework");
	addEdge("tier-t1", "backend-fix", "tier-framework");
	addEdge("tier-t1", "frontend-fix", "tier-framework");
	addEdge("tier-t1", "docs", "tier-framework");
	addEdge("tier-t1", "polish", "tier-framework");

	addEdge("tier-t2", "backend-build", "tier-framework");
	addEdge("tier-t2", "backend-implement", "tier-framework");
	addEdge("tier-t2", "frontend-build", "tier-framework");
	addEdge("tier-t2", "frontend-implement", "tier-framework");
	addEdge("tier-t2", "frontend-review", "tier-framework");
	addEdge("tier-t2", "plan-design", "tier-framework");
	addEdge("tier-t2", "plan-research", "tier-framework");
	addEdge("tier-t2", "plan-scope", "tier-framework");
	addEdge("tier-t2", "refactor", "tier-framework");

	addEdge("tier-t3", "composition", "tier-framework");
	addEdge("tier-t3", "generation", "tier-framework");

	// 5.2 Framework -> Gate ordered sequences
	const frameworkGatePaths: Record<string, string[]> = {
		apply: ["G4", "G5", "G6", "complete"],
		"backend-build": ["G4", "G5", "G6", "G7", "goal-check", "complete"],
		"backend-fix": ["G1", "G3.5", "G4", "G5", "G6", "goal-check", "complete"],
		"backend-implement": ["G4", "G5", "G6", "G7", "goal-check", "complete"],
		composition: ["G2", "G4", "G5", "G6", "sweep", "goal-check", "complete"],
		docs: ["G4", "G5", "G6", "goal-check", "complete"],
		"frontend-build": ["G4", "G5", "G6", "G7", "goal-check", "complete"],
		"frontend-fix": ["G1", "G3.5", "G4", "G5", "G6", "goal-check", "complete"],
		"frontend-implement": ["G4", "G5", "G6", "G7", "goal-check", "complete"],
		"frontend-review": ["G5", "G6", "goal-check", "complete"],
		generation: ["G1", "G4", "G5", "G6", "complete"],
		"plan-design": ["G1", "G2", "complete"],
		"plan-research": ["G1", "complete"],
		"plan-scope": ["G2", "complete"],
		polish: ["G4", "G5", "G6", "G7", "complete"],
		refactor: ["G1", "G4", "G5", "G6", "goal-check", "complete"],
	};

	for (const [fwId, gateSeq] of Object.entries(frameworkGatePaths)) {
		for (let idx = 0; idx < gateSeq.length; idx++) {
			addEdge(fwId, gateSeq[idx], "framework-gate", idx + 1);
		}
	}

	// 5.3 Gate -> Role edges
	const gateRoleAssignments: Record<string, string[]> = {
		G1: ["planner"],
		G2: ["scoper", "scope-coordinator"],
		"G3.5": ["depth-prober"],
		G4: ["implementer"],
		G5: ["reviewer"],
		G6: ["verifier", "fresh-verifier"],
		G7: ["juror", "synthesizer"],
		sweep: ["sweeper", "sweep-coordinator"],
		"goal-check": ["goal-checker"],
	};

	for (const [gateId, roles] of Object.entries(gateRoleAssignments)) {
		for (const roleName of roles) {
			addEdge(gateId, roleName, "gate-role");
		}
	}

	// 5.4 Role -> Role delegation edges
	const roleDelegations: Array<[string, string]> = [
		["coordinator", "planner"],
		["coordinator", "implementer"],
		["coordinator", "reviewer"],
		["coordinator", "verifier"],
		["coordinator", "depth-prober"],
		["coordinator", "juror"],
		["coordinator", "goal-checker"],
		["scope-coordinator", "feature-coordinator"],
		["scope-coordinator", "sweep-coordinator"],
		["scope-coordinator", "manager"],
		["feature-coordinator", "manager"],
		["sweep-coordinator", "sweeper"],
		["manager", "planner"],
		["manager", "implementer"],
		["manager", "reviewer"],
		["manager", "verifier"],
		["manager", "sweeper"],
		["manager", "researcher"],
		["manager", "scoper"],
		["manager", "synthesizer"],
		["implementer", "fresh-verifier"],
		["implementer", "depth-prober"],
	];

	for (const [parent, child] of roleDelegations) {
		addEdge(parent, child, "role-delegation");
	}

	return {
		version: 1,
		nodes,
		edges,
		metadata: {
			createdAt: new Date().toISOString(),
			description: "Metis built-in agent harness seed graph",
		},
	};
}

let cachedSeed: HarnessDocument | undefined;

/**
 * Returns a fresh, detached clone of the built-in Harness document seed.
 */
export function getBuiltinHarness(): HarnessDocument {
	if (!cachedSeed) {
		cachedSeed = createBuiltinHarnessSeed();
	}
	return structuredClone(cachedSeed);
}
