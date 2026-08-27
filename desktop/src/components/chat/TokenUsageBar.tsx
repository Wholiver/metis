import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ContextUsage, TokenBreakdown } from '../../types';
import { useI18n } from '../../i18n';

interface TokenUsageBarProps {
  contextUsage?: ContextUsage;
  tokenBreakdown?: TokenBreakdown;
  tooltipPlacement?: 'top' | 'bottom';
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

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

  const contextWindow = contextUsage?.contextWindow || tokenBreakdown?.contextWindow || 128_000;
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

  const items = [
    { label: t('tokenInput'), count: inputTokens, color: 'bg-blue-500' },
    { label: t('tokenCache'), count: cacheTokens, color: 'bg-emerald-500' },
    { label: t('tokenOutput'), count: outputTokens, color: 'bg-orange-500' },
  ];

  return (
    <div
      ref={containerRef}
      className="flex flex-col select-none w-full gap-1.5"
    >
      {/* Integrated Breakdown Panel in the same visual layer without shadow */}
      {isOpen && (
        <div
          className="w-full bg-slate-50 dark:bg-slate-800/40 text-slate-800 dark:text-slate-100 rounded-[8px] p-2.5 border border-slate-200/80 dark:border-slate-700/80 flex flex-col shadow-none select-none"
          role="region"
          aria-label="Context"
        >
          {/* Header: Title, % Full, Token count, and Close Button */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                {t('contextUsageTitle') || 'Context Usage'}
              </span>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                ({percentDisplay})
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {formatTokenCount(usedTokens)} / {formatTokenCount(contextWindow)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="w-4 h-4 rounded-[3px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-3 h-3 stroke-[1.8]" />
              </button>
            </div>
          </div>

          {/* Segmented Progress Bar */}
          <div className="w-full h-1.5 bg-slate-200/70 dark:bg-slate-700/60 rounded-full overflow-hidden flex my-1.5">
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
                className="h-full bg-orange-500 transition-all duration-300"
                style={{ width: `${outputPercent}%` }}
              />
            )}
          </div>

          {/* List Breakdown Rows */}
          <div className="flex flex-col">
            {items.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between py-0.5 px-0.5 rounded-[4px] hover:bg-slate-200/40 dark:hover:bg-slate-700/30 transition-colors text-[11px] leading-4"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-[2px] ${item.color} shrink-0`} />
                  <span className="font-normal text-slate-600 dark:text-slate-300">
                    {item.label}
                  </span>
                </div>
                <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                  {formatTokenCount(item.count)}
                </span>
              </div>
            ))}
          </div>

          {isHighLoad && (
            <div className="mt-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-500" />
              <span>{t('tokenUsageHighWarning', { percent: percentDisplay })}</span>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-[8px] text-xs transition-all duration-150 cursor-pointer w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
          isOpen
            ? 'bg-slate-100 dark:bg-slate-700/60 ring-1 ring-slate-300/80 dark:ring-slate-600'
            : isCritical
            ? 'bg-rose-50/80 text-rose-700 hover:bg-rose-100/80'
            : isHighLoad
            ? 'bg-amber-50/80 text-amber-700 hover:bg-amber-100/80'
            : 'hover:bg-black/5 text-slate-600'
        }`}
        role="region"
        aria-label="Context"
        aria-expanded={isOpen}
      >
        {isHighLoad && (
          <AlertTriangle
            className={`w-3.5 h-3.5 flex-shrink-0 animate-pulse ${
              isCritical ? 'text-rose-500' : 'text-amber-500'
            }`}
          />
        )}

        {/* Progress Bar with segmented multi-colors stretching full width */}
        <div className="flex-1 min-w-[60px] h-[14px] bg-slate-100 dark:bg-slate-700/50 rounded-[4px] overflow-hidden flex flex-shrink-0">
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
            <div className="h-full w-[2px] bg-slate-300" />
          )}
        </div>

        {/* Compact Readout without percentage */}
        <div className="flex items-center gap-1 font-mono text-[12px] leading-none flex-shrink-0">
          <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">
            {formatTokenCount(usedTokens)}
          </span>
          <span className="text-slate-400">/</span>
          <span className="text-slate-500 tabular-nums">
            {formatTokenCount(contextWindow)}
          </span>
        </div>
      </button>
    </div>
  );
};
