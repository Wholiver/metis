import React from 'react';
import { PanelLeftOpen, PanelRightOpen, Plus, Sparkles } from 'lucide-react';
import { Agent, ContextUsage, MemoryState, TokenBreakdown } from '../../types';
import { TokenUsageBar } from './TokenUsageBar';

interface ChatHeaderProps {
  agent: Agent;
  isSidebarOpen?: boolean;
  isInspectorOpen?: boolean;
  onToggleSidebar?: () => void;
  onToggleInspector?: () => void;
  onNewChat?: () => void;
  memoryState?: MemoryState;
  onOpenMemorySettings?: () => void;
  contextUsage?: ContextUsage;
  tokenBreakdown?: TokenBreakdown;
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
  contextUsage,
  tokenBreakdown,
}) => {
  const isMemoryActive = memoryState?.phase === 'extracting' || memoryState?.phase === 'consolidating';

  return (
    <div className={`h-[50px] ${!isSidebarOpen ? 'px-3.5' : 'pl-6 pr-3.5'} flex items-center justify-between flex-shrink-0 titlebar-drag`}>
      <div className="flex items-center gap-2 min-w-0 no-drag">
        {!isSidebarOpen && (
          <>
            <div className="w-[66px] h-[16px]" />
            <button
              onClick={onToggleSidebar}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#8e95a2] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#1e293b] dark:hover:text-[#f1f5f9] transition-colors"
              title="Open Sidebar"
            >
              <PanelLeftOpen className="w-4 h-4 stroke-[1.8]" />
            </button>
            {onNewChat && (
              <button
                onClick={onNewChat}
                className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#8e95a2] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#1e293b] dark:hover:text-[#f1f5f9] transition-colors"
                title="New Chat"
              >
                <Plus className="w-4 h-4 stroke-[2]" />
              </button>
            )}
          </>
        )}
        <h1 className={`font-semibold text-[15px] text-[#0f172a] dark:text-[#f1f5f9] truncate ${!isSidebarOpen ? 'ml-1.5' : ''}`}>
          {agent.name}
        </h1>
      </div>

      <div className="flex items-center gap-2 no-drag">
        {isMemoryActive && (
          <button
            type="button"
            onClick={onOpenMemorySettings}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/60 shadow-xs hover:bg-emerald-100 dark:hover:bg-emerald-900/50 hover:border-emerald-300 transition-all cursor-pointer active:scale-[0.96]"
            title="Consolidating memory… Click to view progress"
          >
            <Sparkles className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
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
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8e95a2] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#0f172a] dark:hover:text-[#f1f5f9] transition-colors"
            title="Expand Inspector"
          >
            <PanelRightOpen className="w-4 h-4 stroke-[1.8]" />
          </button>
        )}
      </div>
    </div>
  );
};

