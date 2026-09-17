import React from 'react';
import { Archive } from 'lucide-react';
import { Agent } from '../../types';
import { PixelDotsLoader } from './PixelDotsLoader';

interface AgentItemProps {
  agent: Agent;
  isActive: boolean;
  isWorking?: boolean;
  onClick: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
  /** Align title under the project name while the selection pill spans the full project row width. */
  indented?: boolean;
}

export const AgentItem = React.memo<AgentItemProps>(({
  agent,
  isActive,
  isWorking = false,
  onClick,
  onArchive,
  archiveLabel = 'Archive conversation',
  indented = false,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      aria-busy={isWorking ? true : undefined}
      data-conversation-row={agent.id}
      data-conversation-working={isWorking ? 'true' : undefined}
      className={`group w-full h-8 ${indented ? 'pl-[30px] pr-2' : 'px-2'} rounded-[8px] flex items-center transition-[color,transform] active:scale-[0.98] motion-reduce:active:scale-100 text-left relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] z-[1] ${
        isActive
          ? 'font-medium text-ink'
          : 'font-normal text-ink-2 hover:text-ink'
      }`}
    >
      <div className="min-w-0 flex-1 flex items-center justify-between gap-2" data-conversation-content="">
        <span className="relative min-w-0 overflow-visible text-[14px] leading-none">
          {isWorking ? (
            <span className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2">
              <PixelDotsLoader />
            </span>
          ) : null}
          <span className={`block truncate ${isWorking ? 'beautiful-shimmer font-medium' : ''}`} data-i18n-skip="">
            {agent.name}
          </span>
        </span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {onArchive ? (
            <span
              role="button"
              tabIndex={0}
              data-archive-conversation=""
              aria-label={archiveLabel}
              title={archiveLabel}
              className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] text-ink-3 opacity-0 pointer-events-none transition-[opacity,background-color,color] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-hover-2 hover:text-ink focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onArchive();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onArchive();
              }}
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : null}
          {agent.time ? (
            <span className="text-[11px] text-ink-3 tabular-nums leading-none">
              {agent.time}
            </span>
          ) : null}
        </span>
      </div>
      {agent.unread && (
        <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" aria-hidden="true" />
      )}
    </button>
  );
});

AgentItem.displayName = 'AgentItem';
