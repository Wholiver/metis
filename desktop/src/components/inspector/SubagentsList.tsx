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
        <Bot className="mb-2.5 h-6 w-6 stroke-[1.5] text-[#94a3b8]" aria-hidden="true" />
        <p className="text-[13px] font-semibold text-[#334155] text-balance">No subagents yet</p>
        <p className="mt-1 max-w-[220px] text-[12px] leading-[1.55] text-[#94a3b8] text-pretty">
          Subagents spawned by spawn_agent will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5" data-subagents-list="">
      {subagents.map((subagent) => {
        return (
          <button
            key={subagent.id}
            type="button"
            onClick={() => onSelect(subagent)}
            className="group flex min-h-[46px] w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-slate-100/80 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
            data-subagent-item=""
            data-subagent-id={subagent.id}
            data-subagent-status={subagent.status}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {subagent.status === 'running' ? (
                  <span className="flex h-2 w-2 relative shrink-0" title="Running">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                  </span>
                ) : subagent.status === 'completed' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Completed" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" title="Failed" />
                )}
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

            <ChevronRight size={15} className="text-slate-400 opacity-60 group-hover:opacity-100 transition-opacity shrink-0 ml-1" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};
