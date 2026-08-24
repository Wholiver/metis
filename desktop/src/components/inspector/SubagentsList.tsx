import React from 'react';
import { Bot, CheckCircle2, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
import { useElapsedDuration } from '../../hooks/useElapsedDuration';
import { formatSubagentDuration, SubagentItem } from '../../lib/subagents';

interface SubagentsListProps {
  subagents: SubagentItem[];
  onSelect: (subagent: SubagentItem) => void;
}

const SubagentDuration: React.FC<{ subagent: SubagentItem }> = ({ subagent }) => {
  const durationMs = useElapsedDuration(
    subagent.startedAt,
    subagent.durationMs,
    subagent.status === 'running',
  );
  const duration = formatSubagentDuration(durationMs);
  return duration ? (
    <span className="ml-auto text-[11px] text-slate-400 tabular-nums shrink-0">
      {duration}
    </span>
  ) : null;
};

export const SubagentsList: React.FC<SubagentsListProps> = ({ subagents, onSelect }) => {
  if (subagents.length === 0) {
    return (
      <div
        className="flex min-h-[220px] flex-1 flex-col items-center justify-center px-6 text-center"
        data-subagents-empty=""
      >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f1f3f6] text-[#8e95a2]">
          <Bot className="h-5 w-5 stroke-[1.6]" aria-hidden="true" />
        </div>
        <p className="text-[13px] font-semibold text-[#334155] text-balance">No subagents yet</p>
        <p className="mt-1 max-w-[220px] text-[12px] leading-[1.55] text-[#94a3b8] text-pretty">
          Subagents spawned by spawn_agent will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-subagents-list="">
      {subagents.map((subagent) => {
        return (
          <button
            key={subagent.id}
            type="button"
            onClick={() => onSelect(subagent)}
            className="group flex min-h-[52px] w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all hover:bg-slate-100/80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 border border-transparent hover:border-slate-200/60"
            data-subagent-item=""
            data-subagent-id={subagent.id}
            data-subagent-status={subagent.status}
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-white group-hover:shadow-sm">
              {subagent.status === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
              ) : subagent.status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <CircleAlert className="h-4 w-4 text-rose-500" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[13px] text-slate-800 capitalize truncate">
                  {subagent.role}
                </span>
                {subagent.mode === 'async' && (
                  <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] font-medium text-slate-500">
                    Async
                  </span>
                )}
                <SubagentDuration subagent={subagent} />
              </div>
              <p className="text-[12px] text-slate-500 truncate leading-snug mt-0.5" title={subagent.task}>
                {subagent.task || 'No task description'}
              </p>
            </div>

            <ChevronRight size={15} className="text-slate-400 opacity-60 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};
