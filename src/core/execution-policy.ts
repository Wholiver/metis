/**
 * Value-based short execution routing for reliable-headless.
 * Default: analyze → implement → verify → repair. No recursive fleet.
 */

import type { ExecutionPlan, ExecutionRequest, TaskContract, TaskKind } from "./execution-types.ts";

export interface PlanExecutionOptions {
	request: ExecutionRequest;
	contract: TaskContract;
}

export function planExecution(options: PlanExecutionOptions): ExecutionPlan {
	const { request, contract } = options;
	const text = request.instruction.toLowerCase();
	const uncertainty = /\b(design|architect|trade-?off|choose|decide|compare|multiple approaches)\b/.test(text);
	const multiLane = contract.requiredArtifacts.length > 1 && /\b(parallel|independent|disjoint)\b/.test(text);
	const mechanical = contract.checks.some((c) => c.authority === "bundled-public" || c.authority === "task")
		&& !uncertainty;

	const lanes = multiLane
		? contract.requiredArtifacts.map((artifact, index) => ({
				id: `lane-${index + 1}`,
				ownedPaths: [artifact.path],
				dependencies: [] as string[],
			}))
		: [{
				id: "lane-1",
				ownedPaths: contract.requiredArtifacts.map((a) => a.path).filter(Boolean).length > 0
					? contract.requiredArtifacts.map((a) => a.path)
					: ["."],
				dependencies: [] as string[],
			}];

	return {
		implementationOwner: mechanical ? "root" : "implementer",
		workspacePolicy: "shared",
		plannerRequired: uncertainty,
		verifierKind: contract.kind as TaskKind,
		independentLanes: lanes,
		maxRepairAttempts: 2,
		reviewerRequired: /\b(security|diff review|claim review|audit)\b/.test(text),
	};
}

export function describeExecutionPlan(plan: ExecutionPlan): string {
	const parts = [
		`owner=${plan.implementationOwner}`,
		`workspace=${plan.workspacePolicy}`,
		`planner=${plan.plannerRequired ? "yes" : "no"}`,
		`reviewer=${plan.reviewerRequired ? "yes" : "no"}`,
		`verifier=${plan.verifierKind}`,
		`lanes=${plan.independentLanes.length}`,
		`maxRepair=${plan.maxRepairAttempts}`,
	];
	return parts.join(" ");
}
