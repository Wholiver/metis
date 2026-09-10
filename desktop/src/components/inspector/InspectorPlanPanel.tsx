import React, { useState } from 'react';
import { PencilLine, Play } from 'lucide-react';
import { WorkflowPlanState, WorkflowProposalState } from '../../types';
import { splitPlanTitle } from '../../lib/plan-preview';
import { useI18n } from '../../i18n';
import { MarkdownContent } from '../chat/MarkdownContent';
import { PlanPoints } from './PlanPoints';
import { resolveViewedProposalMarkdown } from '../../lib/inspector-tabs';

interface InspectorPlanPanelProps {
  viewedProposalMarkdown?: string | null;
  activeSessionId?: string | null;
  viewedProposalSessionId?: string | null;
  workflowProposal?: WorkflowProposalState;
  workflowPlan?: WorkflowPlanState;
  planActionsEnabled?: boolean;
  onProcessProposal?: () => void;
  onRefineProposal?: (request: string) => void;
  contentScrollRef?: React.RefObject<HTMLDivElement | null>;
}

function phaseLabel(
  phase: WorkflowPlanState['phase'] | undefined,
  t: (key: string) => string,
): string | null {
  if (phase === 'reading_proposal') return t('reactUiReadingProposal') || 'Reading proposal…';
  if (phase === 'creating_checklist') return t('reactUiCreatingChecklist') || 'Creating checklist…';
  return null;
}

export const InspectorPlanPanel: React.FC<InspectorPlanPanelProps> = ({
  viewedProposalMarkdown,
  viewedProposalSessionId,
  activeSessionId,
  workflowProposal,
  workflowPlan,
  planActionsEnabled = false,
  onProcessProposal,
  onRefineProposal,
  contentScrollRef,
}) => {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [refinement, setRefinement] = useState('');

  const scopedViewedMarkdown = resolveViewedProposalMarkdown(
    {
      viewedProposalMarkdown: viewedProposalMarkdown ?? null,
      viewedProposalSessionId: viewedProposalSessionId ?? null,
    },
    activeSessionId,
  );
  const proposalMarkdown = (scopedViewedMarkdown ?? workflowProposal?.markdown ?? '').trim();
  const sessionMarkdown = (workflowProposal?.markdown ?? '').trim();
  const isCurrent = Boolean(proposalMarkdown && sessionMarkdown && proposalMarkdown === sessionMarkdown);
  const { title, body } = splitPlanTitle(proposalMarkdown);
  const points = workflowPlan?.plan || [];
  const status = phaseLabel(workflowPlan?.phase, t);
  const canAct = Boolean(isCurrent && planActionsEnabled && onProcessProposal);

  const submitRefinement = () => {
    const value = refinement.trim();
    if (!value || !onRefineProposal) return;
    onRefineProposal(value);
    setRefinement('');
    setEditing(false);
  };

  if (!proposalMarkdown && points.length === 0) {
    return (
      <PlanPoints points={[]} />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-inspector-plan-panel="">
      <div className="relative z-10 shrink-0 bg-page" data-inspector-plan-todos-pin="">
        <section
          className="relative min-w-0"
          data-inspector-plan-todos=""
        >
          {status ? (
            <div className="mb-2 flex items-center justify-end gap-2 px-0.5">
              <span className="text-[11px] text-ink-3" role="status" data-plan-phase="">
                {status}
              </span>
            </div>
          ) : null}
          <PlanPoints points={points} compactEmpty maxVisibleRows={3} />
        </section>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-full h-7 bg-gradient-to-b from-page from-20% via-page/90 to-transparent"
          data-inspector-plan-todos-fade=""
        />
      </div>

      <div
        ref={contentScrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-inspector-plan-body=""
      >
        {proposalMarkdown ? (
          <section className="min-w-0 pt-4" data-inspector-plan-markdown="">
            <h2 className="text-[18px] font-semibold leading-snug tracking-[-0.02em] text-ink text-balance">
              {title}
            </h2>
            {body ? (
              <div className="mt-3 text-[13px] leading-relaxed text-ink-2">
                <MarkdownContent markdown={body} />
              </div>
            ) : null}
          </section>
        ) : null}

        {isCurrent && onProcessProposal ? (
          <footer className="plan-preview-actions sticky bottom-0 mt-4 bg-page pt-2 pb-1" data-inspector-plan-actions="">
            <div
              className="rounded-card bg-surface px-3.5 py-2.5 shadow-card"
              data-inspector-plan-actions-card=""
            >
              {editing ? (
                <div className="flex items-end gap-2">
                  <label className="sr-only" htmlFor="inspector-plan-refinement">
                    {t('reactUiDescribePlanChanges') || 'Describe changes to this plan'}
                  </label>
                  <textarea
                    id="inspector-plan-refinement"
                    value={refinement}
                    onChange={(event) => setRefinement(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitRefinement();
                    }}
                    className="min-h-[40px] flex-1 resize-none rounded-control border border-line-strong bg-field px-3 py-2 text-[13px] text-ink shadow-inset-field outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:ring-2 focus:ring-[color:var(--focus)]"
                    placeholder={t('reactUiDescribeWhatToChange') || 'Describe what to change…'}
                    rows={2}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={submitRefinement}
                    disabled={!canAct || !refinement.trim()}
                    data-plan-refine-send=""
                    className="relative h-8 shrink-0 rounded-full bg-accent px-4 text-[12px] font-medium text-white shadow-btn transition-[color,background-color,transform,opacity] before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.96]"
                  >
                    {t('send') || 'Send'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  {onRefineProposal ? (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      disabled={!canAct}
                      data-plan-refine=""
                      className="relative flex h-8 items-center gap-1.5 rounded-full bg-hover-2 px-3.5 text-[12px] font-medium text-ink transition-[color,background-color,transform,opacity] before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] hover:bg-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.96]"
                    >
                      <PencilLine aria-hidden="true" className="h-3.5 w-3.5 stroke-[1.8]" />
                      {t('reactUiRefine') || 'Refine'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onProcessProposal}
                    disabled={!canAct}
                    data-plan-process=""
                    className="relative flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[12px] font-medium text-white shadow-btn transition-[color,background-color,transform,opacity] before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.96]"
                  >
                    <Play aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
                    {t('reactUiExecutePlan') || 'Execute'}
                  </button>
                </div>
              )}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
};
