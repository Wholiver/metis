import React, { useState } from 'react';
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
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);

  return (
    <div className="w-full py-1 flex items-center justify-center gap-1 relative no-drag select-none" aria-label="Projects">
      {projects.map((project) => {
        const isActive = project.id === activeProjectId;
        return (
          <div
            key={project.id}
            className="relative flex items-center justify-center"
            onMouseEnter={() => setHoveredProjectId(project.id)}
            onMouseLeave={() => setHoveredProjectId(null)}
          >
            <button
              type="button"
              onClick={() => onSelectProject(project.id)}
              aria-label={`Open project ${project.name}`}
              aria-pressed={isActive}
              className="group h-4 p-0.5 grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 active:scale-[0.96] transition-transform"
              title={project.name}
            >
              <span
                style={project.color ? { backgroundColor: isActive ? '#0f172a' : project.color } : undefined}
                className={`block transition-[width,background-color,transform] duration-200 ease-out ${
                  isActive
                    ? 'w-3.5 h-1.5 rounded-full bg-slate-800 shadow-sm'
                    : 'w-1.5 h-1.5 rounded-full bg-slate-300 group-hover:bg-slate-400 group-hover:scale-110'
                }`}
              />
            </button>

            {/* Hover Floating Tooltip */}
            {hoveredProjectId === project.id && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900/90 backdrop-blur-sm text-white text-[11px] font-medium rounded-lg whitespace-nowrap shadow-lg pointer-events-none z-50 animate-in fade-in zoom-in-95 duration-100 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{project.name}</span>
                {isActive && <span className="text-slate-400 text-[10px]">(current)</span>}
              </div>
            )}
          </div>
        );
      })}

      {/* Refined Plus Button to Add / Open Project */}
      <button
        type="button"
        onClick={onAddProject}
        aria-label="Add project"
        className="w-4 h-4 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-500 hover:text-slate-800 grid place-items-center active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ml-0.5"
        title="Add or open project folder"
      >
        <Plus className="w-2.5 h-2.5 stroke-[2.5]" />
      </button>
    </div>
  );
};

