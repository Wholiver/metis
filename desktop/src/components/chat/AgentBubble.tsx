import React from 'react';
import { Message, WorkflowProposalState } from '../../types';
import { extractProposedPlan } from '../../lib/plan-preview';
import { FileCard } from './FileCard';
import { MarkdownContent } from './MarkdownContent';
import { PlanPreview } from './PlanPreview';

interface AgentBubbleProps {
  message: Message;
  workflowProposal?: WorkflowProposalState;
  planActionsEnabled?: boolean;
  onProcessProposal?: () => void;
  onRefineProposal?: (request: string) => void;
}

export const AgentBubble: React.FC<AgentBubbleProps> = ({
  message,
  workflowProposal,
  planActionsEnabled = false,
  onProcessProposal,
  onRefineProposal,
}) => {
  const proposedPlan = extractProposedPlan(message.content, Boolean(message.streaming));
  const current = Boolean(
    proposedPlan
    && !proposedPlan.partial
    && workflowProposal
    && workflowProposal.markdown.trim() === proposedPlan.plan.trim()
  );

  return (
    <div
      className="my-2 flex w-full min-w-0 max-w-full flex-col items-start"
      data-message-id={message.id}
      data-message-role="assistant"
      data-streaming={message.streaming ? 'true' : undefined}
    >
      {message.content && (
        <div className="w-full min-w-0 max-w-full py-0.5 text-[14.5px] font-normal leading-relaxed text-[#1e293b]">
          {proposedPlan ? (
            <>
              {proposedPlan.before && <MarkdownContent markdown={proposedPlan.before} className="mb-2" />}
              <PlanPreview
                markdown={proposedPlan.plan}
                partial={proposedPlan.partial}
                current={current}
                revision={current ? workflowProposal?.revision : undefined}
                actionsEnabled={current && planActionsEnabled}
                onProcess={current ? onProcessProposal : undefined}
                onRefine={current ? onRefineProposal : undefined}
              />
              {proposedPlan.after && <MarkdownContent markdown={proposedPlan.after} className="mt-2" />}
            </>
          ) : (
            <MarkdownContent markdown={message.content} />
          )}
          {message.streaming && (
            <span className="inline-block w-1.5 h-1.5 ml-1.5 rounded-full bg-slate-400 align-middle" aria-label="Receiving message" />
          )}
        </div>
      )}

      {message.file && (
        <div className="mt-1.5 mb-1">
          <FileCard file={message.file} />
        </div>
      )}
    </div>
  );
};

