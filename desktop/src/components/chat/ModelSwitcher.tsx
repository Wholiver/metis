import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { ModelOption, ThinkingOption } from '../../types';

interface ModelSwitcherProps {
  models: ModelOption[];
  activeModel?: ModelOption;
  onSelectModel: (model: ModelOption) => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  thinkingLevel?: string;
  thinkingLevels?: string[];
  thinkingOptions?: ThinkingOption[];
  supportsThinking?: boolean;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  thinkingLoading?: boolean;
  className?: string;
}

type MenuPosition = {
  left: number;
  top: number;
  width: number;
};

type ReasoningMenuState = {
  model: ModelOption;
  left: number;
  top: number;
  alignLeft?: boolean;
};

export function modelLabel(model?: ModelOption): string {
  return model?.name?.trim() || model?.id || 'Model';
}

export function thinkingOptionLabel(options: ThinkingOption[], id?: string): string | undefined {
  return options.find((option) => option.id === id)?.label || id;
}

function sameModel(first?: ModelOption, second?: ModelOption): boolean {
  return Boolean(first && second && first.provider === second.provider && first.id === second.id);
}

/**
 * Session snapshots identify the selected model, while the provider catalog owns
 * its display metadata. Prefer that catalog entry so a stale session `name`
 * cannot replace the actual model name in the composer.
 */
export function resolveDisplayModel(activeModel: ModelOption | undefined, models: ModelOption[]): ModelOption | undefined {
  return models.find((model) => sameModel(model, activeModel)) || activeModel;
}

