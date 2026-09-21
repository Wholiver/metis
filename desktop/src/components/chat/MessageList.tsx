import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { CollaborationMode, Message, ModelOption, PendingUserInput, SendMessageOptions, WorkflowProposalState } from '../../types';
import { UserBubble } from './UserBubble';
import { AssistantTurn } from './AssistantTurn';
import LoadingState from '../primitives/LoadingState';
import { useI18n } from '../../i18n';
import { useAutoScroll } from '../../hooks/useAutoScroll';

/**
 * Scroll-follow fingerprint for missed layout when tools/thinking appear.
 * Text-token length is intentionally omitted — ResizeObserver covers token growth.
 */
export function messageListContentEpoch(messages: Message[], isStreaming: boolean): string {
  const last = messages[messages.length - 1];
  if (!last) return `0:::${isStreaming ? 1 : 0}`;
  const lastTool = [...(last.parts || [])].reverse().find((part) => part.type === 'toolCall');
  const thinkLen = last.thinking ? 1 : 0;
  const partsCount = last.parts?.length ?? 0;
  const toolState = lastTool && lastTool.type === 'toolCall'
    ? `${lastTool.id}:${lastTool.progress?.state ?? ''}:${lastTool.result ? 1 : 0}`
    : '';
  return `${messages.length}:${last.id}:${partsCount}:${thinkLen}:${toolState}:${isStreaming ? 1 : 0}`;
}

interface MessageListProps {
  sessionId?: string;
  messages: Message[];
  workspacePath?: string;
  projectName?: string;
  timeDivider?: string;
  isLoading?: boolean;
  isStreaming?: boolean;
  isHomeEmpty?: boolean;
  workflowProposal?: WorkflowProposalState;
  onOpenPlan?: (markdown: string) => void;
  pendingUserInput?: PendingUserInput;
  onSendMessage?: (text: string, options?: SendMessageOptions) => boolean | void | Promise<boolean | void>;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
  onOpenSubagent?: (partId: string) => void;
}

