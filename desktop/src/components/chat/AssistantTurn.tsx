import React, { useEffect, useState } from 'react';
import { AssistantContentPart, Message, PendingUserInput, WorkflowProposalState } from '../../types';
import { estimateThinkingDurationMs } from '../../lib/thinking';
import { collectTurnFileChanges } from '../../lib/turn-files';
import { resolveOutputTailProgress } from '../../lib/work-progress';
import { AgentBubble } from './AgentBubble';
import { AssistantWork } from './AssistantWork';
import { WorkProgressIndicator } from './WorkProgressIndicator';
import { TurnFilesSummary } from './TurnFilesSummary';

interface AssistantTurnProps {
  messages: Message[];
  startedAt?: string | number;
  workspacePath?: string;
  streaming?: boolean;
  showProgress?: boolean;
  workflowProposal?: WorkflowProposalState;
  planActionsEnabled?: boolean;
  onProcessProposal?: () => void;
  onRefineProposal?: (request: string) => void;
  pendingUserInput?: PendingUserInput;
}

export function isSubagentLaunchNotice(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized || normalized.length > 240 || (!/subagent/i.test(normalized) && !/spawn_agent/i.test(normalized) && !/agent/i.test(normalized))) return false;
  return /(已启动|启动了|started|launched|spawning|spawned)/i.test(normalized)
    && /(等待|等它|waiting|wait for|background)/i.test(normalized);
}

function fallbackParts(message: Message): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  if (message.thinking) {
    parts.push({
      type: 'thinking',
      id: `${message.id}-thinking`,
      thinking: message.thinking,
      durationMs: message.thinkingDurationMs,
    });
  }
  if (message.content) parts.push({ type: 'text', id: `${message.id}-text`, text: message.content });
  return parts;
}

function timestampMs(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function resolveCompletedWorkDurationMs(
  messages: Message[],
  workItems: AssistantContentPart[],
  startedAt?: string | number,
  active = false,
  now = Date.now(),
): number | undefined {
  const observedTimestamps = [
    ...messages.map((message) => timestampMs(message.serverTimestamp)),
    ...workItems.flatMap((part) => part.type === 'toolCall' ? [timestampMs(part.result?.timestamp)] : []),
  ].filter((value): value is number => value !== undefined);
  const resolvedStart = timestampMs(startedAt) ?? (observedTimestamps.length > 0 ? Math.min(...observedTimestamps) : undefined);
  const completionTimestamps = messages
    .map((message) => message.completedAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const observedEnd = completionTimestamps.length > 0
    ? Math.max(...completionTimestamps)
    : observedTimestamps.length > 0 ? Math.max(...observedTimestamps) : undefined;
  const resolvedEnd = active ? now : observedEnd;
  if (resolvedStart !== undefined && resolvedEnd !== undefined && resolvedEnd > resolvedStart) {
    return resolvedEnd - resolvedStart;
  }

  const thinkingItems = workItems.filter((part): part is Extract<AssistantContentPart, { type: 'thinking' }> => part.type === 'thinking');
  if (thinkingItems.length === 0) return undefined;
  return thinkingItems.reduce((total, part) => total + (part.durationMs ?? estimateThinkingDurationMs(part.thinking)), 0);
}

export const AssistantTurn: React.FC<AssistantTurnProps> = ({
  messages,
  startedAt,
  workspacePath,
  streaming = false,
  showProgress = false,
  workflowProposal,
  planActionsEnabled = false,
  onProcessProposal,
  onRefineProposal,
  pendingUserInput,
}) => {
  const isWaitingUserInput = Boolean(pendingUserInput);
  const [workExpanded, setWorkExpanded] = useState(streaming);
  useEffect(() => setWorkExpanded(streaming), [streaming]);
  const entries = messages.flatMap((message) => (message.parts || fallbackParts(message)).map((part) => ({ message, part })));
  const progress = isWaitingUserInput
    ? { phase: 'waiting' as const, label: 'Waiting for your input…', status: 'waiting' as const }
    : resolveOutputTailProgress(entries.map(({ part }) => part), streaming);
  const hasWork = streaming || isWaitingUserInput || entries.some(({ part }) => part.type === 'thinking' || part.type === 'toolCall');
  if (!hasWork) {
    if (!showProgress) {
      return <>{messages.map((message) => (
        <AgentBubble
          key={message.id}
          message={message}
          workflowProposal={workflowProposal}
          planActionsEnabled={planActionsEnabled}
          onProcessProposal={onProcessProposal}
          onRefineProposal={onRefineProposal}
        />
      ))}</>;
    }
    return (
      <div className="assistant-turn-segment w-full min-w-0 max-w-full" data-assistant-turn>
        {messages.map((message) => (
          <AgentBubble
            key={message.id}
            message={message}
            workflowProposal={workflowProposal}
            planActionsEnabled={planActionsEnabled}
            onProcessProposal={onProcessProposal}
            onRefineProposal={onRefineProposal}
          />
        ))}
        {showProgress && <WorkProgressIndicator key="output-tail-progress" progress={progress} idle={!streaming && !isWaitingUserInput} />}
      </div>
    );
  }

  let finalEntryIndex = -1;
  if (!streaming) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const part = entries[index].part;
      if (part.type === 'text' && part.text.trim() && !isSubagentLaunchNotice(part.text)) {
        finalEntryIndex = index;
        break;
      }
    }
  } else {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const part = entries[index].part;
      if (part.type === 'text' && /<proposed_plan>/i.test(part.text)) {
        finalEntryIndex = index;
        break;
      }
    }
  }

  const workItems = entries.flatMap(({ part }, index) => {
    if (index === finalEntryIndex) return [];
    if (part.type === 'text' && isSubagentLaunchNotice(part.text)) return [];
    return [part];
  });
  const workDuration = resolveCompletedWorkDurationMs(messages, workItems, startedAt, streaming);
  const fileChanges = streaming ? [] : collectTurnFileChanges(entries.map(({ part }) => part), { workspacePath });
  const finalEntry = finalEntryIndex >= 0 ? entries[finalEntryIndex] : undefined;
  const finalMessage = finalEntry && finalEntry.part.type === 'text'
    ? {
        ...finalEntry.message,
        content: finalEntry.part.text,
        thinking: undefined,
        thinkingDurationMs: undefined,
        parts: [finalEntry.part],
      }
    : undefined;

  return (
    <div className="assistant-turn-segment w-full min-w-0 max-w-full" data-assistant-turn>
      <AssistantWork
        items={workItems}
        streaming={streaming}
        durationMs={workDuration}
        onExpandedChange={setWorkExpanded}
      />
      {finalMessage && (
        <div className={`turn-final-response ${!streaming && workExpanded ? 'after-expanded-work' : ''} w-full min-w-0 max-w-full`}>
          <AgentBubble
            message={finalMessage}
            workflowProposal={workflowProposal}
            planActionsEnabled={planActionsEnabled}
            onProcessProposal={onProcessProposal}
            onRefineProposal={onRefineProposal}
          />
        </div>
      )}
      <TurnFilesSummary files={fileChanges} />
      {showProgress && <WorkProgressIndicator key="output-tail-progress" progress={progress} idle={!streaming && !isWaitingUserInput} />}
    </div>
  );
};
