import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { WorkflowPlanState, WorkflowPlanStep } from "../workflow-runtime.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const updatePlanSchema = Type.Object({
	explanation: Type.Optional(Type.String({ description: "Optional concise note about what changed in this plan." })),
	plan: Type.Array(
		Type.Object({
			step: Type.String({ description: "Concise implementation or verification step." }),
			status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
		}),
		{ minItems: 1, description: "Ordered plan steps. At most one step may be in_progress." },
	),
});

export type UpdatePlanToolInput = Static<typeof updatePlanSchema>;

export interface UpdatePlanToolOptions {
	onUpdate?: (plan: Omit<WorkflowPlanState, "updatedAt">) => void;
}

export function createUpdatePlanToolDefinition(options: UpdatePlanToolOptions = {}): ToolDefinition<typeof updatePlanSchema> {
	return {
		name: "update_plan",
		label: "Update plan",
		description: "Store concise task plan state for this session without writing workspace files.",
		promptSnippet: "Store concise session plan state without editing files",
		capabilities: { effect: "write", parallelSafe: false },
		parameters: updatePlanSchema,
		execute: async (_id, { explanation, plan }) => {
			if (plan.filter((item) => item.status === "in_progress").length > 1) {
				throw new Error("update_plan accepts at most one in_progress step.");
			}
			options.onUpdate?.({ explanation, plan: plan as WorkflowPlanStep[] });
			return { content: [{ type: "text", text: "Plan state updated for this session." }], details: undefined };
		},
	};
}

export function createUpdatePlanTool(options?: UpdatePlanToolOptions) {
	return wrapToolDefinition(createUpdatePlanToolDefinition(options));
}

