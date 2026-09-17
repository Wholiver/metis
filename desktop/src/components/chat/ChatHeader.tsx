import React from 'react';
import { PanelLeftOpen, PanelRightOpen, Plus, Sparkles } from 'lucide-react';
import { Agent, MemoryState } from '../../types';

export type ChatBreadcrumbSegment = {
  id: string;
  label: string;
  /** -1 = root agent; >=0 = index into subagent stack */
  depth: number;
};

interface ChatHeaderProps {
  agent: Agent;
  isSidebarOpen?: boolean;
  isInspectorOpen?: boolean;
  onToggleSidebar?: () => void;
  onToggleInspector?: () => void;
  onNewChat?: () => void;
  memoryState?: MemoryState;
  onOpenMemorySettings?: () => void;
  breadcrumb?: ChatBreadcrumbSegment[];
  onNavigateBreadcrumb?: (depth: number) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  agent,
  isSidebarOpen = true,
  isInspectorOpen = true,
  onToggleSidebar,
  onToggleInspector,
  onNewChat,
  memoryState,
  onOpenMemorySettings,
  breadcrumb,
  onNavigateBreadcrumb,
}) => {
  const isMemoryActive = memoryState?.phase === 'extracting' || memoryState?.phase === 'consolidating';
  const segments = breadcrumb && breadcrumb.length > 1 ? breadcrumb : null;

  return (
    <div className={`h-[50px] ${!isSidebarOpen ? 'px-3.5' : 'pl-6 pr-3.5'} flex items-center justify-between flex-shrink-0 titlebar-drag`}>
      <div className="flex items-center gap-2 min-w-0 no-drag">
        {!isSidebarOpen && (
          <>
            <div className="w-[66px] h-[16px]" />
            <button
              onClick={onToggleSidebar}
              className="w-7 h-7 rounded-chip flex items-center justify-center text-ink-3 hover:bg-hover hover:text-ink transition-colors"
              title="Open Sidebar"
            >
              <PanelLeftOpen className="w-4 h-4 stroke-[1.8]" />
            </button>
            {onNewChat && (
              <button
                onClick={onNewChat}
                className="w-7 h-7 rounded-chip flex items-center justify-center text-ink-3 hover:bg-hover hover:text-ink transition-colors"
                title="New Chat"
              >
                <Plus className="w-4 h-4 stroke-[2]" />
              </button>
            )}
          </>
        )}
        {segments ? (
          <nav
            className={`flex min-w-0 items-center gap-1.5 ${!isSidebarOpen ? 'ml-1.5' : ''}`}
            data-chat-breadcrumb=""
            aria-label="Conversation path"
          >
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1;
              return (
                <React.Fragment key={segment.id}>
                  {index > 0 && (
                    <span className="flex-shrink-0 text-[14px] text-ink-3" aria-hidden="true">/</span>
                  )}
                  {isLast ? (
                    <h1
                      className="min-w-0 truncate font-medium text-[14px] text-ink capitalize"
                      data-breadcrumb-current=""
                      data-i18n-skip=""
                      title={segment.label}
                    >
                      {segment.label}
                    </h1>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigateBreadcrumb?.(segment.depth)}
                      className="max-w-[28%] truncate font-medium text-[14px] text-ink-3 hover:text-ink transition-colors capitalize"
                      title={segment.label}
                      data-breadcrumb-ancestor=""
                      data-breadcrumb-depth={segment.depth}
                      data-i18n-skip=""
                    >
                      {segment.label}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        ) : (
          <h1 className={`font-medium text-[14px] text-ink truncate ${!isSidebarOpen ? 'ml-1.5' : ''}`} data-i18n-skip="">
            {agent.name}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-2 no-drag">
        {isMemoryActive && (
          <button
            type="button"
            onClick={onOpenMemorySettings}
            className="flex items-center gap-1.5 px-2 py-1 rounded-chip text-[11px] font-medium bg-green-tint text-green border border-green/30 hover:bg-green-tint transition-colors cursor-pointer active:scale-[0.98]"
            title="Consolidating memory… Click to view progress"
          >
            <Sparkles className="w-3.5 h-3.5 animate-spin text-green" />
            <span>
              {memoryState.phase === 'consolidating'
                ? 'Saving memory…'
                : memoryState.extractingTotal
                  ? `Memory: ${memoryState.extractingProcessed ?? 0}/${memoryState.extractingTotal}`
                  : 'Extracting memory…'}
            </span>
          </button>
        )}
        {!isInspectorOpen && (
          <button
            onClick={onToggleInspector}
            data-inspector-expand-button=""
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title="Expand Inspector"
          >
            <PanelRightOpen className="w-4 h-4 stroke-[1.8]" />
          </button>
        )}
      </div>
    </div>
  );
};
