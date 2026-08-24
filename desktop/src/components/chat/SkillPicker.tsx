import React, { useEffect, useRef } from 'react';
import { Command, Sparkles } from 'lucide-react';

export interface SkillCommand {
  name: string;
  description: string;
}

interface SkillPickerProps {
  skills: SkillCommand[];
  query: string;
  activeIndex: number;
  onSelect: (skill: SkillCommand) => void;
}

export function filterSkills(skills: SkillCommand[], query: string): SkillCommand[] {
  const normalized = query.trim().toLowerCase().replace(/^skill:/, '');
  if (!normalized) return skills;
  return skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(normalized));
}

export const SkillPicker: React.FC<SkillPickerProps> = ({ skills, query, activeIndex, onSelect }) => {
  const options = filterSkills(skills, query);
  const activeOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (options.length === 0) {
    return (
      <div className="pointer-events-auto mb-2 w-full max-w-[620px] rounded-[16px] border border-slate-200/90 bg-white px-3 py-2.5 text-[12px] text-slate-500" data-skill-picker="" role="status">
        No matching skills
      </div>
    );
  }

  return (
    <div className="pointer-events-auto mb-2 w-full max-w-[620px] overflow-hidden rounded-[16px] border border-slate-200/90 bg-white p-1.5" data-skill-picker="" role="listbox" aria-label="Skills">
      <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto" data-skill-picker-list="">
        {options.map((skill, index) => {
          const active = index === Math.min(activeIndex, options.length - 1);
          return (
            <button
              key={skill.name}
              ref={active ? activeOptionRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(skill)}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-[background-color,color,transform] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              data-skill-option={skill.name}
            >
              <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
                <Sparkles className="h-3.5 w-3.5 stroke-[1.8]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">/{skill.name}</span>
                <span className="block truncate text-[11px] leading-4 text-slate-500">{skill.description}</span>
              </span>
              <Command className="h-3.5 w-3.5 flex-none text-slate-400" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
