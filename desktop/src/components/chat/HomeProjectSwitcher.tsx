import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, GitBranch } from 'lucide-react';
import { ProjectItem } from '../../types';
import { useI18n } from '../../i18n';

type HomeProjectSwitcherProps = {
  projects: ProjectItem[];
  activeProject?: ProjectItem;
  onSelectProject?: (id: string) => void | Promise<void>;
  className?: string;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
};

type GitInfo = {
  isRepo: boolean;
  branch: string | null;
};

function readGitInfo(): Promise<GitInfo> {
  const workspace = (window as any).metisDesktop?.workspace as {
    gitInfo?: () => Promise<GitInfo>;
  } | undefined;
  if (!workspace?.gitInfo) {
    return Promise.resolve({ isRepo: false, branch: null });
  }
  return workspace.gitInfo().catch(() => ({ isRepo: false, branch: null }));
}

export const HomeProjectSwitcher: React.FC<HomeProjectSwitcherProps> = ({
  projects,
  activeProject,
  onSelectProject,
  className = '',
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const [branch, setBranch] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const project = activeProject || projects[0];
  const name = project?.name || t('chatHomeDefaultProject');
  const canSwitch = Boolean(onSelectProject) && projects.length > 0;

  useEffect(() => {
    let cancelled = false;
    void readGitInfo().then((info) => {
      if (cancelled) return;
      setBranch(info.isRepo ? info.branch : null);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.path]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.min(
      window.innerWidth - width - 12,
      Math.max(12, triggerRect.left),
    );
    const below = triggerRect.bottom + 8;
    const menuHeight = menu.offsetHeight || 160;
    const top = below + menuHeight > window.innerHeight - 12
      ? Math.max(12, triggerRect.top - menuHeight - 8)
      : below;
    setMenuPosition({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
  }, [isOpen, projects, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const onReposition = () => updateMenuPosition();
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const selectProject = async (id: string) => {
    setIsOpen(false);
    if (!onSelectProject || id === project?.id) return;
    await onSelectProject(id);
  };

  return (
    <div
      className={`pointer-events-auto flex items-center justify-center gap-1.5 text-[13px] text-ink-2 ${className}`}
      data-home-project-switcher=""
    >
      <button
        ref={triggerRef}
        type="button"
        data-home-project-trigger=""
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={t('switchProject') || 'Switch project'}
        disabled={!canSwitch}
        onClick={() => {
          if (!canSwitch) return;
          setIsOpen((current) => !current);
        }}
        className="inline-flex max-w-[min(280px,70vw)] items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="truncate font-medium text-ink" data-home-project-name="">
          {name}
        </span>
        {canSwitch ? (
          <ChevronDown className="size-3.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
        ) : null}
      </button>

      {branch ? (
        <span
          className="pointer-events-none inline-flex items-center gap-1.5 select-none text-ink-3"
          data-home-project-branch=""
          aria-hidden="true"
        >
          <span className="text-ink-3">/</span>
          <GitBranch className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate max-w-[120px]">{branch}</span>
        </span>
      ) : null}

      {isOpen && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={t('projectList') || 'Project list'}
          data-home-project-menu=""
          className="fixed z-[80] overflow-hidden rounded-[12px] border border-line bg-surface shadow-overlay"
          style={{
            left: menuPosition?.left ?? -9999,
            top: menuPosition?.top ?? -9999,
            width: menuPosition?.width ?? 240,
            opacity: menuPosition ? 1 : 0,
            animation: menuPosition ? 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' : undefined,
          }}
        >
          <div className="max-h-64 overflow-y-auto p-1.5">
            {projects.map((item) => {
              const selected = item.id === project?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-home-project-option={item.id}
                  onClick={() => void selectProject(item.id)}
                  className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
                    selected ? 'bg-hover-2 text-ink' : 'text-ink-2'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  {selected ? <Check className="size-3.5 shrink-0 text-ink-2" strokeWidth={2.2} /> : null}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
