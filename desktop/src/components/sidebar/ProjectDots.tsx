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
    <div className="w-full py-1 flex items-center justify-center relative no-drag" aria-label="Projects">
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
              onClick={() => onSelectProject(project.id)}
              aria-label={`Open project ${project.name}`}
              aria-pressed={isActive}
              className="group w-6 h-8 grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 active:scale-[0.96] transition-[transform]"
              title={project.name}
            >
              <span style={{ backgroundColor: project.color }} className={`block transition-[width,background-color,transform,box-shadow] duration-150 ${
                isActive
                  ? 'w-[20px] h-[7px] rounded-full bg-[#0f172a] shadow-sm'
                  : 'w-[7px] h-[7px] rounded-full bg-[#cbd5e1] group-hover:bg-[#94a3b8] group-hover:scale-125'
              }`} />
            </button>

            {/* Hover Floating Tooltip */}
            {hoveredProjectId === project.id && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 bg-[#1e293b] text-white text-[10.5px] font-medium rounded-md whitespace-nowrap shadow-md pointer-events-none z-50 animate-in fade-in zoom-in-95 duration-100 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{project.name}</span>
                {isActive && <span className="text-slate-400 text-[9.5px]">(current)</span>}
              </div>
            )}
          </div>
        );
      })}

      {/* Refined Plus Button to Add / Open Project */}
      <button
        onClick={onAddProject}
        aria-label="Add project"
        className="group w-6 h-8 rounded-full grid place-items-center text-slate-400 hover:text-slate-700 active:scale-[0.96] transition-[color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
        title="Add or open project folder"
      >
        <span className="w-[18px] h-[18px] rounded-full border border-dashed border-slate-300 group-hover:border-slate-600 bg-white/70 group-hover:bg-white flex items-center justify-center shadow-sm transition-[border-color,background-color]">
          <Plus className="w-3 h-3 stroke-[2.2]" />
        </span>
      </button>
    </div>
  );
};