export const MessageList = React.memo<MessageListProps>(({
  sessionId,
  messages,
  workspacePath,
  projectName,
  timeDivider,
  isLoading = false,
  isStreaming = false,
  isHomeEmpty = false,
  workflowProposal,
  onOpenPlan,
  pendingUserInput,
  onSendMessage,
  collaborationMode,
  model,
  onOpenSubagent,
}) => {
  const { t } = useI18n();
  void workspacePath;
  void projectName;
  const working = isStreaming || Boolean(pendingUserInput);
  const {
    setScrollElement,
    setContentElement,
    handleScroll,
    handleInteraction,
    resume,
    scrollToBottom,
  } = useAutoScroll({
    working,
    overflowAnchor: 'none',
    bottomThreshold: 10,
  });

  const onSendMessageRef = useRef(onSendMessage);
  onSendMessageRef.current = onSendMessage;
  const handleRetry = useCallback((promptText: string) => {
    void onSendMessageRef.current?.(promptText);
  }, []);

  const latestUserMessage = useMemo(
    () => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') return messages[index];
      }
      return undefined;
    },
    [messages],
  );
  const latestUserId = latestUserMessage?.id;
  const latestUserTimestamp = latestUserMessage?.serverTimestamp;
  const previousUserIdRef = useRef(latestUserId);
  const previousSessionIdRef = useRef(sessionId);
  const scrollFollowEpoch = messageListContentEpoch(messages, isStreaming);

  const bindScroll = useCallback((el: HTMLDivElement | null) => {
    setScrollElement(el);
  }, [setScrollElement]);

  const bindLane = useCallback((el: HTMLDivElement | null) => {
    setContentElement(el);
  }, [setContentElement]);

  useLayoutEffect(() => {
    if (sessionId !== previousSessionIdRef.current) {
      previousSessionIdRef.current = sessionId;
      previousUserIdRef.current = latestUserId;
      resume();
      return;
    }
    if (latestUserId !== previousUserIdRef.current) {
      previousUserIdRef.current = latestUserId;
      resume();
      return;
    }
    // Follow newly appended messages, tool start/end, and loading transitions.
    // Token growth is handled by ResizeObserver in useAutoScroll.
    scrollToBottom();
  }, [sessionId, latestUserId, scrollFollowEpoch, isLoading, resume, scrollToBottom]);

  const visibleTimeDivider = timeDivider || messages.find((message) => message.time)?.time;
  const renderGroups = useMemo(() => {
    const groups: Array<
      | { type: 'user'; key: string; message: Message }
      | { type: 'assistant'; key: string; messages: Message[]; startedAt?: string | number; promptText?: string }
    > = [];
    let latestUserTs: string | number | undefined;
    let latestUserPrompt: string | undefined;
    for (const message of messages) {
      if (message.role === 'user') {
        groups.push({ type: 'user', key: message.id, message });
        latestUserTs = message.serverTimestamp;
        latestUserPrompt = typeof message.content === 'string' ? message.content : undefined;
        continue;
      }
      const previous = groups.at(-1);
      if (previous?.type === 'assistant') {
        previous.messages.push(message);
        if (!previous.promptText && latestUserPrompt) {
          previous.promptText = latestUserPrompt;
        }
      } else {
        groups.push({
          type: 'assistant',
          key: `turn-${message.id}`,
          messages: [message],
          startedAt: latestUserTs,
          promptText: latestUserPrompt,
        });
      }
    }
    return groups;
  }, [messages]);

  const activeAssistantGroup = renderGroups.at(-1)?.type === 'assistant' ? renderGroups.at(-1) : undefined;
  const showEmptyActiveTurn = (isStreaming || Boolean(pendingUserInput)) && !activeAssistantGroup;
  // Only the live assistant group (or the empty active turn below) may carry streaming/progress.
  // Never fall back to a previous completed assistant turn when the latest group is a user message.
  const progressGroup = activeAssistantGroup;

  return (
    <div
      ref={bindScroll}
      onScroll={handleScroll}
      onMouseDown={handleInteraction}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4 flex flex-col items-center"
      style={{ scrollbarGutter: 'stable both-edges', overflowAnchor: 'none' }}
      data-message-scroll=""
    >
      <div
        ref={bindLane}
        className={`flex w-full min-w-0 max-w-[620px] flex-col ${messages.length === 0 ? 'flex-1' : ''}`}
        data-message-lane=""
      >
        {visibleTimeDivider && (
          <div className="flex justify-center my-2 mb-4">
            <span className="text-[11.5px] font-medium text-ink-3 tabular-nums">
              {visibleTimeDivider}
            </span>
          </div>
        )}

        <div className={`flex w-full min-w-0 max-w-full flex-col ${messages.length === 0 ? 'flex-1' : ''}`}>
          {isLoading && messages.length === 0 && (
            <LoadingState className="mx-auto py-12" label={t('reactUiLoadingConversation') || 'Loading conversation…'} />
          )}
          {renderGroups.map((group) =>
            group.type === 'user' ? (
              <UserBubble key={group.key} message={group.message} />
            ) : (
              <AssistantTurn
                key={group.key}
                messages={group.messages}
                startedAt={group.startedAt}
                streaming={Boolean(isStreaming && group === activeAssistantGroup)}
                showProgress={group === progressGroup}
                workflowProposal={workflowProposal}
                onOpenPlan={onOpenPlan}
                pendingUserInput={group === progressGroup ? pendingUserInput : undefined}
                onRetry={group.promptText ? handleRetry : undefined}
                retryPrompt={group.promptText}
                collaborationMode={collaborationMode}
                model={model}
                onOpenSubagent={onOpenSubagent}
              />
            )
          )}
          {showEmptyActiveTurn && (
            <AssistantTurn
              key="active-assistant-turn"
              messages={[]}
              startedAt={latestUserTimestamp}
              streaming={isStreaming}
              showProgress
              pendingUserInput={pendingUserInput}
              collaborationMode={collaborationMode}
              model={model}
              onOpenSubagent={onOpenSubagent}
            />
          )}
          {!isHomeEmpty ? (
            <div
              aria-hidden="true"
              className="w-full flex-none"
              style={{ height: 'calc(var(--composer-overlay-height, 100px) + 16px)' }}
              data-composer-clearance=""
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

MessageList.displayName = 'MessageList';
