import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
    colorClass: 'text-orange',
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Implement changes directly',
    icon: Hammer,
    colorClass: 'text-green',
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
  isSlash?: boolean;
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
  isSlash = false,
}) => {
  const selectSkill = onSelectSkill || onSelect || (() => {});
  const [search, setSearch] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const [engaged, setEngaged] = useState(true);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setSearch(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setActiveIndex(initialActiveIndex);
    setEngaged(true);
  }, [initialActiveIndex]);

  useEffect(() => {
    if (!isSlash) {
      searchInputRef.current?.focus();
    }
  }, [isSlash]);

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

  const normalizedQuery = (isSlash ? initialQuery : search).trim().toLowerCase().replace(/^\//, '');

  const matchingModes = isSlash
    ? []
    : COLLABORATION_MODES.filter(
        (m) => !normalizedQuery || `${m.label} ${m.description}`.toLowerCase().includes(normalizedQuery),
      );

  const showFiles = !isSlash && Boolean(onSelectFiles) && (!normalizedQuery || 'files attach upload'.includes(normalizedQuery));

  const matchingSkills = filterSkills(skills, normalizedQuery);

  type MenuItem =
    | { type: 'mode'; item: ModeOptionItem }
    | { type: 'files' }
    | { type: 'skill'; item: SkillCommand };

  const allItems: MenuItem[] = isSlash
    ? matchingSkills.map((s) => ({ type: 'skill' as const, item: s }))
    : [
        ...matchingModes.map((m) => ({ type: 'mode' as const, item: m })),
        ...(showFiles ? [{ type: 'files' as const }] : []),
        ...matchingSkills.map((s) => ({ type: 'skill' as const, item: s })),
      ];

  useEffect(() => {
    setActiveIndex(0);
    setEngaged(true);
  }, [search, initialQuery]);

  useLayoutEffect(() => {
    const target = rowRefs.current[activeIndex];
    if (target) {
      setRowBox({ top: target.offsetTop, height: target.offsetHeight });
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, allItems.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setEngaged(true);
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
    if (e.key === 'Enter' || e.key === 'Tab') {
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
      onMouseLeave={() => setEngaged(false)}
      className="pointer-events-auto relative w-full max-w-[620px] overflow-hidden rounded-window bg-surface p-1 shadow-overlay border border-line"
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom center' }}
      data-skill-picker=""
      data-plus-menu=""
      role="dialog"
      aria-label="Plus menu"
    >
      {!isSlash && (
        <div className="flex items-center px-2 pt-1 pb-1 mb-0.5">
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills, context, chats..."
            className="w-full bg-transparent px-0.5 text-[12px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Search skills and modes"
          />
        </div>
      )}

      <div ref={listRef} className="relative flex flex-col gap-0.5 max-h-[280px] overflow-y-auto" data-skill-picker-list="">
        {/* Gliding highlight that smoothly moves between rows */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover z-0"
          style={{
            top: rowBox?.top ?? 0,
            height: rowBox?.height ?? 0,
            opacity: rowBox && engaged && allItems.length > 0 ? 1 : 0,
            transition:
              'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
          }}
        />

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
                  ref={(el) => { rowRefs.current[index] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-mode-option={modeOption.id}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                    setEngaged(true);
                  }}
                  onClick={() => {
                    onSelectMode?.(modeOption.id);
                    onClose?.();
                  }}
                  className="group relative z-10 flex h-8.5 w-full items-center gap-2.5 rounded-[6px] px-2 text-left transition-colors focus-visible:outline-none"
                >
                  <Icon className={`h-3.5 w-3.5 flex-none stroke-[2] ${modeOption.colorClass}`} />
                  <span className="flex items-center min-w-0 flex-1 gap-2">
                    <span className="text-[12.5px] font-medium text-ink shrink-0">{modeOption.label}</span>
                    <span className="text-[11px] text-ink-3 font-normal truncate">{modeOption.description}</span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 flex-none text-ink ml-auto" />}
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
              ref={(el) => { rowRefs.current[index] = el; }}
              type="button"
              onMouseEnter={() => {
                setActiveIndex(index);
                setEngaged(true);
              }}
              onClick={() => {
                onSelectFiles?.();
                onClose?.();
              }}
              className="group relative z-10 flex h-8.5 w-full items-center gap-2.5 rounded-[6px] px-2 text-left transition-colors focus-visible:outline-none"
            >
              <Paperclip className="h-3.5 w-3.5 flex-none stroke-[1.8] text-ink-3" />
              <span className="flex items-center min-w-0 flex-1 gap-2">
                <span className="text-[12.5px] font-medium text-ink shrink-0">Files</span>
                <span className="text-[11px] text-ink-3 font-normal truncate">Attach files or images</span>
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
              ref={(el) => { rowRefs.current[index] = el; }}
              type="button"
              role="option"
              aria-selected={active}
              data-skill-option={skill.name}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                setActiveIndex(index);
                setEngaged(true);
              }}
              onClick={() => {
                selectSkill(skill);
                onClose?.();
              }}
              className="group relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left transition-colors focus-visible:outline-none"
            >
              <Sparkles className="h-3.5 w-3.5 flex-none stroke-[1.8] text-ink-3" />
              <span className="shrink-0 text-[12.5px] font-medium text-ink">
                /{skill.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
                {skill.description}
              </span>
              <Command className="h-3 w-3 flex-none text-ink-3 ml-auto opacity-40 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
            </button>
          );
        })}

        {allItems.length === 0 && (
          <div className="flex h-9 items-center justify-center px-2.5 text-[11px] text-ink-3">
            No matching modes or skills
          </div>
        )}
      </div>

      <div className="mt-1 border-t border-line px-2.5 pt-1.5 pb-1 text-[11px] text-ink-3">
        Type / to open commands...
      </div>
    </div>
  );
};

export const SkillPicker = PlusMenu;
