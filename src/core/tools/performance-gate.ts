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

/**
 * Native control-plane tool for Build/Plan Performance runs (G0–G7 frontier).
 * Reliable-headless named children still omit this tool and emit ChildResult instead;
 * the root Build session keeps performance_gate so admission → gate advancement works.
 */
export function createPerformanceGateToolDefinition(options: PerformanceGateToolOptions): ToolDefinition<typeof performanceGateSchema> {
	return {
		name: "performance_gate",
		label: "Performance gate",
		description: "Advance the active Performance run frontier with a role-bound verdict and governance artifact receipt. Apply/T0 skips G0. Close G4 only after independent verification evidence is in the receipt, not a first-draft write. T0 G4 receipts need changedFiles, testCommand, testOutput, and exitCode: 0 or testStatus: pass (visualStatus: pass is enough for browser/screenshot checks). JSON keys are accepted. A failed or mismatched gate is not task success.",
		promptSnippet: "Record a role-bound gate verdict with its artifact receipt path",
		capabilities: { effect: "write", parallelSafe: false },
		parameters: performanceGateSchema,
		execute: async (_id, { gate, itemId, verdict, evidence }) => {
			const runtime = options.runtime?.();
			if (!runtime || !runtime.state) throw new Error("performance_gate requires an active Performance run.");
			const actor = options.actor?.() ?? { id: "root", role: "root" };
			runtime.recordGateReport({
				gate: gate as Exclude<PerformanceGate, "complete" | "blocked">,
				itemId,
				actor: actor.id,
				role: actor.role,
				verdict: verdict as PerformanceVerdict,
				evidence,
			});
			// Live run state rides this result instead of a per-turn context block.
			const live = runtime.liveStateSummary();
			const text = live
				? `Performance gate verdict recorded: ${gate}.\n${live}`
				: `Performance gate verdict recorded: ${gate}.`;
			return { content: [{ type: "text", text }], details: runtime.state };
		},
	};
}

export function createPerformanceGateTool(options: PerformanceGateToolOptions) {
	return wrapToolDefinition(createPerformanceGateToolDefinition(options));
}
