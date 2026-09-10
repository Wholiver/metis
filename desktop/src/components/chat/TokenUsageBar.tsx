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
        } left-0 right-0 z-30 flex flex-col gap-0.5 rounded-control bg-surface px-2.5 py-1.5 text-[11px] text-ink shadow-overlay pointer-events-none transition-all duration-100 ease-out select-none ${
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
          <span className="font-semibold text-ink">
            {t('contextUsageTitle') || '上下文使用'}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-ink-3">
            {percentDisplay}
          </span>
        </div>

        <span className="font-mono text-[10.5px] tabular-nums text-ink-2">
          {formatExactNumber(usedTokens)} / {formatExactNumber(contextWindow)} {t('tokensUnit') || 'Tokens'}
        </span>

        {(inputTokens > 0 || cacheTokens > 0 || outputTokens > 0) && (
          <div className="flex items-center gap-1.5 text-[10px] text-ink-3 tabular-nums">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block shrink-0" />
              <span>{t('tokenInput') || '输入'}:</span>
              <span className="font-mono">{formatTokenCount(inputTokens)}</span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green inline-block shrink-0" />
              <span>{t('tokenCache') || '缓存'}:</span>
              <span className="font-mono">{formatTokenCount(cacheTokens)}</span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-orange inline-block shrink-0" />
              <span>{t('tokenOutput') || '输出'}:</span>
              <span className="font-mono">{formatTokenCount(outputTokens)}</span>
            </span>
          </div>
        )}

        {isHighLoad && (
          <div className="mt-0.5 flex items-center gap-1 border-t border-line pt-0.5 text-[10px] text-orange">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 text-orange" />
            <span>{t('tokenUsageHighWarning', { percent: percentDisplay })}</span>
          </div>
        )}
      </div>

      {/* Main Bar Container matching UsageQuotaCard style */}
      <button
        type="button"
        onMouseEnter={handleMouseEnter}
        className={`group flex h-[28px] w-full cursor-default select-none items-center justify-between gap-2 text-xs transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${
          className
            ? `px-3.5 ${className} ${
                isOpen
                  ? 'bg-hover'
                  : isCritical
                  ? 'bg-red-tint text-red'
                  : isHighLoad
                  ? 'bg-orange-tint text-orange'
                  : ''
              }`
            : `rounded-card bg-surface px-2.5 shadow-card ${
                isOpen
                  ? 'bg-hover'
                  : isCritical
                  ? 'bg-red-tint text-red'
                  : isHighLoad
                  ? 'bg-orange-tint text-orange'
                  : 'hover:bg-hover'
              }`
        }`}
        role="region"
        aria-label={t('contextUsageTitle')}
        aria-expanded={isOpen}
      >
        {/* Sleek Segmented Progress Bar */}
        <div className="flex h-[5px] min-w-[60px] flex-1 flex-shrink-0 overflow-hidden rounded-full bg-line">
          {inputPercent > 0 && (
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${inputPercent}%` }}
            />
          )}
          {cachePercent > 0 && (
            <div
              className="h-full bg-green transition-all duration-300"
              style={{ width: `${cachePercent}%` }}
            />
          )}
          {outputPercent > 0 && (
            <div
              className="h-full bg-orange transition-all duration-300"
              style={{ width: `${outputPercent}%` }}
            />
          )}
          {percent === 0 && (
            <div className="h-full w-[2px] bg-line-strong" />
          )}
        </div>

        {/* Compact Readout with exact styling */}
        <div className="flex items-center gap-1 font-mono text-[11px] leading-none flex-shrink-0 tabular-nums">
          {isHighLoad && (
            <AlertTriangle
              className={`w-3 h-3 flex-shrink-0 mr-0.5 ${
                isCritical ? 'text-red' : 'text-orange'
              }`}
            />
          )}
          <span className="font-semibold text-ink">
            {formatTokenCount(usedTokens)}
          </span>
          <span className="text-ink-3">/</span>
          <span className="text-ink-3">
            {formatTokenCount(contextWindow)}
          </span>
        </div>
      </button>
    </div>
  );
};
