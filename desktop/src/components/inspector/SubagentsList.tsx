import React, { useCallback, useRef } from 'react';
import { Bot, ChevronRight, CircleAlert, CircleCheckBig, CircleDot } from 'lucide-react';
import { useElapsedDuration } from '../../hooks/useElapsedDuration';
import { formatSubagentDuration, SubagentItem } from '../../lib/subagents';

interface SubagentsListProps {
  subagents: SubagentItem[];
  onSelect: (subagent: SubagentItem) => void;
}

const STATUS_LABELS: Record<SubagentItem['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

function StatusIcon({ status }: { status: SubagentItem['status'] }) {
  if (status === 'completed') {
    return <CircleCheckBig className="h-[18px] w-[18px] stroke-[1.8]" aria-hidden="true" />;
  }
  if (status === 'running') {
    return <CircleDot className="h-[18px] w-[18px] stroke-[1.8] animate-pulse" aria-hidden="true" />;
  }
  return <CircleAlert className="h-[18px] w-[18px] stroke-[1.8]" aria-hidden="true" />;
}

const SubagentDuration: React.FC<{ subagent: SubagentItem }> = ({ subagent }) => {
  const durationMs = useElapsedDuration(
    subagent.startedAt,
    subagent.durationMs,
    subagent.status === 'running',
  );
  const duration = formatSubagentDuration(durationMs);
  return duration ? (
    <span className="ml-auto text-[11.5px] text-slate-400 tabular-nums shrink-0">
      {duration}
    </span>
  ) : null;
};

export const SubagentsList: React.FC<SubagentsListProps> = ({ subagents, onSelect }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const hoveredRowRef = useRef<HTMLElement | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-subagent-item]');
    if (!row || !containerRef.current?.contains(row)) {
      return;
    }

    if (hoveredRowRef.current === row) return;
    hoveredRowRef.current = row;

    const indicator = indicatorRef.current;
    if (!indicator) return;

    indicator.style.transition = '';
    indicator.style.transform = `translate3d(0, ${row.offsetTop}px, 0)`;
    indicator.style.height = `${row.offsetHeight}px`;
    indicator.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredRowRef.current = null;
    const indicator = indicatorRef.current;
    if (indicator) {
      indicator.style.opacity = '0';
    }
  }, []);

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
    <div
      ref={containerRef}
      className="relative flex flex-col gap-0.5 select-none"
      data-subagents-list=""
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Floating unified indicator (direct 120Hz continuous sliding cover) */}
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 rounded-[10px] bg-slate-100/80 pointer-events-none z-0 will-change-transform transition-[transform,height,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ opacity: 0 }}
      />
      {subagents.map((subagent) => {
        return (
          <button
            key={subagent.id}
            type="button"
            onClick={() => onSelect(subagent)}
            className="group relative z-[1] flex min-h-9 w-full items-start gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-[transform,color] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
            data-subagent-item=""
            data-subagent-id={subagent.id}
            data-subagent-status={subagent.status}
          >
            <span
              className={`mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center ${
                subagent.status === 'completed'
                  ? 'text-emerald-500'
                  : subagent.status === 'running'
                    ? 'text-blue-600'
                    : 'text-rose-500'
              }`}
            >
              <StatusIcon status={subagent.status} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-[13px] text-[#1e293b] capitalize truncate">
                  {subagent.role}
                </span>
                {subagent.mode === 'async' && (
                  <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] font-medium text-slate-500">
                    Async
                  </span>
                )}
                <SubagentDuration subagent={subagent} />
              </div>
              <p
                className="text-[12px] leading-5 text-slate-500 truncate mt-0.5"
                title={subagent.task}
              >
                {subagent.task || 'No task description'}
              </p>
              <span className="sr-only">{STATUS_LABELS[subagent.status]}</span>
            </div>

            <ChevronRight
              size={16}
              strokeWidth={1.8}
              className="mt-1 text-slate-400 opacity-60 group-hover:opacity-100 transition-opacity shrink-0 ml-1"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
};

