import React, { useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Copy, FolderGit2, Loader2, Sparkles, Terminal } from 'lucide-react';
import { useElapsedDuration } from '../../hooks/useElapsedDuration';
import { formatSubagentDuration, SubagentItem } from '../../lib/subagents';
import { resolveOutputTailProgress } from '../../lib/work-progress';
import { AssistantWork } from '../chat/AssistantWork';
import { MarkdownContent } from '../chat/MarkdownContent';
import { WorkProgressIndicator } from '../chat/WorkProgressIndicator';

interface SubagentDetailViewProps {
  subagent: SubagentItem;
  onBack: () => void;
}

export const SubagentDetailView: React.FC<SubagentDetailViewProps> = ({ subagent, onBack }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const textToCopy = subagent.result || subagent.rawOutput || subagent.task;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const isRunning = subagent.status === 'running';
  const liveDurationMs = useElapsedDuration(subagent.startedAt, subagent.durationMs, isRunning);
  const duration = formatSubagentDuration(liveDurationMs);

  // Partition parts into work items (thinking, tool calls, earlier text) and final text response
  let finalEntryIndex = -1;
  if (!isRunning) {
    for (let index = subagent.parts.length - 1; index >= 0; index -= 1) {
      const part = subagent.parts[index];
      if (part.type === 'text' && part.text.trim()) {
        finalEntryIndex = index;
        break;
      }
    }
  }

  const workItems = isRunning
    ? subagent.parts
    : subagent.parts.filter((_, index) => index !== finalEntryIndex);
  const finalPart = finalEntryIndex >= 0 ? subagent.parts[finalEntryIndex] : undefined;
  const finalText = !isRunning
    ? (finalPart && finalPart.type === 'text' ? finalPart.text : subagent.result)
    : undefined;

  const progress = resolveOutputTailProgress(subagent.parts, isRunning);
  const hasWorkContent = workItems.length > 0 || isRunning;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white" data-subagent-detail-view="">
      {/* Top Header */}
      <div className="flex h-11 items-center justify-between border-b border-slate-200/80 px-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
            title="Back to Inspector"
            aria-label="Back to Inspector"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <span className="font-semibold text-[13.5px] text-slate-900 capitalize truncate">
            {subagent.role}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              subagent.status === 'running'
                ? 'bg-blue-50 text-blue-700'
                : subagent.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
            }`}
          >
            {subagent.status === 'running' ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                <span>Running</span>
              </>
            ) : subagent.status === 'completed' ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                <span>Completed</span>
              </>
            ) : (
              <>
                <CircleAlert className="h-3 w-3 text-rose-600" />
                <span>Failed</span>
              </>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-slate-600 hover:bg-black/5 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
          title="Copy Log"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-600 stroke-[2.2]" />
              <span className="text-emerald-600">Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} strokeWidth={1.8} />
              <span>Copy Log</span>
            </>
          )}
        </button>
      </div>

      {/* Main Content Area mirroring agent turn interface */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* User Turn: Assigned Task */}
        <div className="space-y-1.5" data-subagent-task-section="">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 uppercase tracking-wider px-1">
            <span>Assigned Task</span>
            {duration && <span className="tabular-nums font-normal">{duration}</span>}
          </div>

          <div className="rounded-2xl rounded-br-sm border border-slate-200 bg-slate-50/70 p-3 text-[13px] leading-relaxed text-slate-800 break-words text-pretty shadow-xs">
            <p className="font-medium text-slate-900">{subagent.task || 'No task description'}</p>
            {subagent.context && (
              <div className="mt-2 pt-2 border-t border-slate-200/60 text-[12px] text-slate-600 whitespace-pre-wrap">
                <span className="font-semibold text-slate-500 text-[11px] uppercase block mb-0.5">Context</span>
                {subagent.context}
              </div>
            )}
          </div>
        </div>

        {/* Metadata Pill Row */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-600 px-0.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            <Sparkles size={12} className="text-slate-500" />
            <span className="capitalize">{subagent.role}</span>
          </span>

          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            <Terminal size={12} className="text-slate-500" />
            <span>{subagent.mode === 'async' ? 'Background (async)' : 'Foreground (sync)'}</span>
          </span>

          {subagent.worktree && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 max-w-[200px] truncate"
              title={subagent.worktree}
            >
              <FolderGit2 size={12} className="text-slate-500 shrink-0" />
              <span className="truncate">{subagent.worktree}</span>
            </span>
          )}
        </div>

        {/* Error Callout Banner if failed */}
        {subagent.error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-[12.5px] leading-relaxed text-rose-800 shadow-xs">
            <div className="flex items-center gap-1.5 font-semibold text-rose-900 mb-1">
              <CircleAlert size={14} className="text-rose-600" />
              <span>Execution Error</span>
            </div>
            <p className="whitespace-pre-wrap font-mono text-[11.5px] text-rose-700 bg-white/70 p-2 rounded border border-rose-200/60">
              {subagent.error}
            </p>
          </div>
        )}

        {/* Assistant Turn: Work Log & Output */}
        <div className="space-y-3 pt-1 border-t border-slate-100" data-subagent-work-section="">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 uppercase tracking-wider px-1">
            <span>Work Log</span>
          </div>

          {/* Assistant Work Section (folding thinking, tool groups, tool cards) */}
          {hasWorkContent && (
            <AssistantWork
              items={workItems}
              streaming={isRunning}
              durationMs={liveDurationMs}
              preserveExistingItems
            />
          )}

          {/* Live Progress Indicator when running */}
          {isRunning && (
            <div className="pt-1">
              <WorkProgressIndicator
                progress={progress}
                idle={false}
              />
            </div>
          )}

          {/* Final Markdown Response */}
          {finalText && (
            <div className="text-[13.5px] leading-relaxed text-slate-800 space-y-2 pt-1">
              <MarkdownContent markdown={finalText} />
            </div>
          )}

          {/* Fallback if no parts and raw output exists */}
          {!hasWorkContent && !finalText && !isRunning && subagent.rawOutput && !subagent.error && (
            <div className="text-[13px] font-mono leading-relaxed text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 whitespace-pre-wrap break-all">
              {subagent.rawOutput}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
