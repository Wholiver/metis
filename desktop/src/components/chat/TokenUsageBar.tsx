import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ContextUsage, TokenBreakdown } from '../../types';
import { useI18n } from '../../i18n';

interface TokenUsageBarProps {
  contextUsage?: ContextUsage;
  tokenBreakdown?: TokenBreakdown;
  tooltipPlacement?: 'top' | 'bottom';
  className?: string;
}

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) {
    const val = tokens / 1_000_000;
    return `${val >= 10 ? val.toFixed(0) : val.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const val = tokens / 1_000;
    return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)}K`;
  }
  return String(tokens);
}

export function formatExactNumber(num: number): string {
  return new Intl.NumberFormat().format(num || 0);
}

export const TokenUsageBar: React.FC<TokenUsageBarProps> = ({
  contextUsage,
  tokenBreakdown,
  tooltipPlacement = 'top',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useI18n();

  const handleMouseEnter = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      leaveTimeoutRef.current = null;
    }, 80);
  };

  const handleFocus = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleBlur = (event: React.FocusEvent) => {
    if (containerRef.current?.contains(event.relatedTarget as Node)) {
      return;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsOpen(false);
  };

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const contextWindow = contextUsage?.contextWindow || tokenBreakdown?.contextWindow || 256_000;
  const usedTokens = contextUsage?.tokens ?? tokenBreakdown?.total ?? 0;
  const percentValue = contextUsage?.percent ?? (contextWindow > 0 ? (usedTokens / contextWindow) * 100 : 0);
  const percent = Number.isFinite(percentValue) ? Math.min(Math.max(percentValue, 0), 100) : 0;

  const inputTokens = tokenBreakdown?.input ?? usedTokens;
  const cacheTokens = (tokenBreakdown?.cacheRead ?? 0) + (tokenBreakdown?.cacheWrite ?? 0);
  const outputTokens = tokenBreakdown?.output ?? 0;

  // Calculate segment widths relative to the used portion or context window
  const totalReported = Math.max(inputTokens + cacheTokens + outputTokens, usedTokens, 1);
  const inputPercent = (inputTokens / totalReported) * percent;
  const cachePercent = (cacheTokens / totalReported) * percent;
  const outputPercent = (outputTokens / totalReported) * percent;

  const isHighLoad = percent >= 80;
  const isCritical = percent >= 95;

  const percentDisplay = percent > 0 ? `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%` : '0%';

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col select-none w-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {/* Floating Breakdown Tooltip matching UsageQuotaCard style */}
      <div
        className={`absolute ${
          tooltipPlacement === 'bottom'
            ? 'top-[calc(100%+6px)] origin-top'
            : 'bottom-[calc(100%+6px)] origin-bottom'
        } left-0 right-0 z-30 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-slate-800 dark:text-slate-100 rounded-[8px] px-2.5 py-1.5 border border-slate-200/90 dark:border-slate-700/90 shadow-lg shadow-slate-900/10 dark:shadow-black/30 flex flex-col text-[11px] gap-0.5 pointer-events-none transition-all duration-100 ease-out select-none ${
          isOpen
            ? 'opacity-100 scale-100 translate-y-0 visible'
            : tooltipPlacement === 'bottom'
            ? 'opacity-0 scale-[0.98] -translate-y-0.5 invisible'
            : 'opacity-0 scale-[0.98] translate-y-0.5 invisible'
        }`}
        role="tooltip"
        aria-hidden={!isOpen}
      >
        <div className="flex items-center justify-between w-full">
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {t('contextUsageTitle') || '上下文使用'}
          </span>
          <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px] tabular-nums">
            {percentDisplay}
          </span>
        </div>

        <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums text-[10.5px]">
          {formatExactNumber(usedTokens)} / {formatExactNumber(contextWindow)} {t('tokensUnit') || 'Tokens'}
        </span>

        {(inputTokens > 0 || cacheTokens > 0 || outputTokens > 0) && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block shrink-0" />
              <span>{t('tokenInput') || '输入'}:</span>
              <span className="font-mono">{formatTokenCount(inputTokens)}</span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
              <span>{t('tokenCache') || '缓存'}:</span>
              <span className="font-mono">{formatTokenCount(cacheTokens)}</span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block shrink-0" />
              <span>{t('tokenOutput') || '输出'}:</span>
              <span className="font-mono">{formatTokenCount(outputTokens)}</span>
            </span>
          </div>
        )}

        {isHighLoad && (
          <div className="mt-0.5 pt-0.5 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-500" />
            <span>{t('tokenUsageHighWarning', { percent: percentDisplay })}</span>
          </div>
        )}
      </div>

      {/* Main Bar Container matching UsageQuotaCard style */}
      <button
        type="button"
        onMouseEnter={handleMouseEnter}
        className={`group flex items-center justify-between w-full h-[28px] gap-2 text-xs transition-all duration-150 cursor-default select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
          className
            ? `px-3.5 ${className} ${
                isOpen
                  ? 'bg-slate-50/50 dark:bg-slate-800/80'
                  : isCritical
                  ? 'bg-rose-50/30 text-rose-700'
                  : isHighLoad
                  ? 'bg-amber-50/30 text-amber-700'
                  : ''
              }`
            : `px-2.5 bg-[#ffffff] dark:bg-slate-800/50 border rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${
                isOpen
                  ? 'border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/80'
                  : isCritical
                  ? 'border-rose-300 dark:border-rose-800/60 bg-rose-50/40 text-rose-700'
                  : isHighLoad
                  ? 'border-amber-300 dark:border-amber-800/60 bg-amber-50/40 text-amber-700'
                  : 'border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600'
              }`
        }`}
        role="region"
        aria-label={t('contextUsageTitle')}
        aria-expanded={isOpen}
      >
        {/* Sleek Segmented Progress Bar */}
        <div className="flex-1 min-w-[60px] h-[5px] bg-slate-100 dark:bg-slate-700/50 rounded-full overflow-hidden flex flex-shrink-0">
          {inputPercent > 0 && (
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${inputPercent}%` }}
            />
          )}
          {cachePercent > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${cachePercent}%` }}
            />
          )}
          {outputPercent > 0 && (
            <div
              className="h-full bg-orange-400 transition-all duration-300"
              style={{ width: `${outputPercent}%` }}
            />
          )}
          {percent === 0 && (
            <div className="h-full w-[2px] bg-slate-300 dark:bg-slate-600" />
          )}
        </div>

        {/* Compact Readout with exact styling */}
        <div className="flex items-center gap-1 font-mono text-[11px] leading-none flex-shrink-0 tabular-nums">
          {isHighLoad && (
            <AlertTriangle
              className={`w-3 h-3 flex-shrink-0 mr-0.5 ${
                isCritical ? 'text-rose-500' : 'text-amber-500'
              }`}
            />
          )}
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {formatTokenCount(usedTokens)}
          </span>
          <span className="text-slate-400">/</span>
          <span className="text-slate-400 dark:text-slate-500">
            {formatTokenCount(contextWindow)}
          </span>
        </div>
      </button>
    </div>
  );
};

