import React, { useState, useMemo, forwardRef, memo, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { Search, Plus, Settings, PanelLeftClose } from 'lucide-react';
import { Agent, ProjectItem } from '../../types';
import { AgentItem } from './AgentItem';
import { ProjectDots } from './ProjectDots';

interface SidebarProps {
  agents: Agent[];
  activeAgentId: string;
  projects?: ProjectItem[];
  activeProjectId?: string;
  width: number;
  isLoading?: boolean;
  error?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onAddProject?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
}

export const Sidebar = memo(forwardRef<HTMLElement, SidebarProps>(({
  agents,
  activeAgentId,
  projects = [],
  activeProjectId = '',
  width,
  isLoading = false,
  error = '',
  onSelectAgent,
  onSelectProject,
  onAddProject,
  onNewChat,
  onOpenSettings,
  onToggleSidebar,
}, ref) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [optimisticActiveId, setOptimisticActiveId] = useState<string | null>(null);
  const currentActiveId = optimisticActiveId ?? activeAgentId;

  useEffect(() => {
    setOptimisticActiveId(null);
  }, [activeAgentId]);

  const filteredAgents = useMemo(() => agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.subtitle.toLowerCase().includes(searchQuery.toLowerCase())
  ), [agents, searchQuery]);

  const itemsContainerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const hoveredRowRef = useRef<HTMLElement | null>(null);
  const isInitialMountRef = useRef(true);
  const prevProjectIdRef = useRef(activeProjectId);
  const prevSearchQueryRef = useRef(searchQuery);

  const positionIndicatorOnAgent = useCallback((agentId: string, animate = true) => {
    const container = itemsContainerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    if (!agentId) {
      indicator.style.opacity = '0';
      return;
    }

    const el = container.querySelector<HTMLElement>(`[data-conversation-row="${agentId}"]`);
    if (el) {
      if (!animate) {
        indicator.style.transition = 'none';
      } else {
        indicator.style.transition = '';
      }
      indicator.style.transform = `translate3d(0, ${el.offsetTop}px, 0)`;
      indicator.style.height = `${el.offsetHeight}px`;
      indicator.style.opacity = '1';
      if (!animate) {
        void indicator.offsetHeight;
        indicator.style.transition = '';
      }
    } else {
      indicator.style.opacity = '0';
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-conversation-row]');
    // When passing through the 2px gap between rows or list padding:
    // Do NOT jump back to active conversation! Maintain current position.
    if (!row || !itemsContainerRef.current?.contains(row)) {
      return;
    }

    if (hoveredRowRef.current === row) return;
    hoveredRowRef.current = row;

    const indicator = indicatorRef.current;
    if (!indicator) return;

    indicator.style.transition = '';
    indicator.style.transform = `translate3d(0, ${row.offsetTop}px, 0)`;
    indicator.style.height = `${row.offsetHeight}px`;
    indicator.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredRowRef.current = null;
    positionIndicatorOnAgent(currentActiveId, true);
  }, [currentActiveId, positionIndicatorOnAgent]);

  useEffect(() => {
    if (prevProjectIdRef.current !== activeProjectId) {
      prevProjectIdRef.current = activeProjectId;
      isInitialMountRef.current = true;
      hoveredRowRef.current = null;
      positionIndicatorOnAgent(currentActiveId, false);
    }
  }, [activeProjectId, currentActiveId, positionIndicatorOnAgent]);

  useLayoutEffect(() => {
    const searchChanged = prevSearchQueryRef.current !== searchQuery;
    prevSearchQueryRef.current = searchQuery;

    if (isInitialMountRef.current || searchChanged) {
      isInitialMountRef.current = false;
      hoveredRowRef.current = null;
      positionIndicatorOnAgent(currentActiveId, false);
      return;
    }

    // If currently hovering over a valid row in the container, maintain position on that row!
    if (hoveredRowRef.current && itemsContainerRef.current?.contains(hoveredRowRef.current)) {
      const rowId = hoveredRowRef.current.getAttribute('data-conversation-row');
      if (rowId) {
        positionIndicatorOnAgent(rowId, false);
        return;
      }
    }

    positionIndicatorOnAgent(currentActiveId, true);
  }, [currentActiveId, filteredAgents, searchQuery, positionIndicatorOnAgent]);

  useEffect(() => {
    const container = itemsContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      const activeTargetId = hoveredRowRef.current
        ? hoveredRowRef.current.getAttribute('data-conversation-row') || currentActiveId
        : currentActiveId;
      positionIndicatorOnAgent(activeTargetId, false);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [currentActiveId, positionIndicatorOnAgent]);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (agentId === currentActiveId) return;
    const container = itemsContainerRef.current;
    const clickedEl = container?.querySelector<HTMLElement>(`[data-conversation-row="${agentId}"]`);
    if (clickedEl) {
      hoveredRowRef.current = clickedEl;
    }
    setOptimisticActiveId(agentId);
    onSelectAgent(agentId);
  }, [currentActiveId, onSelectAgent]);

  return (
    <aside
      ref={ref}
      style={{ width: `${width}px` }}
      className="h-full min-w-[240px] shrink bg-[#f6f7f9] border-r border-slate-200/80 flex flex-col overflow-hidden select-none relative"
    >
      {/* 50px Top Header: Native traffic lights spacer + Collapse button on left, New chat (+) on right */}
      <div className="h-[50px] px-3.5 flex items-center justify-between flex-shrink-0 titlebar-drag">
        {/* Left container: Traffic lights spacer + Toggle sidebar button */}
        <div className="flex items-center gap-1.5 no-drag">
          <div className="w-[66px] h-[16px]" />
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#8e95a2] hover:bg-black/5 hover:text-[#1e293b] transition-colors"
            title="Toggle Sidebar"
          >
            <PanelLeftClose className="w-4 h-4 stroke-[1.8]" />
          </button>
        </div>

        {/* Right action: New chat (+) */}
        <button
          onClick={onNewChat}
          className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#8e95a2] hover:bg-black/5 hover:text-[#1e293b] transition-colors no-drag"
          title="New Chat"
        >
          <Plus className="w-4 h-4 stroke-[2]" />
        </button>
      </div>

      {/* Search Bar: small rounded-[8px] matching macOS spotlight style */}
      <div className="px-3 pb-2 flex-shrink-0 no-drag">
        <div className="relative flex items-center w-full bg-[#eef0f3] rounded-[8px] h-[34px] px-2.5 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-300/60 focus-within:shadow-sm">
          <Search className="w-4 h-4 text-[#9ca3af] mr-2 flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full bg-transparent text-[13.5px] text-[#1e293b] outline-none placeholder-[#9ca3af]"
          />
        </div>
      </div>

      {/* Session conversation list for the active project */}
      <div
        className="flex-1 overflow-y-auto px-3 no-drag scrollbar-none"
        onMouseLeave={handleMouseLeave}
      >
        {isLoading && agents.length === 0 && (
          <p className="px-3 py-4 text-[12px] text-[#94a3b8]" role="status">
            Loading conversations…
          </p>
        )}
        {!isLoading && error && (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-red-600" role="alert">
            {error}
          </p>
        )}
        {!isLoading && !error && filteredAgents.length === 0 && (
          <p className="px-3 py-4 text-[12px] text-[#94a3b8]">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}
        <div
          ref={itemsContainerRef}
          className="relative flex flex-col gap-0.5"
          onMouseMove={handleMouseMove}
        >
          {/* Floating unified indicator (direct 120Hz GPU-accelerated motion tracking) */}
          <div
            ref={indicatorRef}
            aria-hidden="true"
            className="absolute left-0 right-0 top-0 rounded-[10px] bg-[#e0e3e8] shadow-[0_1px_2px_rgba(0,0,0,0.03)] pointer-events-none z-0 will-change-transform transition-[transform,height,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
            style={{ opacity: 0 }}
          />
          {filteredAgents.map((agent) => (
            <AgentItem
              key={agent.id}
              agent={agent}
              isActive={agent.id === currentActiveId}
              onClick={() => handleSelectAgent(agent.id)}
            />
          ))}
        </div>
      </div>

      {/* Bottom Footer: Project Switcher (. . . +) above Settings */}
      <div className="p-2.5 flex flex-col gap-1 flex-shrink-0 no-drag">
        {onSelectProject && onAddProject && (
          <ProjectDots
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            onAddProject={onAddProject}
          />
        )}

        <button
          id="sidebarSettingsButton"
          onClick={onOpenSettings}
          className="w-full h-9 px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13px] font-medium text-[#4b5563] hover:bg-black/5 hover:text-[#0f172a] transition-colors"
        >
          <Settings className="w-4 h-4 text-[#64748b]" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}));

Sidebar.displayName = 'Sidebar';

