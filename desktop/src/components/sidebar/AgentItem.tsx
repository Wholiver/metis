import React from 'react';
import { Agent } from '../../types';
import { PixelOrbitLoader } from './PixelOrbitLoader';

interface AgentItemProps {
  agent: Agent;
  isActive: boolean;
  isWorking?: boolean;
  onClick: () => void;
  /** Align title under the project name while the selection pill spans the full project row width. */
  indented?: boolean;
}

export const AgentItem = React.memo<AgentItemProps>(({ agent, isActive, isWorking = false, onClick, indented = false }) => {
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      aria-busy={isWorking ? true : undefined}
      data-conversation-row={agent.id}
      data-conversation-working={isWorking ? 'true' : undefined}
      className={`w-full h-8 ${indented ? 'pl-[30px] pr-2' : 'px-2'} rounded-[8px] flex items-center transition-[color,transform] active:scale-[0.98] motion-reduce:active:scale-100 text-left relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] z-[1] ${
        isActive
          ? 'font-medium text-ink'
          : 'font-normal text-ink-2 hover:text-ink'
      }`}
    >
      <div className="min-w-0 flex-1 flex items-center justify-between gap-3" data-conversation-content="">
        <span className="relative min-w-0 truncate text-[14px] leading-none">
          {isWorking ? (
            <span className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2">
              <PixelOrbitLoader />
            </span>
          ) : null}
          {agent.name}
        </span>
        {agent.time ? (
          <span className="text-[11px] text-ink-3 flex-shrink-0 tabular-nums leading-none">
            {agent.time}
          </span>
        ) : null}
      </div>
      {agent.unread && (
        <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" aria-hidden="true" />
      )}
    </button>
  );
});

AgentItem.displayName = 'AgentItem';
