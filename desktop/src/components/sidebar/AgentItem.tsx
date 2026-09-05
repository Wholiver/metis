import React from 'react';
import { Agent } from '../../types';
import { ConversationIcon } from './ConversationIcon';

interface AgentItemProps {
  agent: Agent;
  isActive: boolean;
  onClick: () => void;
}

export const AgentItem = React.memo<AgentItemProps>(({ agent, isActive, onClick }) => {
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      data-conversation-row={agent.id}
      className={`w-full min-h-[56px] px-2.5 py-1.5 rounded-[10px] flex items-center gap-2.5 transition-[color,transform] active:scale-[0.96] motion-reduce:active:scale-100 text-left relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 z-[1] ${
        isActive
          ? 'font-medium text-[#0f172a]'
          : 'text-[#334155] hover:text-[#0f172a]'
      }`}
    >
      <ConversationIcon seed={agent.id} />

      <div className="min-w-0 flex-1 flex flex-col gap-0.5" data-conversation-content="">
        <div className="flex items-center justify-between gap-1 w-full">
          <span className="font-semibold text-[13.5px] text-[#0f172a] truncate">
            {agent.name}
          </span>
          <span className="text-[11.5px] text-[#9ca3af] flex-shrink-0 tabular-nums">
            {agent.time}
          </span>
        </div>

        <div className="flex items-center justify-between gap-1.5 w-full">
          <p className="text-[12px] text-[#64748b] truncate leading-tight" title={agent.subtitle}>
            {agent.subtitle}
          </p>
          {agent.unread && (
            <span className="w-2 h-2 rounded-full bg-[#2563eb] flex-shrink-0" />
          )}
        </div>
      </div>
    </button>
  );
});

AgentItem.displayName = 'AgentItem';
