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

/** Clean accidental runtime/governance jargon from step text for a clean UI presentation. */
export function cleanPlanStepText(step: string): string {
	let text = step;
	// Strip leading lane marker: e.g. "车道 I1-scaffold:", "Lane I2:"
	text = text.replace(/^(?:车道|Lane)\s+[A-Za-z0-9_.-]+[:：]\s*/i, "");
	// Strip trailing/inline gate remarks: e.g. "(G4-G7 全过)", "(G4-G7全过)", "(G4全过)", "(G0-G7全部通过)"
	text = text.replace(/\s*\([A-Za-z0-9_.-]*\s*(?:G[0-7](?:[-~至到G\d\s]*全过|[^)]*)|(?:G[0-7]|全部门禁)[^)]*)\)/gi, "");
	// Strip leading gate prefixes: e.g. "G7 独立评审席对...做最终签署" -> "整合后工作区做最终签署", "goal-check 目标核验..." -> "目标核验..."
	text = text.replace(/^G[0-7](?:\.[0-9]+)?\s*(?:独立评审席)?[:：\s]*/i, "");
	text = text.replace(/^对(?=[\u4e00-\u9fa5])/, "");
	text = text.replace(/^goal-check\s*[:：\s]*/i, "");
	return text.trim() || step;
}

/** Clean internal governance jargon from plan explanation text. */
export function cleanPlanExplanationText(explanation: string): string {
	let text = explanation;
	text = text.replace(/G[0-7](?:\s*->\s*G[0-7])*\s*全?部门禁[;；]?\s*/gi, "阶段验证；");
	text = text.replace(/车道/g, "任务模块");
	text = text.replace(/\b(?:lane|juror|goal-check)\b/gi, "");
	return text.trim() || explanation;
}

/** Fold common model aliases (done, complete, in-progress) and clean steps before schema validation. */
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
		const current = item as { status?: unknown; step?: unknown };
		const status = canonicalizePlanStatus(current.status);
		let step = current.step;
		if (typeof step === "string") {
			const cleaned = cleanPlanStepText(step);
			if (cleaned !== step) {
				step = cleaned;
				changed = true;
			}
		}
		if (status !== current.status) {
			changed = true;
		}
		return { ...current, status, ...(typeof step === "string" ? { step } : {}) };
	});

	let explanation = args.explanation;
	if (typeof explanation === "string") {
		const cleanedExplanation = cleanPlanExplanationText(explanation);
		if (cleanedExplanation !== explanation) {
			explanation = cleanedExplanation;
			changed = true;
		}
	}

	return (changed ? { ...args, plan, ...(explanation !== undefined ? { explanation } : {}) } : input) as UpdatePlanToolInput;
}

export function createUpdatePlanToolDefinition(options: UpdatePlanToolOptions = {}): ToolDefinition<typeof updatePlanSchema> {
	return {
		name: "update_plan",
		label: "Update plan",
		description:
			"Create or refresh this session's execution checklist without writing workspace files. For multi-step tasks, call this to initialize the checklist before starting implementation. Call again whenever a step starts or finishes so the visible list stays current. Each step status must be pending, in_progress, or completed; at most one step may be in_progress.",
		promptSnippet: "Keep the session execution checklist current as steps start and finish",
		promptGuidelines: [
			"Initialize update_plan right away for any task that involves multiple steps, edits, or verification — do not execute code without creating a plan first.",
			"Call update_plan when a step starts or finishes; do not wait until the whole task ends.",
			"After the checklist is active, call update_plan again when a step finishes or after several mutating writes so the visible list stays current.",
			"Use status pending, in_progress, or completed only. Mark exactly one current step in_progress.",
			"Write each step and explanation in the same language as the user's latest message, using clean, user-friendly language describing concrete deliverables and files (e.g. '搭建基础工程骨架', '实现文章列表与 Markdown 渲染', '运行测试与验证').",
			"CRITICAL: The checklist is displayed directly in the user interface. NEVER include internal governance or runtime jargon (such as '车道', 'lane', 'G0-G7', '门禁', 'juror', '独立评审席', 'goal-check', 'receipt') in step descriptions or explanations.",
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
