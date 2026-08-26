import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ContextUsage, TokenBreakdown } from '../../types';

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
  const [isHovered, setIsHovered] = useState(false);

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

  return (
    <div
      className="relative flex items-center select-none w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`group flex items-center gap-2.5 px-2 py-1 rounded-[6px] text-xs transition-all duration-150 cursor-pointer w-full ${
          isCritical
            ? 'bg-rose-50/80 text-rose-700 hover:bg-rose-100/80'
            : isHighLoad
            ? 'bg-amber-50/80 text-amber-700 hover:bg-amber-100/80'
            : 'hover:bg-black/5 text-slate-600'
        }`}
        role="region"
        aria-label="Context"
      >
        {isHighLoad && (
          <AlertTriangle
            className={`w-3.5 h-3.5 flex-shrink-0 animate-pulse ${
              isCritical ? 'text-rose-500' : 'text-amber-500'
            }`}
          />
        )}

        {/* Progress Bar with segmented multi-colors stretching full width */}
        <div className="flex-1 min-w-[60px] h-[14px] bg-slate-100 dark:bg-slate-700/50 rounded-[3px] overflow-hidden flex flex-shrink-0">
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
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {formatTokenCount(usedTokens)}
          </span>
          <span className="text-slate-400">/</span>
          <span className="text-slate-500">
            {formatTokenCount(contextWindow)}
          </span>
        </div>
      </div>

      {/* Lightweight Hover Tooltip */}
      {isHovered && (
        <div
          className={`absolute ${
            tooltipPlacement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } left-0 z-50 pointer-events-none whitespace-nowrap`}
          role="tooltip"
        >
          <div className="bg-slate-900/95 text-white text-[11px] rounded-lg px-3 py-2 shadow-xl border border-slate-800 backdrop-blur-xs flex flex-col gap-1.5 min-w-[190px]">
            {/* Header info */}
            <div className="flex items-center justify-between font-mono font-medium pb-1 border-b border-slate-800">
              <span className="text-slate-300">Context</span>
              <span className={isCritical ? 'text-rose-400 font-bold' : isHighLoad ? 'text-amber-400 font-bold' : 'text-slate-200'}>
                {formatExactNumber(usedTokens)} / {formatExactNumber(contextWindow)} ({percentDisplay})
              </span>
            </div>

            {/* Segment Breakdown */}
            <div className="flex flex-col gap-1 font-mono text-[10.5px]">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                  Input
                </span>
                <span className="text-slate-200">{formatExactNumber(inputTokens)}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  Cache
                </span>
                <span className="text-slate-200">{formatExactNumber(cacheTokens)}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
                  Output
                </span>
                <span className="text-slate-200">{formatExactNumber(outputTokens)}</span>
              </div>
            </div>

            {isHighLoad && (
              <div className="pt-1 border-t border-slate-800/80 text-[10px] text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>{`Context window usage high (${percentDisplay})`}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
