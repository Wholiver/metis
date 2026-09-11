import React from 'react';
import { Message, WorkflowProposalState } from '../../types';
import { extractProposedPlan } from '../../lib/plan-preview';
import { FileCard } from './FileCard';
import { MarkdownContent } from './MarkdownContent';
import { PlanPreview } from './PlanPreview';
import { PacedMarkdown } from './PacedMarkdown';
import StreamingText from '../primitives/StreamingText';

interface AgentBubbleProps {
  message: Message;
  workflowProposal?: WorkflowProposalState;
  onOpenPlan?: (markdown: string) => void;
}

export const AgentBubble = React.memo<AgentBubbleProps>(({
  message,
  workflowProposal,
  onOpenPlan,
}) => {
  const proposedPlan = extractProposedPlan(message.content, Boolean(message.streaming));
  const current = Boolean(
    proposedPlan
    && !proposedPlan.partial
    && workflowProposal
    && workflowProposal.markdown.trim() === proposedPlan.plan.trim()
  );
  const streaming = Boolean(message.streaming);

  return (
    <div
      className="my-2 flex w-full min-w-0 max-w-full flex-col items-start"
      data-message-id={message.id}
      data-message-role="assistant"
      data-component="text-part"
      data-streaming={streaming ? 'true' : undefined}
    >
      {message.content && (
        <div
          className="w-full min-w-0 max-w-full py-0.5 text-[14px] font-normal leading-[1.6] text-ink"
          data-slot="text-part-body"
        >
          <StreamingText streaming={streaming} fill>
            {proposedPlan ? (
              <>
                {proposedPlan.before && (
                  <PacedMarkdown text={proposedPlan.before} streaming={streaming} className="mb-2" />
                )}
                <PlanPreview
                  markdown={proposedPlan.plan}
                  partial={proposedPlan.partial}
                  current={current}
                  onOpenPlan={onOpenPlan}
                />
                {proposedPlan.after && (
                  <MarkdownContent markdown={proposedPlan.after} className="mt-2" />
                )}
              </>
            ) : (
              <PacedMarkdown text={message.content} streaming={streaming} />
            )}
          </StreamingText>
        </div>
      )}

      {message.file && (
        <div className="mt-1.5 mb-1">
          <FileCard file={message.file} />
        </div>
      )}
    </div>
  );
});

AgentBubble.displayName = 'AgentBubble';
