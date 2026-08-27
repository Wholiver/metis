import React, { useEffect, useRef, useState } from 'react';
import { Check, Command, Hammer, ListTree, Paperclip, Sparkles, Wand2 } from 'lucide-react';
import { CollaborationMode } from '../../types';

export interface SkillCommand {
  name: string;
  description: string;
  kind?: 'mode' | 'skill' | 'command';
}

export interface ModeOptionItem {
  id: CollaborationMode;
  label: string;
  description: string;
  icon: typeof ListTree;
  colorClass: string;
}

export const COLLABORATION_MODES: ModeOptionItem[] = [
  {
    id: 'plan',
    label: 'Plan',
    description: 'Generate an implementation plan',
    icon: ListTree,
    colorClass: 'text-[#b8782a]',
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Implement changes directly',
    icon: Hammer,
    colorClass: 'text-[#3e7a68]',
  },
];

export function filterSkills(skills: SkillCommand[], query: string): SkillCommand[] {
  const normalized = query.trim().toLowerCase().replace(/^skill:/, '');
  if (!normalized) return skills;
  return skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(normalized));
}

export interface PlusMenuProps {
  skills: SkillCommand[];
  query?: string;
  collaborationMode?: CollaborationMode;
  onSelectMode?: (mode: CollaborationMode) => void;
  onSelectSkill: (skill: SkillCommand) => void;
  onSelectFiles?: () => void;
  onClose?: () => void;
  activeIndex?: number;
  onSelect?: (skill: SkillCommand) => void;
  isChangingMode?: boolean;
}

