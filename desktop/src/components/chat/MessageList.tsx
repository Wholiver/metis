import React, { useRef, useEffect } from 'react';
import { Message, PendingUserInput, SendMessageOptions, WorkflowProposalState } from '../../types';
import { UserBubble } from './UserBubble';
import { AssistantTurn } from './AssistantTurn';
import { ChatHomeEmptyState } from './ChatHomeEmptyState';

interface MessageListProps {
  messages: Message[];
  workspacePath?: string;
  projectName?: string;
  timeDivider?: string;
  isLoading?: boolean;
  isStreaming?: boolean;
  workflowProposal?: WorkflowProposalState;
  planActionsEnabled?: boolean;
  onProcessProposal?: () => void;
  onRefineProposal?: (request: string) => void;
  pendingUserInput?: PendingUserInput;
  onSendMessage?: (text: string, options?: SendMessageOptions) => boolean | void | Promise<boolean | void>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  workspacePath,
  projectName,
  timeDivider,
  isLoading = false,
  isStreaming = false,
  workflowProposal,
  planActionsEnabled = false,
  onProcessProposal,
  onRefineProposal,
  pendingUserInput,
  onSendMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevStreamingRef = useRef(isStreaming);
  const scrollRafRef = useRef<number | null>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom <= 48;
  };

  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      isNearBottomRef.current = true;
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (isStreaming && !isNearBottomRef.current) return;

    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = containerRef.current;
      if (el) {
        const clearanceEl = el.querySelector<HTMLElement>('[data-composer-clearance]');
        const clearanceHeight = clearanceEl ? clearanceEl.offsetHeight : 0;
        const contentHeight = el.scrollHeight - clearanceHeight;
        if (contentHeight <= el.clientHeight) {
          el.scrollTop = 0;
        } else {
          el.scrollTop = el.scrollHeight;
        }
      }
    });

    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [isLoading, isStreaming, messages]);

  const visibleTimeDivider = timeDivider || messages.find((message) => message.time)?.time;
  const renderGroups: Array<
    | { type: 'user'; key: string; message: Message }
    | { type: 'assistant'; key: string; messages: Message[]; startedAt?: string | number }
  > = [];
  let latestUserTimestamp: string | number | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      renderGroups.push({ type: 'user', key: message.id, message });
      latestUserTimestamp = message.serverTimestamp;
      continue;
    }
    const previous = renderGroups.at(-1);
    if (previous?.type === 'assistant') {
      previous.messages.push(message);
    } else {
      renderGroups.push({ type: 'assistant', key: `turn-${message.id}`, messages: [message], startedAt: latestUserTimestamp });
    }
  }
  const lastAssistantGroup = [...renderGroups].reverse().find((group) => group.type === 'assistant');
  const activeAssistantGroup = renderGroups.at(-1)?.type === 'assistant' ? renderGroups.at(-1) : undefined;
  const progressGroup = isStreaming ? (activeAssistantGroup || lastAssistantGroup) : lastAssistantGroup;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4 flex flex-col items-center"
      style={{ scrollbarGutter: 'stable both-edges' }}
      data-message-scroll=""
    >
      {/* Centered message lane with exact same max-w-[620px] as composer */}
      <div className={`flex w-full min-w-0 max-w-[620px] flex-col ${messages.length === 0 ? 'flex-1' : ''}`} data-message-lane="">
        {/* Centered time chip */}
        {visibleTimeDivider && (
          <div className="flex justify-center my-2 mb-4">
            <span className="text-[11.5px] font-medium text-[#94a3b8] tabular-nums">
              {visibleTimeDivider}
            </span>
          </div>
        )}

        {/* Message items */}
        <div className={`flex w-full min-w-0 max-w-full flex-col ${messages.length === 0 ? 'flex-1 justify-center items-center' : ''}`}>
          {isLoading && messages.length === 0 && (
            <p className="py-12 text-center text-[13px] text-[#94a3b8]" role="status">
              Loading conversation…
            </p>
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
                workspacePath={workspacePath}
                streaming={isStreaming && (group === activeAssistantGroup || (!activeAssistantGroup && group === progressGroup))}
                showProgress={group === progressGroup}
                workflowProposal={workflowProposal}
                planActionsEnabled={planActionsEnabled}
                onProcessProposal={onProcessProposal}
                onRefineProposal={onRefineProposal}
                pendingUserInput={group === progressGroup ? pendingUserInput : undefined}
              />
            )
          )}
          {(isStreaming || Boolean(pendingUserInput)) && !activeAssistantGroup && !lastAssistantGroup && (
            <AssistantTurn
              key="active-assistant-turn"
              messages={[]}
              startedAt={latestUserTimestamp}
              workspacePath={workspacePath}
              streaming
              showProgress
              pendingUserInput={pendingUserInput}
            />
          )}
          <div
            aria-hidden="true"
            className="w-full flex-none"
            style={{ height: 'calc(var(--composer-overlay-height, 100px) + 16px)' }}
            data-composer-clearance=""
          />
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
};
