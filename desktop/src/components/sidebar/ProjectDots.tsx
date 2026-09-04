import React from 'react';
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
  return (
    <div
      className="w-full h-9 bg-black/[0.04] rounded-[8px] p-1 flex items-center gap-1 select-none no-drag relative overflow-hidden"
      role="tablist"
      aria-label="Projects"
      data-project-switcher=""
    >
      <div className="flex-1 flex items-center gap-1 min-w-0 h-full">
        {projects.length === 0 ? (
          <span className="px-2 text-[12px] text-slate-400 select-none truncate">No projects</span>
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
                onClick={() => onSelectProject(project.id)}
                className={`h-full flex-1 min-w-0 px-2 flex items-center justify-center rounded-[6px] text-[12px] font-medium transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-slate-400/60 ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)] font-semibold'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.03]'
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
        className="w-7 h-7 shrink-0 rounded-[6px] flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-black/[0.04] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-slate-400/60"
        data-add-project-button=""
      >
        <Plus className="w-3.5 h-3.5 stroke-[2]" />
      </button>
    </div>
  );
};

