import React, { useState, useMemo, forwardRef, memo, useRef, useLayoutEffect, useEffect, useCallback, type CSSProperties } from 'react';
import { Search, Plus, Settings, PanelLeftClose, ArrowUp, SquarePen, Folder, X } from 'lucide-react';
import { Agent, ProjectItem } from '../../types';
import { AgentItem } from './AgentItem';
import { useI18n } from '../../i18n';
import { RELEASES_URL, type UpdateCheckState } from '../../hooks/useUpdateCheck';
import { pathsEqual } from '../../hooks/useMetisServer';
import GlideMenu from '../primitives/GlideMenu';

const VISIBLE_CONVERSATIONS = 8;

const SIDEBAR_MOTION = {
  expandedWidth: 224,
  collapsedWidth: 52,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
};

/* ─────────────────────────────────────────────────────────
 * CHAT SEARCH STORYBOARD
 *
 *   0ms   search is triggered; Chats label begins fading
 *   0ms   field grows right → left from the search control
 * 180ms   field fills the row; cursor is focused and ready
 * ───────────────────────────────────────────────────────── */
const CHAT_SEARCH_MOTION = {
  duration: 180,
  closedWidth: 28,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
};

interface SidebarProps {
  agents: Agent[];
  /** Cached sessions keyed by project path — enables multiple expanded folders. */
  agentsByProject?: Record<string, Agent[]>;
  activeAgentId: string;
  projects?: ProjectItem[];
  activeProjectId?: string;
  width: number;
  isLoading?: boolean;
  error?: string;
  updateCheck?: UpdateCheckState;
  onSelectAgent: (agentId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onPrefetchProjectSessions?: (project: ProjectItem) => void;
  onAddProject?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  /** Session currently streaming / compacting — show orbit loader on that row. */
  workingAgentId?: string | null;
}

function filterAgents(agents: Agent[], searchQuery: string): Agent[] {
  const query = searchQuery.toLowerCase();
  if (!query) return agents;
  return agents.filter(
    (a) =>
      a.name.toLowerCase().includes(query) ||
      a.subtitle.toLowerCase().includes(query)
  );
}

export const Sidebar = memo(forwardRef<HTMLElement, SidebarProps>(({
  agents,
  agentsByProject = {},
  activeAgentId,
  projects = [],
  activeProjectId = '',
  width,
  isLoading = false,
  error = '',
  updateCheck,
  onSelectAgent,
  onSelectProject,
  onPrefetchProjectSessions,
  onAddProject,
  onNewChat,
  onOpenSettings,
  onToggleSidebar,
  workingAgentId = null,
}, ref) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const isSearchOpen = searchOpen || searchQuery.length > 0;
  const [optimisticActiveId, setOptimisticActiveId] = useState<string | null>(null);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);
  // Independent multi-expand: clicking one project must not collapse others.
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => (
    new Set(activeProjectId ? [activeProjectId] : [])
  ));
  const [moreByProjectId, setMoreByProjectId] = useState<Record<string, boolean>>({});
  const currentActiveId = optimisticActiveId ?? activeAgentId;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleOpenUpdate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const desktop = (window as any).metisDesktop;
    if (desktop?.openExternal) {
      void desktop.openExternal(RELEASES_URL);
    } else {
      window.open(RELEASES_URL, '_blank');
    }
  }, []);

  useEffect(() => {
    setOptimisticActiveId(null);
  }, [activeAgentId]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  // Keep the active project expanded, without collapsing any already-open folders.
  useEffect(() => {
    if (!activeProjectId) return;
    setExpandedProjectIds((current) => {
      if (current.has(activeProjectId)) return current;
      const next = new Set(current);
      next.add(activeProjectId);
      return next;
    });
  }, [activeProjectId]);

  // Prefetch sessions for every expanded folder so non-active projects still show chats.
  useEffect(() => {
    if (!onPrefetchProjectSessions) return;
    for (const project of projects) {
      if (expandedProjectIds.has(project.id)) {
        onPrefetchProjectSessions(project);
      }
    }
  }, [expandedProjectIds, onPrefetchProjectSessions, projects]);

  const handleProjectRowClick = useCallback((projectId: string) => {
    const wasExpanded = expandedProjectIds.has(projectId);
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (wasExpanded) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
    // Expanding a different project selects it; collapsing never forces a switch.
    if (!wasExpanded && projectId !== activeProjectId) {
      onSelectProject?.(projectId);
    }
  }, [activeProjectId, expandedProjectIds, onSelectProject]);

  const agentsForProject = useCallback((project: ProjectItem) => {
    let cached = agentsByProject[project.path];
    if (!cached) {
      for (const [key, val] of Object.entries(agentsByProject)) {
        if (pathsEqual(key, project.path)) {
          cached = val;
          break;
        }
      }
    }
    if (cached && cached.length > 0) return cached;
    if (project.id === activeProjectId) {
      return agents.filter((agent) => !agent.projectPath || pathsEqual(agent.projectPath, project.path));
    }
    return cached || [];
  }, [activeProjectId, agents, agentsByProject]);


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

  const activeProjectAgents = useMemo(() => {
    const project = projects.find((item) => item.id === activeProjectId);
    if (!project) return filterAgents(agents, searchQuery);
    return filterAgents(agentsForProject(project), searchQuery);
  }, [agents, agentsForProject, activeProjectId, projects, searchQuery]);

  useLayoutEffect(() => {
    const searchChanged = prevSearchQueryRef.current !== searchQuery;
    prevSearchQueryRef.current = searchQuery;

    if (isInitialMountRef.current || searchChanged) {
      isInitialMountRef.current = false;
      hoveredRowRef.current = null;
      positionIndicatorOnAgent(currentActiveId, false);
      return;
    }

    if (hoveredRowRef.current && itemsContainerRef.current?.contains(hoveredRowRef.current)) {
      const rowId = hoveredRowRef.current.getAttribute('data-conversation-row');
      if (rowId) {
        positionIndicatorOnAgent(rowId, false);
        return;
      }
    }

    positionIndicatorOnAgent(currentActiveId, true);
  }, [currentActiveId, activeProjectAgents, searchQuery, positionIndicatorOnAgent]);

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
  }, [currentActiveId, positionIndicatorOnAgent, activeProjectAgents]);

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

  const renderConversationList = (
    projectAgents: Agent[],
    options: { attachIndicator: boolean; showActiveLoading: boolean; projectKey: string; indented?: boolean },
  ) => {
    const filtered = filterAgents(projectAgents, searchQuery);
    const showMore = Boolean(moreByProjectId[options.projectKey]);
    const visible = showMore ? filtered : filtered.slice(0, VISIBLE_CONVERSATIONS);
    const hasMore = filtered.length > VISIBLE_CONVERSATIONS && !showMore;
    const loading = options.showActiveLoading && isLoading && projectAgents.length === 0;
    const rowPad = options.indented ? 'pl-[30px] pr-2' : 'px-2';

    return (
      <>
        {loading && (
          <p className={`${rowPad} py-2 text-[12px] text-ink-3`} role="status">
            Loading conversations…
          </p>
        )}
        {options.showActiveLoading && !isLoading && error && (
          <p className={`${rowPad} py-2 text-[12px] leading-relaxed text-red`} role="alert">
            {error}
          </p>
        )}
        {!loading && !(options.showActiveLoading && error) && filtered.length === 0 && (
          <p className={`${rowPad} py-2 text-[12px] text-ink-3`}>
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}
        <div
          ref={options.attachIndicator ? itemsContainerRef : undefined}
          className="relative flex flex-col gap-px"
          onMouseMove={options.attachIndicator ? handleMouseMove : undefined}
          data-conversation-list=""
        >
          {options.attachIndicator && (
            <div
              ref={indicatorRef}
              aria-hidden="true"
              data-conversation-indicator=""
              className="absolute left-0 right-0 top-0 rounded-[7px] bg-hover-2 pointer-events-none z-0 will-change-transform transition-[transform,height,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
              style={{ opacity: 0 }}
            />
          )}
          {visible.map((agent) => (
            <AgentItem
              key={agent.id}
              agent={agent}
              isActive={agent.id === currentActiveId}
              isWorking={Boolean(workingAgentId) && agent.id === workingAgentId}
              onClick={() => handleSelectAgent(agent.id)}
              indented={options.indented}
            />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => setMoreByProjectId((current) => ({ ...current, [options.projectKey]: true }))}
              data-show-more-conversations=""
              className={`h-8 ${rowPad} rounded-[8px] text-left text-[14px] text-ink-3 hover:text-ink hover:bg-hover transition-colors`}
            >
              {t('sidebarShowMore')}
            </button>
          )}
        </div>
      </>
    );
  };

  return (
    <aside
      ref={ref}
      style={{
        width: `${width}px`,
        '--sidebar-copy-duration': `${SIDEBAR_MOTION.copyDuration}ms`,
        '--sidebar-copy-offset': `${SIDEBAR_MOTION.copyOffset}px`,
        '--sidebar-easing': SIDEBAR_MOTION.easing,
      } as CSSProperties}
      className="h-full min-w-[224px] shrink flex flex-col overflow-hidden select-none relative bg-canvas"
      data-sidebar=""
    >
      <div className="h-[50px] px-3 flex items-center flex-shrink-0 titlebar-drag">
        <div className="flex items-center gap-1.5 no-drag">
          <div className="w-[66px] h-[16px]" />
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 rounded-chip flex items-center justify-center text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title="Toggle Sidebar"
          >
            <PanelLeftClose className="w-4 h-4 stroke-[1.8]" />
          </button>
        </div>
      </div>

      {/* Top actions: quiet New Chat — Beautiful UI rail pattern */}
      <div className="px-2 pb-1 flex-shrink-0 no-drag" data-sidebar-actions="">
        <GlideMenu
          rowSelector="[data-sidebar-action-row]"
          highlightClassName="inset-x-0 rounded-[7px] bg-hover-2"
          className="flex flex-col gap-px"
        >
          <button
            type="button"
            onClick={onNewChat}
            data-sidebar-action-row=""
            className="relative z-10 w-full h-8 px-2 rounded-[8px] flex items-center gap-2 text-[14px] font-medium text-ink transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
            data-new-conversation-action=""
          >
            <SquarePen className="w-3.5 h-3.5 stroke-[1.7] text-ink-2 shrink-0" />
            <span className="truncate flex-1 text-left">{t('newConversation')}</span>
          </button>
        </GlideMenu>
      </div>

      <div
        className="flex-1 overflow-y-auto px-2 pt-2 pb-1 no-drag scrollbar-none"
        onMouseLeave={handleMouseLeave}
        data-sidebar-projects=""
      >
        {/* Projects header with integrated Chat Search Storyboard */}
        <div className="sidebar-copy relative mx-0 mb-1.5 h-8">
          <div
            aria-hidden={isSearchOpen}
            className={`absolute inset-0 flex items-center justify-between px-2 text-[12px] font-medium text-ink-3 transition-[opacity,transform] ${
              isSearchOpen ? 'pointer-events-none -translate-x-1 opacity-0' : 'translate-x-0 opacity-100'
            }`}
            style={{
              transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
              transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
            }}
          >
            <span className="text-[11px] font-medium text-ink-3">
              {t('projects')}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label={t('searchConversations')}
                aria-expanded={isSearchOpen}
                onClick={() => setSearchOpen(true)}
                className="w-6 h-6 rounded-chip flex items-center justify-center text-ink-3 hover:bg-hover-2 hover:text-ink transition-[background-color,color,transform] duration-150 active:scale-[0.96]"
                title={t('searchConversations')}
              >
                <Search className="w-3.5 h-3.5 stroke-[1.8]" />
              </button>
              {onAddProject && (
                <button
                  type="button"
                  onClick={onAddProject}
                  aria-label={t('addProject')}
                  title={t('addProject')}
                  data-add-project-button=""
                  className="w-6 h-6 rounded-chip flex items-center justify-center text-ink-3 hover:bg-hover-2 hover:text-ink transition-[background-color,color,transform] duration-150 active:scale-[0.96]"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.8]" />
                </button>
              )}
            </div>
          </div>

          <div
            className={`absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2 ${
              isSearchOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            }`}
            style={{
              width: isSearchOpen ? '100%' : `${CHAT_SEARCH_MOTION.closedWidth}px`,
              transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
              transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
            }}
          >
            <span className="ml-2 flex shrink-0 items-center justify-center">
              <Search className="w-3.5 h-3.5 stroke-[1.8] text-ink-2" />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleCloseSearch();
                }
              }}
              placeholder={t('searchConversations')}
              aria-label={t('searchConversations')}
              data-sidebar-search=""
              className="ml-1.5 min-w-0 flex-1 bg-transparent text-[14px] font-normal text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              aria-label={t('close')}
              onClick={handleCloseSearch}
              className="w-7 h-7 mr-0.5 shrink-0 flex items-center justify-center rounded-chip text-ink-3 hover:bg-hover-2 hover:text-ink transition-[background-color,color,transform] duration-150 active:scale-[0.96]"
            >
              <X className="w-3.5 h-3.5 stroke-[1.8]" />
            </button>
          </div>
        </div>

        {projects.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-ink-3">{t('noProjects')}</p>
        )}

        <GlideMenu
          rowSelector="[data-project-row]"
          highlightClassName="inset-x-0 rounded-[7px] bg-hover"
          className="flex flex-col gap-2"
        >
          {projects.map((project) => {
            const isActiveProject = project.id === activeProjectId;
            const isExpanded = expandedProjectIds.has(project.id);
            return (
              <div key={project.id} data-project-group={project.id} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={isActiveProject}
                  aria-expanded={isExpanded}
                  onClick={() => handleProjectRowClick(project.id)}
                  className={`relative z-10 w-full h-8 px-2 rounded-[8px] flex items-center gap-2 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
                    isExpanded
                      ? 'text-ink'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                  title={project.path ? `${project.name} (${project.path})` : project.name}
                  data-project-row={project.id}
                  data-project-expanded={isExpanded ? 'true' : 'false'}
                >
                  <Folder className="w-3.5 h-3.5 stroke-[1.7] text-ink-2 shrink-0" />
                  <span className="truncate text-left">{project.name}</span>
                </button>

                {isExpanded && (
                  <div data-project-conversations={project.id}>
                    {renderConversationList(agentsForProject(project), {
                      attachIndicator: isActiveProject,
                      showActiveLoading: isActiveProject,
                      projectKey: project.id,
                      indented: true,
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </GlideMenu>

        {projects.length === 0 && (
          <div className="mt-1" data-project-conversations="">
            {renderConversationList(agents, {
              attachIndicator: true,
              showActiveLoading: true,
              projectKey: '__none__',
            })}
          </div>
        )}
      </div>

      <div className="p-2 flex flex-col gap-1 flex-shrink-0 no-drag border-t border-line" data-sidebar-footer="">
        <div className="flex items-center gap-1.5 w-full">
          <button
            id="sidebarSettingsButton"
            type="button"
            onClick={onOpenSettings}
            className="flex-1 min-w-0 h-8 px-2 rounded-control flex items-center gap-2 text-[12px] font-medium text-ink-2 hover:bg-hover hover:text-ink transition-colors overflow-hidden"
          >
            <Settings className="w-3.5 h-3.5 text-ink-3 shrink-0" />
            <span className="truncate">{t('settings')}</span>
          </button>
          {updateCheck?.status === 'available' && (
            <button
              id="sidebarUpdateButton"
              type="button"
              onClick={handleOpenUpdate}
              title={t('reactSettingsUpdateAvailableDescription', {
                version: updateCheck.latestVersion ? `v${updateCheck.latestVersion}` : '',
              })}
              className="h-8 px-2.5 rounded-control flex items-center gap-1.5 text-[12px] font-medium bg-accent hover:bg-accent-ink text-white transition-colors shrink-0 active:scale-[0.98]"
            >
              <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{t('sidebarUpdate')}</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}));

Sidebar.displayName = 'Sidebar';
