import { type Static, Type } from "typebox";
import type { PerformanceGate, PerformanceRuntime, PerformanceVerdict } from "../performance-runtime.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const performanceGateSchema = Type.Object({
	gate: Type.Union([
		Type.Literal("G0"), Type.Literal("G1"), Type.Literal("G1-review"), Type.Literal("G1-verify"), Type.Literal("G2"), Type.Literal("G2-review"), Type.Literal("G2-verify"),
		Type.Literal("G3.5"), Type.Literal("G4"), Type.Literal("G5"), Type.Literal("G6"), Type.Literal("G7"), Type.Literal("sweep"), Type.Literal("goal-check"),
	]),
	itemId: Type.Optional(Type.String({ minLength: 1, description: "Stable ROADMAP.md item ID; omit only for run-wide G2 scope evidence." })),
	verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("blocked")]),
	evidence: Type.String({ minLength: 1, description: "Relative non-empty receipt path under the active run's artifacts/ directory" }),
});

export type PerformanceGateToolInput = Static<typeof performanceGateSchema>;
export interface PerformanceGateToolOptions {
	runtime?: () => PerformanceRuntime;
	actor?: () => { id: string; role: string };
}

/** Native control-plane tool; writes only the external Performance governance root. */
export function createPerformanceGateToolDefinition(options: PerformanceGateToolOptions): ToolDefinition<typeof performanceGateSchema> {
	return {
		name: "performance_gate",
		label: "Performance gate",
		description: "Advance the active Performance run frontier with a role-bound verdict and governance artifact receipt.",
		promptSnippet: "Record a role-bound gate verdict with its artifact receipt path",
		capabilities: { effect: "write", parallelSafe: false },
		parameters: performanceGateSchema,
		execute: async (_id, { gate, itemId, verdict, evidence }) => {
			const runtime = options.runtime?.();
			if (!runtime || !runtime.state) throw new Error("performance_gate requires an active Performance run.");
			const actor = options.actor?.() ?? { id: "root", role: "root" };
			runtime.recordGateReport({ gate: gate as Exclude<PerformanceGate, "complete" | "blocked">, itemId, actor: actor.id, role: actor.role, verdict: verdict as PerformanceVerdict, evidence });
			return { content: [{ type: "text", text: `Performance gate verdict recorded: ${gate}.` }], details: runtime.state };
		},
	};
}

export function createPerformanceGateTool(options: PerformanceGateToolOptions) {
	return wrapToolDefinition(createPerformanceGateToolDefinition(options));
}
