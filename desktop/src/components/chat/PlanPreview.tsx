import React, { useEffect, useState } from 'react';
import { ChevronDown, Lightbulb, PencilLine, Play } from 'lucide-react';
import { splitPlanTitle } from '../../lib/plan-preview';
import { MarkdownContent } from './MarkdownContent';

interface PlanPreviewProps {
  markdown: string;
  partial?: boolean;
  current?: boolean;
  revision?: number;
  actionsEnabled?: boolean;
  onProcess?: () => void;
  onRefine?: (request: string) => void;
}

export const PlanPreview: React.FC<PlanPreviewProps> = ({
  markdown,
  partial = false,
  current = false,
  revision,
  actionsEnabled = false,
  onProcess,
  onRefine,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refinement, setRefinement] = useState('');
  const { title, body } = splitPlanTitle(markdown);

  useEffect(() => {
    if (!current) setEditing(false);
  }, [current]);

  const submitRefinement = () => {
    const value = refinement.trim();
    if (!value || !onRefine) return;
    onRefine(value);
    setRefinement('');
    setEditing(false);
  };

  return (
    <section
      className="plan-preview my-2.5 w-full overflow-hidden rounded-[14px] border border-[#e2e6eb] bg-white"
      data-plan-preview
      data-plan-current={current ? 'true' : 'false'}
      data-plan-partial={partial ? 'true' : 'false'}
    >
      <header className="flex min-h-[44px] items-center gap-2 px-3.5">
        <Lightbulb aria-hidden="true" className="h-4 w-4 shrink-0 text-[#64748b]" strokeWidth={1.7} />
        <span className="text-[12px] font-medium text-[#64748b]">
          {partial ? 'Drafting plan…' : current ? 'Current plan' : 'Plan'}
        </span>
        <button
          type="button"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-[#64748b] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#334155] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#94a3b8]/50 active:scale-95"
          aria-label={expanded ? 'Collapse plan' : 'Expand plan'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </header>

      <div className="relative">
        <div className={`plan-preview-body px-4 pb-5 pt-4 ${expanded ? 'is-expanded' : ''}`}>
          <h2 className="mb-4 text-[21px] font-semibold leading-[1.28] tracking-[-0.02em] text-[#172033]">
            {title}
          </h2>
          {body ? (
            <MarkdownContent markdown={body} />
          ) : partial ? (
            <div className="flex items-center gap-1.5 py-2 text-[13px] text-[#94a3b8]" role="status">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94a3b8]" />
              Preparing preview…
            </div>
          ) : null}
        </div>
        {!expanded && body && <div className="plan-preview-fade pointer-events-none absolute inset-x-0 bottom-0 h-14" />}
      </div>

      {current && !partial && onProcess && (
        <footer className="plan-preview-actions px-3 py-2.5">
          {editing ? (
            <div className="flex items-end gap-2">
              <label className="sr-only" htmlFor="plan-refinement">Describe changes to this plan</label>
              <textarea
                id="plan-refinement"
                value={refinement}
                onChange={(event) => setRefinement(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitRefinement();
                }}
                className="min-h-[40px] flex-1 resize-none rounded-[10px] border border-[#dbe1e7] bg-white px-3 py-2 text-[13px] text-[#334155] outline-none transition-shadow placeholder:text-[#94a3b8] focus:border-[#94a3b8] focus:ring-2 focus:ring-[#cbd5e1]/50"
                placeholder="Describe what to change…"
                rows={2}
                autoFocus
              />
              <button
                type="button"
                onClick={submitRefinement}
                disabled={!actionsEnabled || !refinement.trim()}
                data-plan-refine-send=""
                className="relative h-8 rounded-[10px] bg-[#f1f3f6] px-3.5 text-[11.5px] font-semibold text-[#0f172a] transition-[color,background-color,transform,opacity] before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] hover:bg-[#e2e6eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/55 disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.96]"
              >
                Send
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {onRefine && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={!actionsEnabled}
                  data-plan-refine=""
                  className="relative flex h-8 items-center gap-1.5 rounded-[10px] bg-[#f1f3f6] px-3 text-[11.5px] font-medium text-[#475569] transition-[color,background-color,transform,opacity] before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] hover:bg-[#e2e6eb] hover:text-[#0f172a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/55 disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.96]"
                >
                  <PencilLine aria-hidden="true" className="h-3.5 w-3.5" />
                  Refine
                </button>
              )}
              <button
                type="button"
                onClick={onProcess}
                disabled={!actionsEnabled}
                data-plan-process=""
                className="relative flex h-8 items-center gap-1.5 rounded-[10px] bg-[#f1f3f6] px-3.5 text-[11.5px] font-semibold text-[#0f172a] transition-[color,background-color,transform,opacity] before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] hover:bg-[#e2e6eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/55 disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.96]"
              >
                <Play aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
                Process plan
              </button>
            </div>
          )}
        </footer>
      )}
    </section>
  );
};

