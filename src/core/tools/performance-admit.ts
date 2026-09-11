import { type Static, Type } from "typebox";
import { listPerformanceFrameworks } from "../performance-frameworks.ts";
import type { PerformanceAdmission, PerformanceRunState } from "../performance-runtime.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const nonEmptyStrings = (description: string) => Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description });
const frameworkIds = listPerformanceFrameworks().map((framework) => Type.Literal(framework.id));

const admissionLaneSchema = Type.Object({
	id: Type.String({ minLength: 1, description: "Stable lane identifier" }),
	objective: Type.String({ minLength: 1, description: "Concrete lane objective" }),
	framework: Type.Union(frameworkIds, { description: "Existing native framework id" }),
	ownedPaths: nonEmptyStrings("Exact files or directory roots owned by this lane"),
	deliverables: nonEmptyStrings("Observable lane deliverables"),
	acceptanceCriteria: nonEmptyStrings("Falsifiable lane acceptance criteria"),
	verificationCommands: nonEmptyStrings("Real commands that verify this lane"),
	dependsOn: Type.Array(Type.String({ minLength: 1 }), { description: "Lane ids that must complete first" }),
});

export const performanceAdmitSchema = Type.Object({
	tier: Type.Union([Type.Literal("T0"), Type.Literal("T1"), Type.Literal("T2"), Type.Literal("T3")]),
	taskShape: Type.Union([Type.Literal("bounded"), Type.Literal("sequential-complex"), Type.Literal("parallel")]),
	deliverables: nonEmptyStrings("Task-level observable deliverables"),
	acceptanceCriteria: nonEmptyStrings("Task-level falsifiable acceptance criteria"),
	verificationCommands: nonEmptyStrings("Task-level real verification commands"),
	sharedMutableState: Type.Boolean({ description: "Whether lanes would write shared mutable state" }),
	lanes: Type.Array(admissionLaneSchema, { minItems: 1 }),
});

export type PerformanceAdmitToolInput = Static<typeof performanceAdmitSchema>;

export interface PerformanceAdmitToolOptions {
	admit?: (input: PerformanceAdmission) => PerformanceRunState | Promise<PerformanceRunState>;
	context?: () => string | undefined;
}

function routeProtocol(state: PerformanceRunState): string {
	const tier = state.admission?.tier;
	const route = tier === "T0"
		? "root performs implementation and verification; spawn_agent forbidden"
		: tier === "T1"
			? "root performs G4; dispatch fresh G5 reviewer and G6 verifier in shared integrated cwd"
			: tier === "T2"
				? "execute dependency-ordered lanes serially in shared cwd; conditional G1, then G5/G6, one G7 juror, goal-check"
				: "parallelize only admitted disjoint implementation lanes; integrate before G5/G6/G7/sweep/goal-check";
	return `route protocol: ${route}. Canonical state: ${state.governanceRoot}/run.json; ROADMAP.md is a deterministic projection.`;
}

/** Deep admission seam: validates route once, then returns compact current-turn context. */
export function createPerformanceAdmitToolDefinition(
	options: PerformanceAdmitToolOptions = {},
): ToolDefinition<typeof performanceAdmitSchema> {
	return {
		name: "performance_admit",
		label: "Performance admission",
		description: "Classify a mutating Build task into T0-T3 and lock typed deliverables, lanes, ownership, and verification before execution.",
		promptSnippet: "Admit and route a Build task before any mutating, execution, planning, or subagent tool",
		capabilities: { effect: "write", parallelSafe: false },
		parameters: performanceAdmitSchema,
		executionMode: "sequential",
		execute: async (_id, input) => {
			if (!options.admit) throw new Error("performance_admit is unavailable in this runtime.");
			const state = await options.admit(input as PerformanceAdmission);
			const context = options.context?.() ?? `frontier: ${state.frontier}; route: ${state.admission?.tier}/${state.admission?.taskShape}.`;
			return {
				content: [{ type: "text", text: `Performance admission accepted.\n${context}\n${routeProtocol(state)}` }],
				details: state,
			};
		},
	};
}

export function createPerformanceAdmitTool(options: PerformanceAdmitToolOptions = {}) {
	return wrapToolDefinition(createPerformanceAdmitToolDefinition(options));
}
