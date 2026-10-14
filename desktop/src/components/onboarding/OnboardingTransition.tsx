import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowRight, Compass, Layers, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n';
import { MetisCloudMark } from '../chat/MetisCloudMark';
import './OnboardingTransition.css';

export type OnboardingTransitionStage =
  | 'idle'
  | 'flying'
  | 'landed'
  | 'sidebar'
  | 'composer'
  | 'inspector'
  | 'settling'
  | 'done';

export interface OnboardingTransitionProps {
  active: boolean;
  sourceRect: DOMRect | null;
  sidebarWidth?: number;
  inspectorWidth?: number;
  onStageChange?: (stage: OnboardingTransitionStage) => void;
  onNewChat?: () => void;
  onFinish: () => void;
}

export const OnboardingTransition: React.FC<OnboardingTransitionProps> = ({
  active,
  sourceRect,
  sidebarWidth = 260,
  inspectorWidth = 360,
  onStageChange,
  onNewChat,
  onFinish,
}) => {
  const { t } = useI18n();
  const [stage, setStage] = useState<OnboardingTransitionStage>('idle');
  const [cloudTransform, setCloudTransform] = useState<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 });
  const [showRipple, setShowRipple] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [composerRect, setComposerRect] = useState<DOMRect | null>(null);

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onNewChatRef = useRef(onNewChat);
  onNewChatRef.current = onNewChat;
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const startLeft = sourceRect ? sourceRect.left + sourceRect.width / 2 : winW / 2;
  const startTop = sourceRect ? sourceRect.top + sourceRect.height / 2 : winH * 0.28;

  const currentStage = (active && stage === 'idle') ? 'flying' : stage;

  const updateStage = useCallback((next: OnboardingTransitionStage) => {
    setStage(next);
    onStageChangeRef.current?.(next);
  }, []);

  // Measure composer input rect dynamically
  const measureComposer = useCallback(() => {
    const el = document.querySelector('[data-composer-dock-stack]');
    if (el) {
      setComposerRect(el.getBoundingClientRect());
    }
  }, []);

  // Navigation handlers
  const handleNext = useCallback(() => {
    if (stage === 'sidebar') {
      measureComposer();
      updateStage('composer');
    } else if (stage === 'composer') {
      updateStage('inspector');
    } else if (stage === 'inspector') {
      updateStage('settling');
      setTimeout(() => {
        updateStage('done');
        onFinishRef.current();
        setTimeout(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input], textarea');
          textarea?.focus();
        }, 50);
      }, 250);
    }
  }, [stage, measureComposer, updateStage]);

  const handleSkip = useCallback(() => {
    updateStage('settling');
    setTimeout(() => {
      updateStage('done');
      onFinishRef.current();
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input], textarea');
        textarea?.focus();
      }, 50);
    }, 250);
  }, [updateStage]);

  // Keyboard navigation (Esc to skip, Enter or RightArrow to next)
  useEffect(() => {
    if (!active || stage === 'idle' || stage === 'flying' || stage === 'landed' || stage === 'settling' || stage === 'done') {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, stage, handleNext, handleSkip]);

  // Main lifecycle: Flying -> Landed -> Sidebar
  useEffect(() => {
    if (!active) {
      setStage('idle');
      setCloudTransform({ x: 0, y: 0, scale: 1 });
      setShowRipple(false);
      return;
    }

    let isMounted = true;
    updateStage('flying');

    // Calculate exact target coordinate from [data-home-cloud-slot]
    const raf = requestAnimationFrame(() => {
      if (!isMounted) return;
      const targetEl = document.querySelector('[data-home-cloud-slot]');
      let targetLeft = sidebarWidth + (winW - sidebarWidth - inspectorWidth) / 2;
      let targetTop = winH * 0.38;

      if (targetEl) {
        const tr = targetEl.getBoundingClientRect();
        targetLeft = tr.left + tr.width / 2;
        targetTop = tr.top + tr.height / 2;
      }

      const dx = targetLeft - startLeft;
      const dy = targetTop - startTop;
      const scale = 68 / 56;
      setCloudTransform({ x: dx, y: dy, scale });
    });

    // Landing sequence
    const tLanded = setTimeout(() => {
      if (!isMounted) return;
      updateStage('landed');
      setShowRipple(true);

      const tSidebar = setTimeout(() => {
        if (!isMounted) return;
        measureComposer();
        updateStage('sidebar');
      }, 380);

      return () => clearTimeout(tSidebar);
    }, 700);

    return () => {
      isMounted = false;
      cancelAnimationFrame(raf);
      clearTimeout(tLanded);
    };
  }, [active, startLeft, startTop, sidebarWidth, inspectorWidth, winW, winH, updateStage, measureComposer]);

  // Auto-advance timer (2.2s per step, pauses when hovering card)
  useEffect(() => {
    if (!active || isPaused) return;

    let timer: NodeJS.Timeout | null = null;
    const AUTO_ADVANCE_MS = 2200;

    if (stage === 'sidebar') {
      timer = setTimeout(() => {
        measureComposer();
        updateStage('composer');
      }, AUTO_ADVANCE_MS);
    } else if (stage === 'composer') {
      timer = setTimeout(() => {
        updateStage('inspector');
      }, AUTO_ADVANCE_MS);
    } else if (stage === 'inspector') {
      timer = setTimeout(() => {
        updateStage('settling');
        setTimeout(() => {
          updateStage('done');
          onFinishRef.current();
          setTimeout(() => {
            const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input], textarea');
            textarea?.focus();
          }, 50);
        }, 250);
      }, AUTO_ADVANCE_MS);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [active, stage, isPaused, measureComposer, updateStage]);

  if (!active || currentStage === 'idle' || currentStage === 'done') return null;

  // Cloud remains visible throughout all tour stages once it takes flight, anchoring the center.
  const isCloudVisible = currentStage !== 'idle' && currentStage !== 'done';
  const showCurtain = currentStage === 'flying' || currentStage === 'landed';
  const currentStep = currentStage === 'sidebar' ? 1 : currentStage === 'composer' ? 2 : currentStage === 'inspector' ? 3 : 0;
  const isSettling = currentStage === 'settling';

  return (
    <div
      className="onboarding-transition-overlay"
      data-onboarding-transition={currentStage}
      aria-live="polite"
    >
      {/* 1. Backdrop curtain: covers window with pure page background during initial flight & landing */}
      <div
        className="onboarding-transition-curtain"
        style={{
          opacity: showCurtain ? 1 : 0,
          pointerEvents: showCurtain ? 'auto' : 'none',
        }}
      />

      {/* 2. Hero Flying Metis Cloud Mark */}
      <div
        className="onboarding-transition-cloud-wrapper"
        style={{
          top: startTop - 28,
          left: startLeft - 28,
          transform: `translate3d(${cloudTransform.x}px, ${cloudTransform.y}px, 0) scale(${cloudTransform.scale})`,
          opacity: isCloudVisible ? 1 : 0,
          pointerEvents: 'none',
          transition:
            cloudTransform.x !== 0 || cloudTransform.y !== 0
              ? 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms ease'
              : 'opacity 320ms ease',
        }}
        data-transition-cloud=""
      >
        <div className="onboarding-cloud-aura" />
        {showRipple && <div className="onboarding-landing-ripple" />}
        <MetisCloudMark
          size={160}
          className="w-[56px] h-[56px]"
          expression={currentStage === 'flying' ? 'excited' : 'neutral'}
        />
      </div>

      {/* 3. Docked Feature Callouts (Linear / Raycast Style on clean blank canvas) */}
      {currentStage === 'sidebar' && (
        <div
          className={`onboarding-tour-card onboarding-tour-docked-card onboarding-card-pop ${isSettling ? 'opacity-0' : ''}`}
          style={{
            top: 130,
            left: Math.max(sidebarWidth + 20, 280),
          }}
          data-tour-card="sidebar"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-hover text-ink-2">
                <Compass className="h-3.5 w-3.5" />
              </div>
              <h4 className="text-[13px] font-semibold text-ink tracking-tight">
                {t('onboardingTourSidebarTitle') || '侧边栏 · 导航与管理'}
              </h4>
            </div>
            <span className="text-[11px] font-medium text-ink-3 tabular-nums px-1.5 py-0.5 rounded-full bg-field border border-line/60">
              {currentStep} / 3
            </span>
          </div>

          <p className="text-[12px] leading-relaxed text-ink-2 mb-3">
            {t('onboardingTourSidebarDesc') ||
              '快速管理多个代码工程、查看 Git 代码树与变更、编排 Agent 架构并随时切换会话。'}
          </p>

          <div className="flex flex-wrap gap-1.5 mb-3.5">
            {['工作区工程', 'Git 管理', '例行任务', 'Agent 架构'].map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-control bg-field px-2 py-0.5 text-[11px] font-normal text-ink-2 border border-line/50"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-line/60">
            <button
              type="button"
              onClick={handleSkip}
              className="text-[12px] text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              {t('onboardingTourSkip') || '跳过'}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-btn bg-ink text-surface dark:bg-accent dark:text-white px-3 py-1 text-[12px] font-medium shadow-btn hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>{t('onboardingTourNext') || '下一步'}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {currentStage === 'composer' && (
        <div
          className={`onboarding-tour-card onboarding-tour-docked-card onboarding-card-pop ${isSettling ? 'opacity-0' : ''}`}
          style={{
            top: composerRect ? composerRect.bottom + 44 : winH * 0.58,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
          data-tour-card="composer"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-hover text-ink-2">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <h4 className="text-[13px] font-semibold text-ink tracking-tight">
                {t('onboardingTourComposerTitle') || '对话中心 · 智能双脑'}
              </h4>
            </div>
            <span className="text-[11px] font-medium text-ink-3 tabular-nums px-1.5 py-0.5 rounded-full bg-field border border-line/60">
              {currentStep} / 3
            </span>
          </div>

          <p className="text-[12px] leading-relaxed text-ink-2 mb-3">
            {t('onboardingTourComposerDesc') ||
              '自然语言指令输入，支持拖拽文件与截图，随心切换主力模型、思考推理等级与协作模式。'}
          </p>

          <div className="flex flex-wrap gap-1.5 mb-3.5">
            {['多模型调度', '思考推理', '协作模式 (Build/Plan)', '附件与截图'].map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-control bg-field px-2 py-0.5 text-[11px] font-normal text-ink-2 border border-line/50"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-line/60">
            <button
              type="button"
              onClick={handleSkip}
              className="text-[12px] text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              {t('onboardingTourSkip') || '跳过'}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-btn bg-ink text-surface dark:bg-accent dark:text-white px-3 py-1 text-[12px] font-medium shadow-btn hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>{t('onboardingTourNext') || '下一步'}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {currentStage === 'inspector' && (
        <div
          className={`onboarding-tour-card onboarding-tour-docked-card onboarding-card-pop ${isSettling ? 'opacity-0' : ''}`}
          style={{
            top: 130,
            right: Math.max(inspectorWidth + 20, 380),
          }}
          data-tour-card="inspector"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-hover text-ink-2">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <h4 className="text-[13px] font-semibold text-ink tracking-tight">
                {t('onboardingTourInspectorTitle') || '审查面板 · 实时协同'}
              </h4>
            </div>
            <span className="text-[11px] font-medium text-ink-3 tabular-nums px-1.5 py-0.5 rounded-full bg-field border border-line/60">
              {currentStep} / 3
            </span>
          </div>

          <p className="text-[12px] leading-relaxed text-ink-2 mb-3">
            {t('onboardingTourInspectorDesc') ||
              '实时比对代码变更 Diff、追踪任务执行计划 (Plan)、监视子智能体多线程并发，并提供内置安全浏览器预览。'}
          </p>

          <div className="flex flex-wrap gap-1.5 mb-3.5">
            {['实时 Diff 比对', 'Plan 任务清单', 'Subagents 多线程', 'Metis Browser'].map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-control bg-field px-2 py-0.5 text-[11px] font-normal text-ink-2 border border-line/50"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-line/60">
            <button
              type="button"
              onClick={handleSkip}
              className="text-[12px] text-ink-3 hover:text-ink transition-colors cursor-pointer"
            >
              {t('onboardingTourSkip') || '跳过'}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-btn bg-ink text-surface dark:bg-accent dark:text-white px-3 py-1 text-[12px] font-medium shadow-btn hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>{t('onboardingTourFinish') || '开始对话'}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