export const ModelSwitcher: React.FC<ModelSwitcherProps> = ({
  models,
  activeModel,
  onSelectModel,
  disabled = false,
  loading = false,
  thinkingLevel,
  thinkingLevels = [],
  thinkingOptions,
  supportsThinking = false,
  onSelectThinkingLevel,
  thinkingLoading = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reasoningMenu, setReasoningMenu] = useState<ReasoningMenuState>();
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modelIndicatorRef = useRef<HTMLDivElement>(null);
  const hoveredModelRef = useRef<HTMLElement | null>(null);
  const reasoningMenuRef = useRef<HTMLDivElement>(null);
  const reasoningIndicatorRef = useRef<HTMLDivElement>(null);
  const hoveredReasoningRef = useRef<HTMLElement | null>(null);
  const reasoningCloseTimerRef = useRef<number | null>(null);
  const reasoningMenuRefState = useRef<ReasoningMenuState>();
  reasoningMenuRefState.current = reasoningMenu;
  const menuId = useId();
  const displayModel = resolveDisplayModel(activeModel, models);
  const currentLabel = modelLabel(displayModel);
  const activeThinkingOptions = thinkingOptions || thinkingLevels.map((id) => ({ id, label: id, value: id }));
  const currentThinkingLabel = thinkingOptionLabel(activeThinkingOptions, thinkingLevel);
  const triggerLabel = supportsThinking && thinkingLevel && thinkingLevel !== 'off'
    ? `${currentLabel} · ${currentThinkingLabel}`
    : currentLabel;
  const unavailable = disabled || loading || models.length === 0;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(292, window.innerWidth - 24);
    const left = Math.min(
      window.innerWidth - width - 12,
      Math.max(12, triggerRect.right - width),
    );
    setMenuPosition({
      left,
      top: Math.max(12, triggerRect.top - menu.offsetHeight - 8),
      width,
    });
  }, []);

  const positionModelIndicator = useCallback((targetModel?: ModelOption, animate = true) => {
    const menu = menuRef.current;
    const indicator = modelIndicatorRef.current;
    if (!menu || !indicator) return;

    if (!targetModel) {
      indicator.style.opacity = '0';
      return;
    }

    const el = menu.querySelector<HTMLElement>(`[data-model-option="${targetModel.provider}/${targetModel.id}"]`);
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

  const handleModelMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const option = (e.target as HTMLElement).closest<HTMLElement>('[data-model-option]');
    if (!option || !menuRef.current?.contains(option)) {
      return;
    }

    if (hoveredModelRef.current === option) return;
    hoveredModelRef.current = option;

    const indicator = modelIndicatorRef.current;
    if (!indicator) return;

    indicator.style.transition = '';
    indicator.style.transform = `translate3d(0, ${option.offsetTop}px, 0)`;
    indicator.style.height = `${option.offsetHeight}px`;
    indicator.style.opacity = '1';
  }, []);

  const positionReasoningIndicator = useCallback((level?: string, animate = true) => {
    const menu = reasoningMenuRef.current;
    const indicator = reasoningIndicatorRef.current;
    if (!menu || !indicator) return;

    if (!level) {
      indicator.style.opacity = '0';
      return;
    }

    const el = menu.querySelector<HTMLElement>(`[data-reasoning-option="${level}"]`);
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

  const handleReasoningMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const option = (e.target as HTMLElement).closest<HTMLElement>('[data-reasoning-option]');
    if (!option || !reasoningMenuRef.current?.contains(option)) {
      return;
    }

    if (hoveredReasoningRef.current === option) return;
    hoveredReasoningRef.current = option;

    const indicator = reasoningIndicatorRef.current;
    if (!indicator) return;

    indicator.style.transition = '';
    indicator.style.transform = `translate3d(0, ${option.offsetTop}px, 0)`;
    indicator.style.height = `${option.offsetHeight}px`;
    indicator.style.opacity = '1';
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(undefined);
      hoveredModelRef.current = null;
      return;
    }
    updateMenuPosition();
    requestAnimationFrame(() => {
      positionModelIndicator(activeModel, false);
    });
  }, [isOpen, activeModel, models.length, activeThinkingOptions.length, updateMenuPosition, positionModelIndicator]);

  useLayoutEffect(() => {
    if (!reasoningMenu) {
      hoveredReasoningRef.current = null;
      return;
    }
    requestAnimationFrame(() => {
      if (sameModel(reasoningMenu.model, activeModel)) {
        positionReasoningIndicator(thinkingLevel, false);
      } else {
        const indicator = reasoningIndicatorRef.current;
        if (indicator) indicator.style.opacity = '0';
      }
    });
  }, [reasoningMenu, thinkingLevel, activeModel, positionReasoningIndicator]);

  useEffect(() => {
    if (!reasoningMenu && isOpen) {
      hoveredReasoningRef.current = null;
      if (!hoveredModelRef.current) {
        positionModelIndicator(activeModel, true);
      }
    }
  }, [reasoningMenu, isOpen, activeModel, positionModelIndicator]);


  useEffect(() => {
    if (!isOpen) return;
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    requestAnimationFrame(() => (selected || menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus());

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target)
        && !menuRef.current?.contains(target)
        && !reasoningMenuRef.current?.contains(target)) setIsOpen(false);
    };
    const handleViewportChange = () => updateMenuPosition();
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (unavailable) setIsOpen(false);
  }, [unavailable]);

  useEffect(() => {
    if (!isOpen) {
      setReasoningMenu(undefined);
      reasoningMenuRefState.current = undefined;
    }
  }, [isOpen]);

  useEffect(() => () => {
    if (reasoningCloseTimerRef.current) window.clearTimeout(reasoningCloseTimerRef.current);
  }, []);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || options.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const optionsForModel = (model: ModelOption): ThinkingOption[] => (
    Array.isArray(model.thinkingOptions)
      ? model.thinkingOptions
      : sameModel(model, activeModel) ? activeThinkingOptions : []
  );

  const keepReasoningMenuOpen = () => {
    if (reasoningCloseTimerRef.current) {
      window.clearTimeout(reasoningCloseTimerRef.current);
      reasoningCloseTimerRef.current = null;
    }
  };

  const scheduleReasoningMenuClose = () => {
    if (reasoningCloseTimerRef.current) window.clearTimeout(reasoningCloseTimerRef.current);
    reasoningCloseTimerRef.current = window.setTimeout(() => {
      reasoningMenuRefState.current = undefined;
      setReasoningMenu(undefined);
    }, 180);
  };

  const handleModelMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && reasoningMenuRef.current?.contains(related)) {
      keepReasoningMenuOpen();
      return;
    }

    scheduleReasoningMenuClose();
    hoveredModelRef.current = null;
    if (reasoningMenuRefState.current) {
      positionModelIndicator(reasoningMenuRefState.current.model, true);
    } else {
      positionModelIndicator(activeModel, true);
    }
  }, [activeModel, positionModelIndicator]);

  const handleReasoningMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && menuRef.current?.contains(related)) {
      keepReasoningMenuOpen();
      return;
    }

    scheduleReasoningMenuClose();
    hoveredReasoningRef.current = null;
    if (reasoningMenuRefState.current && sameModel(reasoningMenuRefState.current.model, activeModel)) {
      positionReasoningIndicator(thinkingLevel, true);
    } else {
      const indicator = reasoningIndicatorRef.current;
      if (indicator) indicator.style.opacity = '0';
    }
  }, [activeModel, thinkingLevel, positionReasoningIndicator]);

  const showReasoningMenu = (model: ModelOption, target: HTMLElement) => {
    keepReasoningMenuOpen();
    const rect = target.getBoundingClientRect();
    const width = 154;
    const estimatedHeight = optionsForModel(model).length * 32 + 10;
    const right = rect.right + 8;
    const isRight = right + width <= window.innerWidth - 12;
    const nextState: ReasoningMenuState = {
      model,
      left: isRight ? right : Math.max(12, rect.left - width - 8),
      top: Math.max(12, Math.min(window.innerHeight - estimatedHeight - 12, rect.top)),
      alignLeft: !isRight,
    };
    reasoningMenuRefState.current = nextState;
    setReasoningMenu(nextState);
  };

  const menu = isOpen ? createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="listbox"
      aria-label="Available models"
      data-model-menu=""
      onKeyDown={handleMenuKeyDown}
      onMouseEnter={keepReasoningMenuOpen}
      onMouseMove={handleModelMouseMove}
      onMouseLeave={handleModelMouseLeave}
      style={menuPosition ? {
        left: menuPosition.left,
        top: menuPosition.top,
        width: menuPosition.width,
      } : { visibility: 'hidden' }}
      className="fixed z-[100] max-h-[300px] overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.14)]"
    >
      {/* Floating unified indicator (smooth sliding cover) */}
      <div
        ref={modelIndicatorRef}
        aria-hidden="true"
        className="absolute left-1.5 right-1.5 top-0 rounded-[10px] bg-slate-100 pointer-events-none z-0 will-change-transform transition-[transform,height,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ opacity: 0 }}
      />
      <p className="relative z-[1] px-2.5 pb-1 pt-0.5 text-[11px] font-medium text-slate-400">Model</p>
      {models.map((model) => {
        const selected = sameModel(model, activeModel);
        const modelThinkingOptions = optionsForModel(model);
        const showReasoning = modelThinkingOptions.length > 1 && Boolean(onSelectThinkingLevel);
        return (
          <React.Fragment key={`${model.provider}/${model.id}`}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              data-model-option={`${model.provider}/${model.id}`}
              data-model-reasoning={showReasoning ? '' : undefined}
              onMouseEnter={(event) => showReasoning ? showReasoningMenu(model, event.currentTarget) : scheduleReasoningMenuClose()}
              onClick={() => {
                if (showReasoning) return;
                setIsOpen(false);
                void onSelectModel(model);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
              className="group relative z-[1] flex min-h-9 w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-[color,transform] focus-visible:bg-slate-100 focus-visible:outline-none"
              title={showReasoning ? undefined : `${model.provider} · ${model.id}`}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{modelLabel(model)}</span>
              {showReasoning && selected && <span className="shrink-0 text-[11px] font-medium text-slate-500">{currentThinkingLabel}</span>}
              {selected ? <Check className="h-3.5 w-3.5 flex-none text-slate-700" /> : showReasoning
                ? <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-500" />
                : <span className="h-3.5 w-3.5 flex-none" />}
            </button>
          </React.Fragment>
        );
      })}
    </div>,
    document.body,
  ) : null;

  const reasoningSubmenu = reasoningMenu ? createPortal(
    <div
      ref={reasoningMenuRef}
      role="menu"
      aria-label={`${modelLabel(reasoningMenu.model)} reasoning effort`}
      data-reasoning-menu=""
      onMouseEnter={keepReasoningMenuOpen}
      onMouseMove={handleReasoningMouseMove}
      onMouseLeave={handleReasoningMouseLeave}
      style={{ left: reasoningMenu.left, top: reasoningMenu.top, width: 154 }}
      className="fixed z-[101] overflow-hidden rounded-[14px] border border-slate-200/90 bg-white p-1 shadow-[0_10px_28px_rgba(15,23,42,0.14)]"
    >
      {/* Floating unified indicator (smooth sliding cover) */}
      <div
        ref={reasoningIndicatorRef}
        aria-hidden="true"
        className="absolute left-1 right-1 top-0 rounded-[9px] bg-slate-100 pointer-events-none z-0 will-change-transform transition-[transform,height,opacity] duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ opacity: 0 }}
      />
      {optionsForModel(reasoningMenu.model).map((option) => {
        const selectedLevel = option.id === thinkingLevel && sameModel(reasoningMenu.model, activeModel);
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={selectedLevel}
            data-reasoning-option={option.id}
            disabled={thinkingLoading || disabled}
            onClick={async () => {
              if (!sameModel(reasoningMenu.model, activeModel)) await onSelectModel(reasoningMenu.model);
              await onSelectThinkingLevel?.(option.id);
              setIsOpen(false);
              setReasoningMenu(undefined);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }}
            className="group relative z-[1] flex min-h-8 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[12px] font-medium text-slate-700 transition-[color,transform] focus-visible:bg-slate-100 focus-visible:outline-none disabled:opacity-45"
          >
            <span className="flex-1">{option.label}</span>
            <Check className={`h-3.5 w-3.5 ${selectedLevel ? 'opacity-100' : 'opacity-0'}`} />
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`min-w-0 ${className}`} data-model-switcher="">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Model: ${triggerLabel}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        disabled={unavailable}
        title={displayModel ? `${triggerLabel} · ${displayModel.provider}` : 'Choose model'}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        className="flex h-[30px] min-w-0 max-w-[220px] items-center gap-1 rounded-full px-2 text-[12px] font-medium text-slate-500 hover:bg-black/[0.045] hover:text-slate-800 active:scale-[0.98] transition-[color,background-color,transform,opacity] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
      >
        <span className="truncate" data-model-trigger-label="">{triggerLabel}</span>
        {loading ? (
          <LoaderCircle className="h-3.5 w-3.5 flex-none animate-spin" />
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 flex-none transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>
      {menu}
      {reasoningSubmenu}
    </div>
  );
};

