import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { CollaborationMode, Message, ModelOption, PendingUserInput, SendMessageOptions, WorkflowProposalState } from '../../types';
import { UserBubble } from './UserBubble';
import { AssistantTurn } from './AssistantTurn';
import { ChatHomeEmptyState } from './ChatHomeEmptyState';
import LoadingState from '../primitives/LoadingState';
import { useI18n } from '../../i18n';
import { useAutoScroll } from '../../hooks/useAutoScroll';

interface MessageListProps {
  messages: Message[];
  workspacePath?: string;
  projectName?: string;
  timeDivider?: string;
  isLoading?: boolean;
  isStreaming?: boolean;
  workflowProposal?: WorkflowProposalState;
  onOpenPlan?: (markdown: string) => void;
  pendingUserInput?: PendingUserInput;
  onSendMessage?: (text: string, options?: SendMessageOptions) => boolean | void | Promise<boolean | void>;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
}

export const MessageList = React.memo<MessageListProps>(({
  messages,
  workspacePath,
  projectName,
  timeDivider,
  isLoading = false,
  isStreaming = false,
  workflowProposal,
  onOpenPlan,
  pendingUserInput,
  onSendMessage,
  collaborationMode,
  model,
}) => {
  const { t } = useI18n();
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestUserId = latestUserMessage?.id;
  const latestUserTimestamp = latestUserMessage?.serverTimestamp;
  const previousUserIdRef = useRef(latestUserId);

  const bindScroll = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setScrollElement(el);
  }, [setScrollElement]);

  const bindLane = useCallback((el: HTMLDivElement | null) => {
    laneRef.current = el;
    setContentElement(el);
  }, [setContentElement]);

  useLayoutEffect(() => {
    if (latestUserId !== previousUserIdRef.current) {
      previousUserIdRef.current = latestUserId;
      resume();
      return;
    }
    // Content growth follows only while the user has not scrolled away.
    scrollToBottom();
  }, [latestUserId, isLoading, isStreaming, messages, resume, scrollToBottom]);

  useEffect(() => {
    const lane = laneRef.current;
    const container = containerRef.current;
    if (!lane && !container) return;
    const onLayout = () => scrollToBottom();
    const observer = new ResizeObserver(onLayout);
    if (lane) observer.observe(lane);
    if (container) observer.observe(container);
    const clearance = lane?.querySelector('[data-composer-clearance]');
    if (clearance) observer.observe(clearance);
    lane?.addEventListener('load', onLayout, true);
    return () => {
      observer.disconnect();
      lane?.removeEventListener('load', onLayout, true);
    };
  }, [scrollToBottom, messages.length, working]);

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

  const lastAssistantGroup = [...renderGroups].reverse().find((group) => group.type === 'assistant');
  const activeAssistantGroup = renderGroups.at(-1)?.type === 'assistant' ? renderGroups.at(-1) : undefined;
  const progressGroup = isStreaming ? (activeAssistantGroup || lastAssistantGroup) : lastAssistantGroup;

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
        className={`flex w-full min-w-0 max-w-[620px] flex-col ${messages.length === 0 ? 'flex-1' : 'min-h-full'}`}
        data-message-lane=""
      >
        {messages.length > 0 && <div className="flex-1 min-h-0" aria-hidden="true" />}
        {visibleTimeDivider && (
          <div className="flex justify-center my-2 mb-4">
            <span className="text-[11.5px] font-medium text-ink-3 tabular-nums">
              {visibleTimeDivider}
            </span>
          </div>
        )}

        <div className={`flex w-full min-w-0 max-w-full flex-col ${messages.length === 0 ? 'flex-1 justify-center items-center' : ''}`}>
          {isLoading && messages.length === 0 && (
            <LoadingState className="mx-auto py-12" label={t('reactUiLoadingConversation') || 'Loading conversation…'} />
          )}
          {!isLoading && messages.length === 0 && !isStreaming && !pendingUserInput && (
            <ChatHomeEmptyState
              projectName={projectName || workspacePath?.split('/').filter(Boolean).pop()}
            />
          )}
          {renderGroups.map((group) =>
            group.type === 'user' ? (
              <UserBubble key={group.key} message={group.message} />
            ) : (
              <AssistantTurn
                key={group.key}
                messages={group.messages}
                startedAt={group.startedAt}
                streaming={isStreaming && (group === activeAssistantGroup || (!activeAssistantGroup && group === progressGroup))}
                showProgress={group === progressGroup}
                workflowProposal={workflowProposal}
                onOpenPlan={onOpenPlan}
                pendingUserInput={group === progressGroup ? pendingUserInput : undefined}
                onRetry={group.promptText && onSendMessage ? () => onSendMessage(group.promptText!) : undefined}
                collaborationMode={collaborationMode}
                model={model}
              />
            )
          )}
          {(isStreaming || Boolean(pendingUserInput)) && !activeAssistantGroup && !lastAssistantGroup && (
            <AssistantTurn
              key="active-assistant-turn"
              messages={[]}
              startedAt={latestUserTimestamp}
              streaming
              showProgress
              pendingUserInput={pendingUserInput}
              collaborationMode={collaborationMode}
              model={model}
            />
          )}
          <div
            aria-hidden="true"
            className="w-full flex-none"
            style={{ height: 'calc(var(--composer-overlay-height, 100px) + 16px)' }}
            data-composer-clearance=""
          />
        </div>
      </div>
    </div>
  );
});

MessageList.displayName = 'MessageList';
