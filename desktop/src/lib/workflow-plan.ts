import { WorkflowPlanState, WorkflowPlanStatus, WorkflowPlanStep } from '../types';

const PLAN_STATUSES = new Set<WorkflowPlanStatus>(['pending', 'in_progress', 'completed']);

export type WorkflowPlanCustomEntry = {
  type?: string;
  customType?: string;
  timestamp?: string;
  data?: unknown;
};

/** Clean accidental runtime/governance jargon from step text for a clean UI presentation. */
export function formatPlanStepForDisplay(step: string): string {
  if (!step || typeof step !== 'string') return step;
  let text = step;
  // Strip leading lane marker: e.g. "车道 I1-scaffold:", "Lane I2:", "Lane 1:"
  text = text.replace(/^(?:车道|Lane)\s+[A-Za-z0-9_.-]+[:：]\s*/i, '');
  // Strip bracketed gate tags: e.g. "[G4]", "[G0-G7]"
  text = text.replace(/^\[(?:G[0-7](?:-[A-Za-z0-9]+)?|gate)\]\s*/i, '');
  // Strip trailing/inline gate remarks: e.g. "(G4-G7 全过)", "(G4-G7全过)", "(G4全过)", "(G0-G7全部通过)"
  text = text.replace(/\s*\([A-Za-z0-9_.-]*\s*(?:G[0-7](?:[-~至到G\d\s]*全过|[^)]*)|(?:G[0-7]|全部门禁)[^)]*)\)/gi, '');
  // Strip leading gate prefixes: e.g. "G7 独立评审席对...做最终签署" -> "整合后工作区做最终签署", "goal-check 目标核验..." -> "目标核验..."
  text = text.replace(/^G[0-7](?:\.[0-9]+)?\s*(?:独立)?评审席?[:：\s]*/i, '');
  text = text.replace(/^对(?=[\u4e00-\u9fa5])/, '');
  text = text.replace(/^goal-check\s*[:：\s]*/i, '');
  return text.trim() || step;
}

/** Clean internal governance jargon from plan explanation text for human-readable display. */
export function formatPlanExplanationForDisplay(explanation?: string): string | undefined {
  if (!explanation || typeof explanation !== 'string') return explanation;
  let text = explanation;
  // e.g. "I1 已完成 G4->G5->G6->G7 全部门禁；启动 I2 内容层车道。" -> "已完成阶段验证；正在推进内容层模块。"
  text = text.replace(/(?:[A-Za-z0-9_.-]+\s*)?已完成\s*G[0-7](?:\s*->\s*G[0-7])*\s*全?部门禁[;；]?\s*/gi, '已完成阶段验证；');
  text = text.replace(/(?:启动|推进)\s*(?:[A-Za-z0-9_.-]+\s*)?([^；。\n]+?)车道/g, '正在推进$1模块');
  text = text.replace(/车道/g, '任务模块');
  text = text.replace(/\b(?:lane|juror|goal-check)\b/gi, '');
  return text.trim() || explanation;
}

function asPlanStep(item: unknown): WorkflowPlanStep | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const step = (item as { step?: unknown }).step;
  const status = (item as { status?: unknown }).status;
  if (typeof step !== 'string') return undefined;
  if (typeof status !== 'string' || !PLAN_STATUSES.has(status as WorkflowPlanStatus)) return undefined;
  return { step: formatPlanStepForDisplay(step), status: status as WorkflowPlanStatus };
}

export function workflowPlanFromCustomEntry(entry: WorkflowPlanCustomEntry | undefined): WorkflowPlanState | undefined | null {
  if (!entry) return undefined;
  if (entry.customType === 'workflow_plan_reset') return null;
  if (entry.customType !== 'workflow_plan' || !entry.data || typeof entry.data !== 'object') return undefined;
  const data = entry.data as {
    plan?: unknown;
    explanation?: unknown;
    updatedAt?: unknown;
    legacyMarkdown?: unknown;
    taskId?: unknown;
    proposalRevision?: unknown;
    phase?: unknown;
  };
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : entry.timestamp ?? new Date().toISOString();
  if (typeof data.plan === 'string') {
    return {
      plan: [],
      updatedAt,
      legacyMarkdown: data.plan,
      taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
    };
  }
  if (!Array.isArray(data.plan)) return undefined;
  return {
    explanation: typeof data.explanation === 'string' ? formatPlanExplanationForDisplay(data.explanation) : undefined,
    plan: data.plan.map(asPlanStep).filter((item): item is WorkflowPlanStep => Boolean(item)),
    updatedAt,
    taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
    proposalRevision: typeof data.proposalRevision === 'number' ? data.proposalRevision : undefined,
    phase: data.phase === 'reading_proposal' || data.phase === 'creating_checklist' || data.phase === 'active'
      ? data.phase
      : undefined,
    legacyMarkdown: typeof data.legacyMarkdown === 'string' ? data.legacyMarkdown : undefined,
  };
}
