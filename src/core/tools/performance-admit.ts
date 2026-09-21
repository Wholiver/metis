import { type Static, Type } from "typebox";
import { listPerformanceFrameworks } from "../performance-frameworks.ts";
import type { PerformanceAdmission, PerformanceRunState } from "../performance-runtime.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: [...values],
		description,
	});
}

const nonEmptyStrings = (description: string) => Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description });
const FRAMEWORK_IDS = listPerformanceFrameworks().map((framework) => framework.id);

const admissionLaneSchema = Type.Object({
	id: Type.String({ minLength: 1, description: "Stable lane identifier" }),
	objective: Type.String({ minLength: 1, description: "Concrete lane objective" }),
	framework: stringEnum(
		FRAMEWORK_IDS as [string, ...string[]],
		"Native framework id. Enumerated on this field. Do not search the workspace for values. README / markdown docs use docs; a fully specified one-shot artifact uses apply.",
	),
	ownedPaths: nonEmptyStrings("Exact files or directory roots owned by this lane"),
	deliverables: nonEmptyStrings("Observable lane deliverables"),
	acceptanceCriteria: nonEmptyStrings("Falsifiable lane acceptance criteria"),
	verificationCommands: nonEmptyStrings("Real commands that verify this lane"),
	dependsOn: Type.Array(Type.String({ minLength: 1 }), { description: "Lane ids that must complete first" }),
});

export const performanceAdmitSchema = Type.Object({
	tier: stringEnum(["T0", "T1", "T2", "T3"], "T0 for a single bounded artifact such as a README. Do not invent other tier names."),
	taskShape: stringEnum(
		["bounded", "sequential-complex", "parallel"],
		"bounded for one-shot artifacts; sequential-complex for ordered multi-step work; parallel only for disjoint lanes. Never discrete, generic, or custom.",
	),
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
		? "root performs implementation, independent checks, then G4; spawn_agent forbidden"
		: tier === "T1"
			? "root performs G4; dispatch fresh G5 reviewer and G6 verifier in shared integrated cwd"
			: tier === "T2"
				? "execute dependency-ordered lanes serially in shared cwd; conditional G1, then G5/G6, one G7 juror, goal-check"
				: "parallelize only admitted disjoint implementation lanes; integrate before G5/G6/G7/sweep/goal-check";
	const coerced = state.admission?.tierCoercedFrom
		? ` Coerced from ${state.admission.tierCoercedFrom} to T0 for single-lane artifact apply/docs/polish.`
		: "";
	return `route protocol: ${route}.${coerced} Canonical state: ${state.governanceRoot}/run.json; ROADMAP.md is a deterministic projection.`;
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
		promptGuidelines: [
			"Do not grep, read, or query memory/session logs to discover performance_admit values. taskShape is bounded, sequential-complex, or parallel. framework is a native id such as docs, apply, polish, or backend-fix. Creating a README is T0 + bounded + one docs lane; after admit still independent check + repair, then G4 — a first-draft write is not done.",
		],
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
