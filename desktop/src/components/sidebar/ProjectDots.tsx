import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { ProjectItem } from '../../types';

interface ProjectDotsProps {
  projects: ProjectItem[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
}

export const ProjectDots: React.FC<ProjectDotsProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
}) => {
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const hoveredTabRef = useRef<HTMLElement | null>(null);
  const isInitialMountRef = useRef(true);

  const positionIndicatorOnProject = useCallback((projectId: string, animate = true) => {
    const container = tabsContainerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    if (!projectId) {
      indicator.style.opacity = '0';
      return;
    }

    const el = container.querySelector<HTMLElement>(`[data-project-tab="${projectId}"]`);
    if (el) {
      if (!animate) {
        indicator.style.transition = 'none';
      } else {
        indicator.style.transition = '';
      }
      indicator.style.transform = `translate3d(${el.offsetLeft}px, 0, 0)`;
      indicator.style.width = `${el.offsetWidth}px`;
      indicator.style.height = `${el.offsetHeight}px`;
      indicator.style.opacity = '1';
      if (!animate) {
        void indicator.offsetWidth;
        indicator.style.transition = '';
      }
    } else {
      indicator.style.opacity = '0';
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-project-tab]');
    if (!tab || !tabsContainerRef.current?.contains(tab)) {
      return;
    }

    if (hoveredTabRef.current === tab) return;
    hoveredTabRef.current = tab;

    const indicator = indicatorRef.current;
    if (!indicator) return;

    indicator.style.transition = '';
    indicator.style.transform = `translate3d(${tab.offsetLeft}px, 0, 0)`;
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.height = `${tab.offsetHeight}px`;
    indicator.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredTabRef.current = null;
    positionIndicatorOnProject(activeProjectId, true);
  }, [activeProjectId, positionIndicatorOnProject]);

  useLayoutEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      hoveredTabRef.current = null;
      positionIndicatorOnProject(activeProjectId, false);
      return;
    }

    if (hoveredTabRef.current && tabsContainerRef.current?.contains(hoveredTabRef.current)) {
      const projId = hoveredTabRef.current.getAttribute('data-project-tab');
      if (projId) {
        positionIndicatorOnProject(projId, false);
        return;
      }
    }

    positionIndicatorOnProject(activeProjectId, true);
  }, [activeProjectId, projects, positionIndicatorOnProject]);

  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      const targetId = hoveredTabRef.current
        ? hoveredTabRef.current.getAttribute('data-project-tab') || activeProjectId
        : activeProjectId;
      positionIndicatorOnProject(targetId, false);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [activeProjectId, positionIndicatorOnProject]);

  const handleSelectTab = (projectId: string) => {
    const container = tabsContainerRef.current;
    const clickedEl = container?.querySelector<HTMLElement>(`[data-project-tab="${projectId}"]`);
    if (clickedEl) {
      hoveredTabRef.current = clickedEl;
    }
    onSelectProject(projectId);
  };

  return (
    <div
      className="w-full h-8 bg-hover-2 rounded-control p-0.5 flex items-center gap-0.5 select-none no-drag relative overflow-hidden"
      role="tablist"
      aria-label="Projects"
      data-project-switcher=""
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={tabsContainerRef}
        className="flex-1 flex items-center gap-1 min-w-0 h-full relative"
        onMouseMove={handleMouseMove}
      >
        {/* Floating unified indicator (horizontal sliding white card) */}
        {projects.length > 0 && (
          <div
            ref={indicatorRef}
            aria-hidden="true"
            className="absolute left-0 top-0 rounded-chip bg-surface text-ink shadow-btn font-medium pointer-events-none z-0 will-change-transform transition-[transform,width,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
            style={{ opacity: 0 }}
          />
        )}

        {projects.length === 0 ? (
          <span className="px-2 text-[12px] text-ink-3 select-none truncate">No projects</span>
        ) : (
          projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <button
                key={project.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Open project ${project.name}`}
                onClick={() => handleSelectTab(project.id)}
                className={`h-full flex-1 min-w-0 px-2 flex items-center justify-center rounded-chip text-[12px] font-medium transition-[color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-[color:var(--focus)] z-[1] relative ${
                  isActive
                    ? 'text-ink font-semibold'
                    : 'text-ink-3 hover:text-ink'
                }`}
                title={project.path ? `${project.name} (${project.path})` : project.name}
                data-project-tab={project.id}
              >
                <span className="truncate leading-none text-center">{project.name}</span>
              </button>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={onAddProject}
        aria-label="Add project"
        title="Add or open project folder"
        className="w-7 h-7 shrink-0 rounded-chip flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover active:scale-95 transition-[background-color,color,transform] focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-[color:var(--focus)] z-[1] relative"
        data-add-project-button=""
      >
        <Plus className="w-3.5 h-3.5 stroke-[2]" />
      </button>
    </div>
  );
};
