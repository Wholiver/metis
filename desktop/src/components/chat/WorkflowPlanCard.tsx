import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { WorkflowPlanState, WorkflowPlanStep } from '../../types';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

export interface WorkflowPlanCardProps {
  plan: WorkflowPlanState;
  interrupted?: boolean;
  className?: string;
}

function isPlanComplete(plan: WorkflowPlanState): boolean {
  return Boolean(plan.plan.length && plan.plan.every((item) => item.status === 'completed'));
}

function StepIcon({ status }: { status: WorkflowPlanStep['status'] }) {
  if (status === 'completed') {
    return (
      <span
        className="flex size-[15px] shrink-0 items-center justify-center rounded-[3.5px] border border-[color-mix(in_srgb,var(--ink-3)_70%,transparent)] text-ink-3"
        aria-hidden="true"
        data-plan-step-icon="completed"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span
        className="flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink-2"
        aria-hidden="true"
        data-plan-step-icon="in_progress"
      >
        <span className="size-[5px] rounded-full bg-ink-2" />
      </span>
    );
  }
  return (
    <span
      className="h-5 w-[3px] shrink-0 rounded-full bg-[color-mix(in_srgb,var(--ink-3)_48%,transparent)]"
      aria-hidden="true"
      data-plan-step-icon="pending"
    />
  );
}

export const WorkflowPlanCard: React.FC<WorkflowPlanCardProps> = ({
  plan,
  interrupted = false,
  className,
}) => {
  const { t } = useI18n();
  const complete = isPlanComplete(plan);
  const [expanded, setExpanded] = useState(!complete);
  const planIdentity = `${plan.updatedAt}:${plan.taskId || ''}:${plan.plan.map((item) => `${item.status}:${item.step}`).join('|')}`;

  useEffect(() => {
    setExpanded(!isPlanComplete(plan));
  }, [planIdentity]);

  const completedCount = plan.plan.filter((item) => item.status === 'completed').length;
  const totalCount = plan.plan.length;

  const progressLabel = plan.phase === 'reading_proposal'
    ? (t('workflowPlanReadingProposal') || 'Reading the approved proposal…')
    : plan.phase === 'creating_checklist'
      ? (t('workflowPlanCreatingChecklist') || 'Creating the execution checklist…')
      : totalCount > 0
        ? t('workflowPlanProgress', { completed: completedCount, total: totalCount })
        : plan.legacyMarkdown
          ? (t('workflowPlanLegacy') || 'Legacy execution plan')
          : (t('workflowPlanEmpty') || 'No execution checklist is saved for this Build session yet.');

  const headerLabel = interrupted
    ? `${t('workflowPlanInterrupted') || 'Interrupted · can continue'} · ${progressLabel}`
    : progressLabel;

  const toggleLabel = expanded
    ? (t('workflowPlanCollapse') || 'Collapse execution plan')
    : (t('workflowPlanExpand') || 'Expand execution plan');

  return (
    <section
      className={cn(
        'w-full overflow-hidden rounded-[12px] border border-line bg-[color-mix(in_srgb,var(--inset)_65%,var(--surface))] pb-[14px] shadow-none',
        className,
      )}
      data-workflow-plan-card=""
      data-plan-expanded={expanded ? 'true' : 'false'}
      data-plan-complete={complete ? 'true' : undefined}
      data-plan-interrupted={interrupted ? 'true' : undefined}
    >
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
        aria-controls="workflow-plan-body"
        aria-label={toggleLabel}
        data-workflow-plan-header=""
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tabular-nums text-ink-2 text-pretty">
          {headerLabel}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 stroke-[2] text-ink-3 transition-transform duration-300',
            expanded ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>

      <div
        id="workflow-plan-body"
        className="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
        data-workflow-plan-body=""
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          {plan.explanation?.trim() ? (
            <p className="px-3 pb-1.5 text-[12px] leading-[1.45] text-ink-3 text-pretty" data-workflow-plan-explanation="">
              {plan.explanation.trim()}
            </p>
          ) : null}

          {plan.legacyMarkdown?.trim() && totalCount === 0 ? (
            <pre className="mx-3 mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-inset px-2.5 py-2 font-sans text-[12px] leading-[1.45] text-ink-2" data-workflow-plan-legacy="">
              {plan.legacyMarkdown.trim()}
            </pre>
          ) : null}

          {totalCount > 0 ? (
            <ul className="flex flex-col gap-0.5 px-2.5 pb-2.5" data-workflow-plan-steps="">
              {plan.plan.map((item, index) => {
                const active = item.status === 'in_progress';
                const done = item.status === 'completed';
                return (
                  <li
                    key={`${index}-${item.step}`}
                    className="flex min-h-8 items-center gap-3 rounded-[8px] px-1.5 py-1"
                    data-workflow-plan-step=""
                    data-plan-step-status={item.status}
                  >
                    <span className="flex w-[18px] shrink-0 items-center justify-center">
                      <StepIcon status={item.status} />
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 text-[13px] leading-[1.45] text-pretty',
                        done && 'text-ink-3 line-through',
                        active && 'font-semibold text-ink',
                        !done && !active && 'text-ink-2',
                      )}
                    >
                      {item.step}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
};

WorkflowPlanCard.displayName = 'WorkflowPlanCard';
