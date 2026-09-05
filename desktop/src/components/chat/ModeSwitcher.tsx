import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Hammer, ListTodo, LoaderCircle } from 'lucide-react';
import { CollaborationMode } from '../../types';

interface ModeSwitcherProps {
  mode: CollaborationMode;
  onSelectMode: (mode: CollaborationMode) => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
  loading?: boolean;
}

const MODES: Array<{
  id: CollaborationMode;
  label: string;
  description: string;
  icon: typeof ListTodo;
  selectedClass: string;
  idleClass: string;
  color: string;
  shadow: string;
}> = [
  {
    id: 'plan',
    label: 'Plan',
    description: 'Plan and clarify before making changes',
    icon: ListTodo,
    selectedClass: 'bg-[#5b7198] text-white shadow-[0_1px_3px_rgba(70,91,130,0.3)]',
    idleClass: 'text-[#586e90] hover:bg-white/70',
    color: '#5b7198',
    shadow: '0 1px 3px rgba(70,91,130,0.3)',
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Implement changes directly',
    icon: Hammer,
    selectedClass: 'bg-[#567a70] text-white shadow-[0_1px_3px_rgba(61,96,86,0.3)]',
    idleClass: 'text-[#4f7068] hover:bg-white/70',
    color: '#567a70',
    shadow: '0 1px 3px rgba(61,96,86,0.3)',
  },
];

const MODE_CONFIG: Record<CollaborationMode, { color: string; shadow: string }> = {
  plan: {
    color: '#5b7198',
    shadow: '0 1px 3px rgba(70,91,130,0.3)',
  },
  build: {
    color: '#567a70',
    shadow: '0 1px 3px rgba(61,96,86,0.3)',
  },
};

export const ModeSwitcher: React.FC<ModeSwitcherProps> = ({
  mode,
  onSelectMode,
  disabled = false,
  loading = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const hoveredOptionRef = useRef<HTMLElement | null>(null);
  const isInitialMountRef = useRef(true);

  const positionIndicatorOnMode = useCallback((targetMode: CollaborationMode, animate = true) => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    if (!targetMode) {
      indicator.style.opacity = '0';
      return;
    }

    const el = container.querySelector<HTMLElement>(`[data-mode-option="${targetMode}"]`);
    if (el) {
      if (!animate) {
        indicator.style.transition = 'none';
      } else {
        indicator.style.transition = '';
      }
      const config = MODE_CONFIG[targetMode] || MODE_CONFIG.plan;
      indicator.style.transform = `translate3d(${el.offsetLeft}px, ${el.offsetTop}px, 0)`;
      indicator.style.width = `${el.offsetWidth}px`;
      indicator.style.height = `${el.offsetHeight}px`;
      indicator.style.backgroundColor = config.color;
      indicator.style.boxShadow = config.shadow;
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
    const option = (e.target as HTMLElement).closest<HTMLElement>('[data-mode-option]');
    if (!option || !containerRef.current?.contains(option)) {
      return;
    }

    if (hoveredOptionRef.current === option) return;
    hoveredOptionRef.current = option;

    const indicator = indicatorRef.current;
    if (!indicator) return;

    const optMode = option.getAttribute('data-mode-option') as CollaborationMode | null;
    const config = (optMode && MODE_CONFIG[optMode]) || MODE_CONFIG.plan;

    indicator.style.transition = '';
    indicator.style.transform = `translate3d(${option.offsetLeft}px, ${option.offsetTop}px, 0)`;
    indicator.style.width = `${option.offsetWidth}px`;
    indicator.style.height = `${option.offsetHeight}px`;
    indicator.style.backgroundColor = config.color;
    indicator.style.boxShadow = config.shadow;
    indicator.style.opacity = '1';
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredOptionRef.current = null;
    positionIndicatorOnMode(mode, true);
  }, [mode, positionIndicatorOnMode]);

  useLayoutEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      hoveredOptionRef.current = null;
      positionIndicatorOnMode(mode, false);
      return;
    }

    if (hoveredOptionRef.current && containerRef.current?.contains(hoveredOptionRef.current)) {
      const optMode = hoveredOptionRef.current.getAttribute('data-mode-option') as CollaborationMode | null;
      if (optMode) {
        positionIndicatorOnMode(optMode, false);
        return;
      }
    }

    positionIndicatorOnMode(mode, true);
  }, [mode, positionIndicatorOnMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      const activeTargetId = hoveredOptionRef.current
        ? (hoveredOptionRef.current.getAttribute('data-mode-option') as CollaborationMode) || mode
        : mode;
      positionIndicatorOnMode(activeTargetId, false);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [mode, positionIndicatorOnMode]);

  const handleSelect = (optionId: CollaborationMode) => {
    const container = containerRef.current;
    const clickedEl = container?.querySelector<HTMLElement>(`[data-mode-option="${optionId}"]`);
    if (clickedEl) {
      hoveredOptionRef.current = clickedEl;
    }
    if (mode !== optionId) {
      void onSelectMode(optionId);
    }
  };

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto inline-flex relative h-8 items-center gap-0 rounded-xl bg-[#eef2f6] p-0.5 select-none shadow-[0_0_0_1px_rgba(215,222,232,0.9),0_1px_2px_rgba(15,23,42,0.08)]"
      role="radiogroup"
      aria-label="Agent mode"
      aria-busy={loading}
      data-mode-switcher=""
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Floating unified indicator (smooth gliding pill with color transition) */}
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="absolute left-0 top-0 rounded-[12px] shadow-[0_1px_3px_rgba(70,91,130,0.3)] pointer-events-none z-0 will-change-transform transition-[transform,width,height,background-color,box-shadow,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ opacity: 0 }}
      />
      {MODES.map((option) => {
        const selected = mode === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option.label}. ${option.description}`}
            data-mode-option={option.id}
            disabled={disabled || loading}
            onClick={() => handleSelect(option.id)}
            className={`relative z-[1] flex h-7 min-w-[64px] items-center justify-center gap-1.5 rounded-[12px] px-2.5 text-[11.5px] font-semibold before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] active:scale-[0.96] transition-[color,transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-55 ${
              selected
                ? 'text-white'
                : option.id === 'plan'
                ? 'text-[#586e90] hover:text-white'
                : 'text-[#4f7068] hover:text-white'
            }`}
            title={option.description}
          >
            <Icon className="h-3.5 w-3.5 stroke-2" />
            <span>{option.label}</span>
            {loading && selected && <LoaderCircle className="h-3.5 w-3.5 animate-spin stroke-2" />}
          </button>
        );
      })}
    </div>
  );
};

