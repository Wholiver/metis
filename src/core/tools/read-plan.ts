import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { PerformanceRuntime } from "../performance-runtime.ts";
import { resolveWorkflowPlan, resolveWorkflowProposal } from "../workflow-runtime.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export interface ReadPlanToolOptions {
	/** Reports the active Performance run's live state, which is not in the cached prefix. */
	runtime?: () => PerformanceRuntime | undefined;
}

const readPlanSchema = Type.Object({});
export function createReadPlanToolDefinition(options?: ReadPlanToolOptions): ToolDefinition<typeof readPlanSchema> {
	return {
		name: "read_plan", label: "Read plan", description: "Read the latest durable proposal and current Build execution checklist for this session branch.",
		promptSnippet: "Read latest durable proposal and execution progress", capabilities: { effect: "read", parallelSafe: true }, parameters: readPlanSchema,
		execute: async (_id, _input, signal, _update, ctx) => {
			if (signal?.aborted) throw new Error("Operation aborted");
			const branch = ctx.sessionManager.getBranch();
			const proposal = resolveWorkflowProposal(branch);
			const executionPlan = resolveWorkflowPlan(branch);
			const content = [{ type: "text" as const, text: proposal?.markdown ?? "No durable proposed plan is available for this branch." }];
			if (executionPlan) {
				const progress = executionPlan.legacyMarkdown
					?? [
						executionPlan.phase === "reading_proposal" ? "Status: reading approved proposal" : undefined,
						executionPlan.phase === "creating_checklist" ? "Status: creating execution checklist" : undefined,
						executionPlan.explanation,
						...executionPlan.plan.map((item) => `- [${item.status === "completed" ? "x" : " "}] (${item.status}) ${item.step}`),
					].filter(Boolean).join("\n");
				content.push({ type: "text", text: `Current execution checklist (updated ${executionPlan.updatedAt}):\n${progress}` });
			}
			// Performance live state is deliberately absent from the cached request prefix,
			// so this read is the model's way to refresh frontier / active item on demand.
			const live = options?.runtime?.()?.liveStateSummary();
			if (live) content.push({ type: "text", text: `Performance run live state:\n${live}` });
			return { content, details: { proposal, executionPlan } };
		},
	};
}
export function createReadPlanTool(options?: ReadPlanToolOptions) { return wrapToolDefinition(createReadPlanToolDefinition(options)); }

