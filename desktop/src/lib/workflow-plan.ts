import { WorkflowPlanState, WorkflowPlanStatus, WorkflowPlanStep } from '../types';

const PLAN_STATUSES = new Set<WorkflowPlanStatus>(['pending', 'in_progress', 'completed']);

export type WorkflowPlanCustomEntry = {
  type?: string;
  customType?: string;
  timestamp?: string;
  data?: unknown;
};

function asPlanStep(item: unknown): WorkflowPlanStep | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const step = (item as { step?: unknown }).step;
  const status = (item as { status?: unknown }).status;
  if (typeof step !== 'string') return undefined;
  if (typeof status !== 'string' || !PLAN_STATUSES.has(status as WorkflowPlanStatus)) return undefined;
  return { step, status: status as WorkflowPlanStatus };
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
    explanation: typeof data.explanation === 'string' ? data.explanation : undefined,
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
