import React from 'react';
import { SubagentItem } from '../../lib/subagents';
import { SubagentConversation } from '../chat/SubagentConversation';

interface SubagentDetailViewProps {
  subagent: SubagentItem;
  onBack?: () => void;
  contentRef?: React.Ref<HTMLDivElement>;
}

/** @deprecated Inspector no longer hosts detail; kept as a thin wrapper for shared transcript. */
export const SubagentDetailView: React.FC<SubagentDetailViewProps> = ({ subagent, contentRef }) => (
  <div className="flex h-full flex-col overflow-hidden bg-page" data-subagent-detail-view="">
    <SubagentConversation
      subagent={subagent}
      contentRef={contentRef}
    />
  </div>
);
