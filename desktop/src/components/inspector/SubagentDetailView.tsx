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
  contentRef?: React.Ref<HTMLDivElement>;
}

export const SubagentDetailView: React.FC<SubagentDetailViewProps> = ({ subagent, onBack, contentRef }) => {
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
    <div className="flex h-full flex-col overflow-hidden bg-page" data-subagent-detail-view="">
      {/* Top Header aligned to 50px matching sidebar and chat header */}
      <div className="h-[50px] px-3.5 flex items-center justify-between flex-shrink-0 titlebar-drag">
        <div className="flex items-center gap-2 min-w-0 no-drag">
          <button
            type="button"
            onClick={onBack}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
            title="Back to Inspector"
            aria-label="Back to Inspector"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <span className="font-semibold text-[13.5px] text-ink capitalize truncate">
            {subagent.role}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              subagent.status === 'running'
                ? 'bg-accent-tint text-accent-ink'
                : subagent.status === 'completed'
                  ? 'bg-green-tint text-green'
                  : 'bg-red-tint text-red'
            }`}
          >
            {subagent.status === 'running' ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-accent" />
                <span>Running</span>
              </>
            ) : subagent.status === 'completed' ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-green" />
                <span>Completed</span>
              </>
            ) : (
              <>
                <CircleAlert className="h-3 w-3 text-red" />
                <span>Failed</span>
              </>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-ink-2 hover:bg-hover hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] no-drag"
          title="Copy Log"
        >
          {copied ? (
            <>
              <Check size={13} className="text-green stroke-[2.2]" />
              <span className="text-green">Copied</span>
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
      <div ref={contentRef} className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* User Turn: Assigned Task styled like UserBubble */}
        <div className="my-2 flex w-full min-w-0 max-w-full justify-end" data-subagent-task-section="">
          <div className="flex max-w-[500px] flex-col items-end gap-1.5">
            <div
              className="max-w-full rounded-card bg-surface px-4 py-2.5 text-left text-[14px] font-normal leading-relaxed text-ink shadow-card whitespace-pre-wrap break-words text-pretty"
              data-user-bubble=""
            >
              <p>{subagent.task || 'No task description'}</p>
              {subagent.context && (
                <div className="mt-2 text-[12px] text-ink-2 dark:text-ink-3 whitespace-pre-wrap">
                  {subagent.context}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Callout Banner if failed */}
        {subagent.error && (
          <div className="rounded-card bg-red-tint p-3 text-[12.5px] leading-relaxed text-red shadow-card">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-red">
              <CircleAlert size={14} className="text-red" />
              <span>Execution Error</span>
            </div>
            <p className="whitespace-pre-wrap rounded-control bg-surface/70 p-2 font-mono text-[11.5px] text-red shadow-hairline">
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
                <div className="w-full min-w-0 max-w-full py-0.5 text-[14.5px] font-normal leading-relaxed text-ink">
                  <MarkdownContent markdown={finalText} />
                </div>
              </div>
            </div>
          )}

          {/* Fallback if no parts and raw output exists */}
          {!hasWorkContent && !finalText && !isRunning && subagent.rawOutput && !subagent.error && (
            <div className="rounded-card bg-inset p-2.5 font-mono text-[13px] leading-relaxed text-ink-2 shadow-hairline whitespace-pre-wrap break-all">
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
