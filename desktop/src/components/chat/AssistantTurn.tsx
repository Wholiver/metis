import React, { useMemo, useRef } from 'react';
import { AssistantContentPart, CollaborationMode, Message, ModelOption, PendingUserInput, WorkflowProposalState } from '../../types';
import { estimateThinkingDurationMs } from '../../lib/thinking';
import { AgentBubble } from './AgentBubble';
import { AssistantWork } from './AssistantWork';
import { AssistantErrorCard } from './AssistantErrorCard';
import { AssistantTurnFooter } from './AssistantTurnFooter';
import { useI18n } from '../../i18n';

interface AssistantTurnProps {
  messages: Message[];
  startedAt?: string | number;
  streaming?: boolean;
  isCompacting?: boolean;
  showProgress?: boolean;
  workflowProposal?: WorkflowProposalState;
  onOpenPlan?: (markdown: string) => void;
  pendingUserInput?: PendingUserInput;
  onRetry?: (promptText: string) => void;
  retryPrompt?: string;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
  onOpenSubagent?: (partId: string) => void;
}

export function isSubagentLaunchNotice(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized || normalized.length > 240 || (!/subagent/i.test(normalized) && !/spawn_agent/i.test(normalized) && !/agent/i.test(normalized))) return false;
  return /(已启动|启动了|started|launched|spawning|spawned)/i.test(normalized)
    && /(等待|等它|waiting|wait for|background)/i.test(normalized);
}

/** Strips internal subagent/child task quota notices from text. */
export function stripInternalQuotaNotices(text: string): string {
  if (!text) return '';
  let cleaned = text;
  // Match prefix or line-starting subagent quota / limit notices (Chinese)
  cleaned = cleaned.replace(
    /(?:^|\n)\s*(?:子代理|子任务|并发\s*Agent|Agent)\s*(?:额度|配额|上限)?\s*(?:已用尽|已满|达到上限|已达上限|超限)\s*(?:[（(][^）\n]*[）)])?[，,。；;]?\s*(?:因此|所以)?\s*/gi,
    '\n',
  );
  // Match inverted phrase variant e.g. "子代理额度已用尽（root 的 16 个子任务上限已满）"
  cleaned = cleaned.replace(
    /(?:^|\n)\s*(?:子代理|子任务)\s*(?:额度|配额)?\s*(?:已用尽|已满)?[，,。\s]*[（(][^）\n]*(?:上限|额度|子任务|root)[^）\n]*[）)][，,。；;]?\s*(?:因此|所以)?\s*/gi,
    '\n',
  );
  // Match English errors: "Maximum children per agent (16) reached." or "MAX_CHILDREN_EXCEEDED"
  cleaned = cleaned.replace(
    /(?:^|\n)\s*(?:Maximum children per agent|Global spawned child limit|MAX_CHILDREN_EXCEEDED)[^.\n]*(?:\.|\n|$)\s*/gi,
    '\n',
  );
  return cleaned.trim();
}

export function isInternalQuotaNotice(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  return stripInternalQuotaNotices(normalized).length === 0;
}

/** Final assistant text only — never thinking, tools, or intermediate narration. */
export function resolveAssistantFinalCopyText(
  messages: Message[],
  options: { streaming?: boolean; failureMessage?: Message } = {},
): string {
  return resolveAssistantTurnLayout(messages, options).finalText;
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
  if (message.content) {
    const cleaned = stripInternalQuotaNotices(message.content);
    if (cleaned) parts.push({ type: 'text', id: `${message.id}-text`, text: cleaned });
  }
  return parts;
}

function isVisibleWorkText(part: AssistantContentPart, failureMessage?: Message): part is Extract<AssistantContentPart, { type: 'text' }> {
  if (part.type !== 'text') return false;
  const cleaned = stripInternalQuotaNotices(part.text);
  return Boolean(cleaned.trim())
    && !isSubagentLaunchNotice(cleaned)
    && (!failureMessage || cleaned !== failureMessage.errorMessage);
}

export function resolveAssistantTurnLayout(
  messages: Message[],
  options: { streaming?: boolean; failureMessage?: Message } = {},
): {
  workItems: AssistantContentPart[];
  finalText: string;
  finalEntry?: { message: Message; part: Extract<AssistantContentPart, { type: 'text' }> };
} {
  const failureMessage = options.failureMessage;
  const rawEntries = messages.flatMap((message) => (message.parts || fallbackParts(message)).map((part) => ({ message, part })));
  const entries = rawEntries.flatMap(({ message, part }) => {
    if (part.type === 'text') {
      const cleaned = stripInternalQuotaNotices(part.text);
      if (!cleaned) return [];
      return [{ message, part: { ...part, text: cleaned } }];
    }
    return [{ message, part }];
  });
  let finalEntryIndex = -1;
  if (!options.streaming) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (isVisibleWorkText(entries[index].part, failureMessage)) {
        if (failureMessage && entries[index].message !== failureMessage) {
          continue;
        }
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
    if (part.type === 'text' && !part.text.trim()) return [];
    if (part.type === 'text' && isSubagentLaunchNotice(part.text)) return [];
    if (part.type === 'text' && failureMessage && part.text === failureMessage.errorMessage) return [];
    return [part];
  });

  const finalEntry = finalEntryIndex >= 0 && entries[finalEntryIndex].part.type === 'text'
    ? { message: entries[finalEntryIndex].message, part: entries[finalEntryIndex].part }
    : undefined;

  let finalText = '';
  if (!options.streaming) {
    if (finalEntry) {
      finalText = finalEntry.part.text.trim();
    } else if (!failureMessage) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const text = message.content?.trim();
        if (text) {
          finalText = text;
          break;
        }
      }
    }
  }

  return { workItems, finalText, finalEntry };
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

