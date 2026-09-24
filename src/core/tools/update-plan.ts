import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { WorkflowPlanState, WorkflowPlanStatus, WorkflowPlanStep } from "../workflow-runtime.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const updatePlanSchema = Type.Object({
	explanation: Type.Optional(
		Type.String({
			description:
				"Optional concise note about what changed in this plan, written in the same language as the user's latest message.",
		}),
	),
	plan: Type.Array(
		Type.Object({
			step: Type.String({
				description:
					"Concise implementation or verification step in the same language as the user's latest message.",
			}),
			status: Type.Union(
				[Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
				{ description: "pending, in_progress, or completed. Use completed when the step is done." },
			),
		}),
		{ minItems: 1, description: "Full ordered checklist. At most one step may be in_progress." },
	),
});

export type UpdatePlanToolInput = Static<typeof updatePlanSchema>;

export interface UpdatePlanToolOptions {
	onUpdate?: (plan: Omit<WorkflowPlanState, "updatedAt">) => void;
	unfinishedRunWarning?: () => string | undefined;
}

const PLAN_STATUS_ALIASES: Record<string, WorkflowPlanStatus> = {
	pending: "pending",
	todo: "pending",
	to_do: "pending",
	open: "pending",
	in_progress: "in_progress",
	inprogress: "in_progress",
	doing: "in_progress",
	active: "in_progress",
	working: "in_progress",
	running: "in_progress",
	started: "in_progress",
	completed: "completed",
	complete: "completed",
	done: "completed",
	finished: "completed",
	checked: "completed",
};

function canonicalizePlanStatus(status: unknown): unknown {
	if (typeof status !== "string") return status;
	const key = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
	return PLAN_STATUS_ALIASES[key] ?? status;
}

/** Fold common model aliases (done, complete, in-progress) before schema validation. */
export function prepareUpdatePlanArguments(input: unknown): UpdatePlanToolInput {
	if (!input || typeof input !== "object") {
		return input as UpdatePlanToolInput;
	}
	const args = input as Record<string, unknown>;
	if (!Array.isArray(args.plan)) {
		return input as UpdatePlanToolInput;
	}

	let changed = false;
	const plan = args.plan.map((item) => {
		if (!item || typeof item !== "object") return item;
		const current = item as { status?: unknown };
		const status = canonicalizePlanStatus(current.status);
		if (status === current.status) return item;
		changed = true;
		return { ...current, status };
	});
	return (changed ? { ...args, plan } : input) as UpdatePlanToolInput;
}

export function createUpdatePlanToolDefinition(options: UpdatePlanToolOptions = {}): ToolDefinition<typeof updatePlanSchema> {
	return {
		name: "update_plan",
		label: "Update plan",
		description:
			"Create or refresh this session's execution checklist without writing workspace files. Call again whenever a step starts or finishes so the visible list stays current. Each step status must be pending, in_progress, or completed; at most one step may be in_progress.",
		promptSnippet: "Keep the session execution checklist current as steps start and finish",
		promptGuidelines: [
			"Call update_plan when a step starts or finishes; do not wait until the whole task ends.",
			"Use status pending, in_progress, or completed only. Mark exactly one current step in_progress.",
			"Write each step and explanation in the same language as the user's latest message.",
			"Never mark every step completed while a Performance run is still active; close the required performance_gate first.",
		],
		capabilities: { effect: "write", parallelSafe: false },
		parameters: updatePlanSchema,
		prepareArguments: prepareUpdatePlanArguments,
		execute: async (_id, { explanation, plan }) => {
			if (plan.filter((item) => item.status === "in_progress").length > 1) {
				throw new Error("update_plan accepts at most one in_progress step.");
			}
			const unfinished = plan.every((item) => item.status === "completed")
				? options.unfinishedRunWarning?.()
				: undefined;
			if (unfinished) {
				throw new Error(unfinished);
			}
			options.onUpdate?.({ explanation, plan: plan as WorkflowPlanStep[] });
			return { content: [{ type: "text", text: "Plan state updated for this session." }], details: undefined };
		},
	};
}

export function createUpdatePlanTool(options?: UpdatePlanToolOptions) {
	return wrapToolDefinition(createUpdatePlanToolDefinition(options));
}
