import React, { useEffect, useState } from 'react';
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
  const [workExpanded, setWorkExpanded] = useState(isRunning);
  useEffect(() => setWorkExpanded(isRunning), [isRunning]);
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
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-[#16171a]" data-subagent-detail-view="">
      {/* Top Header aligned to 50px matching sidebar and chat header */}
      <div className="h-[50px] px-3.5 flex items-center justify-between flex-shrink-0 titlebar-drag">
        <div className="flex items-center gap-2 min-w-0 no-drag">
          <button
            type="button"
            onClick={onBack}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
            title="Back to Inspector"
            aria-label="Back to Inspector"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <span className="font-semibold text-[13.5px] text-slate-900 dark:text-slate-100 capitalize truncate">
            {subagent.role}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              subagent.status === 'running'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : subagent.status === 'completed'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
            }`}
          >
            {subagent.status === 'running' ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400" />
                <span>Running</span>
              </>
            ) : subagent.status === 'completed' ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                <span>Completed</span>
              </>
            ) : (
              <>
                <CircleAlert className="h-3 w-3 text-rose-600 dark:text-rose-400" />
                <span>Failed</span>
              </>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 no-drag"
          title="Copy Log"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-600 dark:text-emerald-400 stroke-[2.2]" />
              <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
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
        {/* User Turn: Assigned Task styled like UserBubble */}
        <div className="my-2 flex w-full min-w-0 max-w-full justify-end" data-subagent-task-section="">
          <div className="flex max-w-[500px] flex-col items-end gap-1.5">
            <div className="bg-[#f1f3f6] dark:bg-[#212631] text-[#0f172a] dark:text-[#f1f5f9] px-4 py-2.5 rounded-[10px] max-w-full text-[14px] leading-relaxed font-normal text-left whitespace-pre-wrap break-words text-pretty">
              <p>{subagent.task || 'No task description'}</p>
              {subagent.context && (
                <div className="mt-2 text-[12px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                  {subagent.context}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Callout Banner if failed */}
        {subagent.error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/40 p-3 text-[12.5px] leading-relaxed text-rose-800 dark:text-rose-200 shadow-xs">
            <div className="flex items-center gap-1.5 font-semibold text-rose-900 dark:text-rose-100 mb-1">
              <CircleAlert size={14} className="text-rose-600 dark:text-rose-400" />
              <span>Execution Error</span>
            </div>
            <p className="whitespace-pre-wrap font-mono text-[11.5px] text-rose-700 dark:text-rose-300 bg-white/70 dark:bg-slate-900/70 p-2 rounded border border-rose-200/60 dark:border-rose-800/60">
              {subagent.error}
            </p>
          </div>
        )}

        {/* Assistant Turn: Work Log & Output structured exactly like AssistantTurn */}
        <div className="assistant-turn-segment w-full min-w-0 max-w-full" data-subagent-work-section="">
          {/* Assistant Work Section (folding thinking, tool groups, tool cards) */}
          {hasWorkContent && (
            <AssistantWork
              items={workItems}
              streaming={isRunning}
              durationMs={liveDurationMs}
              preserveExistingItems
              onExpandedChange={setWorkExpanded}
            />
          )}

          {/* Final Markdown Response */}
          {finalText && (
            <div className={`turn-final-response ${!isRunning && workExpanded ? 'after-expanded-work' : ''} w-full min-w-0 max-w-full`}>
              <div className="my-2 flex w-full min-w-0 max-w-full flex-col items-start" data-message-role="assistant">
                <div className="w-full min-w-0 max-w-full py-0.5 text-[14.5px] font-normal leading-relaxed text-[#1e293b] dark:text-slate-200">
                  <MarkdownContent markdown={finalText} />
                </div>
              </div>
            </div>
          )}

          {/* Fallback if no parts and raw output exists */}
          {!hasWorkContent && !finalText && !isRunning && subagent.rawOutput && !subagent.error && (
            <div className="text-[13px] font-mono leading-relaxed text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/70 whitespace-pre-wrap break-all">
              {subagent.rawOutput}
            </div>
          )}

          {/* Live Progress Indicator when running */}
          {isRunning && (
            <WorkProgressIndicator
              progress={progress}
              idle={false}
            />
          )}
        </div>
      </div>
    </div>
  );
};

