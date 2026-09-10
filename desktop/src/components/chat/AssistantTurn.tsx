import React from 'react';
import { AssistantContentPart, CollaborationMode, Message, ModelOption, PendingUserInput, WorkflowProposalState } from '../../types';
import { estimateThinkingDurationMs } from '../../lib/thinking';
import { AgentBubble } from './AgentBubble';
import { AssistantWork } from './AssistantWork';
import { AssistantErrorCard } from './AssistantErrorCard';
import { AssistantTurnFooter } from './AssistantTurnFooter';

interface AssistantTurnProps {
  messages: Message[];
  startedAt?: string | number;
  streaming?: boolean;
  showProgress?: boolean;
  workflowProposal?: WorkflowProposalState;
  onOpenPlan?: (markdown: string) => void;
  pendingUserInput?: PendingUserInput;
  onRetry?: () => void;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
}

export function isSubagentLaunchNotice(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized || normalized.length > 240 || (!/subagent/i.test(normalized) && !/spawn_agent/i.test(normalized) && !/agent/i.test(normalized))) return false;
  return /(已启动|启动了|started|launched|spawning|spawned)/i.test(normalized)
    && /(等待|等它|waiting|wait for|background)/i.test(normalized);
}

/** Final assistant text only — never thinking, tools, or intermediate narration. */
export function resolveAssistantFinalCopyText(
  messages: Message[],
  options: { streaming?: boolean; failureMessage?: Message } = {},
): string {
  if (options.streaming) return '';
  const failureMessage = options.failureMessage;
  const entries = messages.flatMap((message) => (message.parts || fallbackParts(message)).map((part) => ({ message, part })));
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const part = entries[index].part;
    if (
      part.type === 'text'
      && part.text.trim()
      && !isSubagentLaunchNotice(part.text)
      && (!failureMessage || part.text !== failureMessage.errorMessage)
    ) {
      return part.text.trim();
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (failureMessage && message === failureMessage) continue;
    const text = message.content?.trim();
    if (text && text !== failureMessage?.errorMessage) return text;
  }
  return '';
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

function areAssistantTurnPropsEqual(prev: AssistantTurnProps, next: AssistantTurnProps): boolean {
  if (prev.streaming !== next.streaming) return false;
  if (prev.showProgress !== next.showProgress) return false;
  if (prev.startedAt !== next.startedAt) return false;
  if (prev.workflowProposal !== next.workflowProposal) return false;
  if (prev.pendingUserInput !== next.pendingUserInput) return false;
  if (prev.onOpenPlan !== next.onOpenPlan) return false;
  if (prev.onRetry !== next.onRetry) return false;
  if (prev.collaborationMode !== next.collaborationMode) return false;
  if (prev.model !== next.model) return false;

  const prevMsgs = prev.messages;
  const nextMsgs = next.messages;
  if (prevMsgs === nextMsgs) return true;
  if (prevMsgs.length !== nextMsgs.length) return false;
  for (let i = 0; i < prevMsgs.length; i++) {
    if (prevMsgs[i] !== nextMsgs[i]) return false;
  }
  return true;
}

const AssistantTurnComponent: React.FC<AssistantTurnProps> = ({
  messages,
  startedAt,
  streaming = false,
  showProgress = false,
  workflowProposal,
  onOpenPlan,
  pendingUserInput,
  onRetry,
  collaborationMode,
  model,
}) => {
  const isWaitingUserInput = Boolean(pendingUserInput);
  const failureMessage = !streaming ? messages.find((m) => (
    m.stopReason === 'error' ||
    m.stopReason === 'aborted' ||
    Boolean(m.errorMessage)
  )) : undefined;
  const errorText = failureMessage ? (failureMessage.errorMessage || failureMessage.content) : undefined;
  const entries = messages.flatMap((message) => (message.parts || fallbackParts(message)).map((part) => ({ message, part })));
  const copyText = resolveAssistantFinalCopyText(messages, { streaming, failureMessage });
  const footer = !streaming && (copyText || collaborationMode || model) ? (
    <AssistantTurnFooter
      copyText={copyText}
      collaborationMode={collaborationMode}
      model={model}
    />
  ) : null;
  const hasWork = streaming || isWaitingUserInput || entries.some(({ part }) => part.type === 'thinking' || part.type === 'toolCall');
  if (!hasWork) {
    const nonFailureMessages = failureMessage
      ? messages.filter((m) => m !== failureMessage && m.content && m.content !== failureMessage.errorMessage)
      : messages;
    const content = (
      <>
        {nonFailureMessages.map((message) => (
          <AgentBubble
            key={message.id}
            message={message}
            workflowProposal={workflowProposal}
            onOpenPlan={onOpenPlan}
          />
        ))}
        {failureMessage && <AssistantErrorCard error={errorText} onRetry={onRetry} />}
        {footer}
      </>
    );
    if (!showProgress && !footer) {
      return content;
    }
    return (
      <div className="assistant-turn-segment w-full min-w-0 max-w-full" data-assistant-turn>
        {content}
      </div>
    );
  }

  let finalEntryIndex = -1;
  if (!streaming) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const part = entries[index].part;
      if (
        part.type === 'text'
        && part.text.trim()
        && !isSubagentLaunchNotice(part.text)
        && (!failureMessage || part.text !== failureMessage.errorMessage)
      ) {
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
    if (part.type === 'text' && failureMessage && part.text === failureMessage.errorMessage) return [];
    return [part];
  });
  const workDuration = resolveCompletedWorkDurationMs(messages, workItems, startedAt, streaming);
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
      />
      {finalMessage && (
        <div className="turn-final-response after-expanded-work w-full min-w-0 max-w-full">
          <AgentBubble
            message={finalMessage}
            workflowProposal={workflowProposal}
            onOpenPlan={onOpenPlan}
          />
        </div>
      )}
      {failureMessage && (
        <AssistantErrorCard
          error={errorText}
          onRetry={onRetry}
        />
      )}
      {footer}
    </div>
  );
};

export const AssistantTurn = React.memo<AssistantTurnProps>(AssistantTurnComponent, areAssistantTurnPropsEqual);
AssistantTurn.displayName = 'AssistantTurn';
