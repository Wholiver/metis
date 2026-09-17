import React, { useMemo } from 'react';
import { CollaborationMode, Message, ModelOption } from '../../types';
import { SubagentItem } from '../../lib/subagents';
import { UserBubble } from './UserBubble';
import { AssistantTurn } from './AssistantTurn';

interface SubagentConversationProps {
  subagent: SubagentItem;
  className?: string;
  contentRef?: React.Ref<HTMLDivElement>;
  onOpenSubagent?: (partId: string) => void;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
}

export function buildSubagentTaskMessage(subagent: SubagentItem): Message {
  const task = String(subagent.task || '').trim() || 'No task description';
  const context = String(subagent.context || '').trim();
  return {
    id: `${subagent.id}-task`,
    role: 'user',
    content: context ? `${task}\n\n${context}` : task,
  };
}

export function buildSubagentAssistantMessage(subagent: SubagentItem): Message {
  const streaming = subagent.status === 'running';
  const failed = subagent.status === 'failed';
  const parts = subagent.parts.length > 0
    ? subagent.parts
    : (!streaming && subagent.result
      ? [{ type: 'text' as const, id: `${subagent.id}-result`, text: subagent.result }]
      : []);
  return {
    id: subagent.id,
    role: 'assistant',
    content: '',
    parts,
    serverTimestamp: subagent.startedAt,
    completedAt: subagent.completedAt,
    streaming,
    ...(failed
      ? {
          stopReason: 'error',
          errorMessage: subagent.error || 'Subagent failed',
        }
      : {}),
  };
}

/** Main-pane subagent transcript — same UserBubble + AssistantTurn path as parent chat. */
export const SubagentConversation: React.FC<SubagentConversationProps> = ({
  subagent,
  className,
  contentRef,
  onOpenSubagent,
  collaborationMode,
  model,
}) => {
  const streaming = subagent.status === 'running';
  const userMessage = useMemo(() => buildSubagentTaskMessage(subagent), [subagent]);
  const assistantMessage = useMemo(() => buildSubagentAssistantMessage(subagent), [subagent]);

  return (
    <div
      ref={contentRef}
      className={className ?? 'min-h-0 flex-1 overflow-y-auto px-4 py-4 flex flex-col items-center'}
      style={{ scrollbarGutter: 'stable both-edges', overflowAnchor: 'none' }}
      data-subagent-conversation=""
      data-message-scroll=""
    >
      <div
        className="flex w-full min-w-0 max-w-[620px] flex-col"
        data-message-lane=""
      >
        <UserBubble message={userMessage} />
        <AssistantTurn
          messages={[assistantMessage]}
          startedAt={subagent.startedAt}
          streaming={streaming}
          showProgress={streaming}
          onOpenSubagent={onOpenSubagent}
          collaborationMode={collaborationMode}
          model={model}
        />
      </div>
    </div>
  );
};