function reuseStablePartList(
  previous: AssistantContentPart[] | undefined,
  next: AssistantContentPart[],
): AssistantContentPart[] {
  if (!previous) return next;
  if (previous === next) return previous;
  if (previous.length !== next.length) return next;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) return next;
  }
  return previous;
}

function areAssistantTurnPropsEqual(prev: AssistantTurnProps, next: AssistantTurnProps): boolean {
  if (prev.streaming !== next.streaming) return false;
  if (prev.isCompacting !== next.isCompacting) return false;
  if (prev.showProgress !== next.showProgress) return false;
  if (prev.startedAt !== next.startedAt) return false;
  if (prev.workflowProposal !== next.workflowProposal) return false;
  if (prev.pendingUserInput !== next.pendingUserInput) return false;
  if (prev.onOpenPlan !== next.onOpenPlan) return false;
  if (prev.onOpenSubagent !== next.onOpenSubagent) return false;
  if (prev.collaborationMode !== next.collaborationMode) return false;
  if (prev.model !== next.model) return false;
  if (prev.retryPrompt !== next.retryPrompt) return false;

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
  startedAt: _startedAt,
  streaming = false,
  isCompacting = false,
  showProgress = false,
  workflowProposal,
  onOpenPlan,
  pendingUserInput,
  onRetry,
  retryPrompt,
  collaborationMode,
  model,
  onOpenSubagent,
}) => {
  const { t } = useI18n();
  const isWaitingUserInput = Boolean(pendingUserInput);
  const failureMessage = !streaming ? messages.find((m) => (
    m.stopReason === 'error' ||
    m.stopReason === 'aborted' ||
    (m.stopReason === 'length' && (!m.content || !m.content.trim())) ||
    Boolean(m.errorMessage)
  )) : undefined;
  const errorText = failureMessage
    ? (failureMessage.errorMessage || failureMessage.content || (
        failureMessage.stopReason === 'length'
          ? (t('assistantLengthError') || 'Response truncated: context window limit reached.')
          : undefined
      ))
    : undefined;
  const layout = resolveAssistantTurnLayout(messages, { streaming, failureMessage });
  const workItemsRef = useRef<AssistantContentPart[]>([]);
  const workItems = reuseStablePartList(workItemsRef.current, layout.workItems);
  workItemsRef.current = workItems;
  const finalEntryMessage = layout.finalEntry?.message;
  const finalEntryPart = layout.finalEntry?.part;
  const finalMessage = useMemo((): Message | undefined => {
    if (!finalEntryMessage || !finalEntryPart) return undefined;
    return {
      ...finalEntryMessage,
      content: finalEntryPart.text,
      thinking: undefined,
      thinkingDurationMs: undefined,
      parts: [finalEntryPart],
    };
  }, [finalEntryMessage, finalEntryPart]);
  const copyText = layout.finalText;
  const footer = !streaming && (copyText || collaborationMode || model) ? (
    <AssistantTurnFooter
      copyText={copyText}
      collaborationMode={collaborationMode}
      model={model}
    />
  ) : null;
  const retryHandler = failureMessage && retryPrompt && onRetry
    ? () => onRetry(retryPrompt)
    : undefined;
  const hasWork = streaming || isCompacting || isWaitingUserInput || workItems.some((part) => part.type === 'thinking' || part.type === 'toolCall');
  if (!hasWork) {
    const nonFailureMessages = failureMessage
      ? messages.filter((m) => m !== failureMessage && m.content && m.content !== failureMessage.errorMessage)
      : messages;
    const cleanedMessages = nonFailureMessages.map((m) => {
      const cleaned = stripInternalQuotaNotices(m.content || '');
      if (cleaned === m.content) return m;
      return { ...m, content: cleaned };
    }).filter((m) => Boolean(m.content?.trim()));
    const content = (
      <>
        {cleanedMessages.map((message) => (
          <AgentBubble
            key={message.id}
            message={message}
            workflowProposal={workflowProposal}
            onOpenPlan={onOpenPlan}
          />
        ))}
        {failureMessage && <AssistantErrorCard error={errorText} onRetry={retryHandler} />}
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

  return (
    <div className="assistant-turn-segment w-full min-w-0 max-w-full" data-assistant-turn>
      <AssistantWork
        items={workItems}
        streaming={streaming}
        isCompacting={isCompacting}
        onOpenSubagent={onOpenSubagent}
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
          onRetry={retryHandler}
        />
      )}
      {footer}
    </div>
  );
};

export const AssistantTurn = React.memo<AssistantTurnProps>(AssistantTurnComponent, areAssistantTurnPropsEqual);
AssistantTurn.displayName = 'AssistantTurn';