export const PlusMenu: React.FC<PlusMenuProps> = ({
  skills = [],
  query: initialQuery = '',
  collaborationMode = 'build',
  onSelectMode,
  onSelectSkill,
  onSelectFiles,
  onClose,
  activeIndex: initialActiveIndex = 0,
  onSelect,
  isChangingMode = false,
}) => {
  const selectSkill = onSelectSkill || onSelect || (() => {});
  const [search, setSearch] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSearch(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        const composer = menuRef.current.closest('[data-composer-shell]');
        const plusButton = composer?.querySelector('[aria-label*="attachment"], [aria-label*="Add"], [aria-label*="plus"], [data-plus-button]');
        if (plusButton && plusButton.contains(event.target as Node)) return;
        onClose?.();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  const normalizedQuery = search.trim().toLowerCase().replace(/^\//, '');

  const matchingModes = COLLABORATION_MODES.filter(
    (m) => !normalizedQuery || `${m.label} ${m.description}`.toLowerCase().includes(normalizedQuery),
  );

  const showFiles = Boolean(onSelectFiles) && (!normalizedQuery || 'files attach upload'.includes(normalizedQuery));

  const matchingSkills = filterSkills(skills, normalizedQuery);

  type MenuItem =
    | { type: 'mode'; item: ModeOptionItem }
    | { type: 'files' }
    | { type: 'skill'; item: SkillCommand };

  const allItems: MenuItem[] = [
    ...matchingModes.map((m) => ({ type: 'mode' as const, item: m })),
    ...(showFiles ? [{ type: 'files' as const }] : []),
    ...matchingSkills.map((s) => ({ type: 'skill' as const, item: s })),
  ];

  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (allItems.length > 0) {
        setActiveIndex((current) => (current + (e.key === 'ArrowDown' ? 1 : -1) + allItems.length) % allItems.length);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const current = allItems[activeIndex];
      if (current) {
        if (current.type === 'mode') {
          onSelectMode?.(current.item.id);
          onClose?.();
        } else if (current.type === 'files') {
          onSelectFiles?.();
          onClose?.();
        } else if (current.type === 'skill') {
          selectSkill(current.item);
          onClose?.();
        }
      }
    }
  };

  let itemCounter = 0;

  return (
    <div
      ref={menuRef}
      onKeyDown={handleKeyDown}
      className="pointer-events-auto w-full max-w-[620px] overflow-hidden rounded-[12px] border border-slate-200/90 bg-white p-1 shadow-none"
      data-skill-picker=""
      data-plus-menu=""
      role="dialog"
      aria-label="Plus menu"
    >
      <div className="flex items-center px-2 pt-1 pb-1 mb-0.5">
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills, context, chats..."
          className="w-full bg-transparent text-[12px] text-slate-800 placeholder-slate-400 outline-none px-0.5"
          aria-label="Search skills and modes"
        />
      </div>

      <div className="flex flex-col gap-0.5 max-h-[280px] overflow-y-auto" data-skill-picker-list="">
        {matchingModes.length > 0 && (
          <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Agent mode" data-mode-switcher="">
            {matchingModes.map((modeOption) => {
              const selected = collaborationMode === modeOption.id;
              const index = itemCounter++;
              const active = index === activeIndex;
              const Icon = modeOption.icon;
              return (
                <button
                  key={modeOption.id}
                  ref={active ? activeItemRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-mode-option={modeOption.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    onSelectMode?.(modeOption.id);
                    onClose?.();
                  }}
                  className={`group flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-[background-color,color] focus-visible:outline-none ${
                    active ? 'bg-[#f4f4f5] text-slate-900' : 'text-slate-700 hover:bg-[#f4f4f5]/70'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 flex-none stroke-[2] ${modeOption.colorClass}`} />
                  <span className="flex items-center min-w-0 flex-1 gap-2">
                    <span className="text-[12px] font-medium text-slate-800 shrink-0">{modeOption.label}</span>
                    <span className="text-[11px] text-slate-400 font-normal truncate">{modeOption.description}</span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 flex-none text-slate-700 ml-auto" />}
                </button>
              );
            })}
          </div>
        )}

        {showFiles && (() => {
          const index = itemCounter++;
          const active = index === activeIndex;
          return (
            <button
              key="files"
              ref={active ? activeItemRef : undefined}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onSelectFiles?.();
                onClose?.();
              }}
              className={`group flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-[background-color,color] focus-visible:outline-none ${
                active ? 'bg-[#f4f4f5] text-slate-900' : 'text-slate-700 hover:bg-[#f4f4f5]/70'
              }`}
            >
              <Paperclip className="h-3.5 w-3.5 flex-none stroke-[1.8] text-slate-400" />
              <span className="flex items-center min-w-0 flex-1 gap-2">
                <span className="text-[12px] font-medium text-slate-800 shrink-0">Files</span>
                <span className="text-[11px] text-slate-400 font-normal truncate">Attach files or images</span>
              </span>
            </button>
          );
        })()}

        {matchingSkills.map((skill) => {
          const index = itemCounter++;
          const active = index === activeIndex;
          return (
            <button
              key={skill.name}
              ref={active ? activeItemRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              data-skill-option={skill.name}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                selectSkill(skill);
                onClose?.();
              }}
              className={`group flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-[background-color,color] focus-visible:outline-none ${
                active ? 'bg-[#f4f4f5] text-slate-900' : 'text-slate-700 hover:bg-[#f4f4f5]/70'
              }`}
            >
              <Wand2 className="h-3.5 w-3.5 flex-none stroke-[1.8] text-[#7c6bb2]" />
              <span className="flex items-center min-w-0 flex-1 gap-2">
                <span className="text-[12px] font-medium text-slate-800 shrink-0">/{skill.name}</span>
                <span className="text-[11px] text-slate-400 font-normal truncate">{skill.description}</span>
              </span>
              <Command className="h-3 w-3 flex-none text-slate-400 ml-auto" aria-hidden="true" />
            </button>
          );
        })}

        {allItems.length === 0 && (
          <div className="px-2.5 py-2.5 text-[11px] text-slate-400 text-center">
            No matching modes or skills
          </div>
        )}
      </div>
    </div>
  );
};

export const SkillPicker = PlusMenu;

