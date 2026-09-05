import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useI18n } from '../../i18n';
import { formatTokenCount, formatExactNumber } from '../chat/TokenUsageBar';

export interface RateLimitWindow {
  percent: number;
  used?: number;
  limit?: number;
  resetsIn?: string;
  resetAt?: string | Date | number;
}

export interface UsageQuotaCardProps {
  isOAuth?: boolean;
  totalCost?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  quota5h?: RateLimitWindow;
  quota7d?: RateLimitWindow;
  dailyTokens?: Record<string, number>;
  dailyCost?: Record<string, number>;
  className?: string;
}

interface HollowRingProps {
  ringKey: string;
  windowLabel: string;
  percent: number;
  resetsIn?: string;
  used?: number;
  limit?: number;
}

const HollowRingProgress: React.FC<HollowRingProps> = ({
  ringKey,
  windowLabel,
  percent,
  resetsIn,
  used,
  limit,
}) => {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clampedPercent = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
  const isCritical = clampedPercent >= 95;

  const size = 38;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clampedPercent / 100);

  const handleMouseEnter = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
    }
    leaveTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      leaveTimeoutRef.current = null;
    }, 80);
  };

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className="relative flex items-center justify-center gap-2.5 flex-1 h-full px-2 cursor-default select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-quota-ring={ringKey}
    >
      {/* Tooltip on hover */}
      <div
        className={`absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-30 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-slate-800 dark:text-slate-100 rounded-[8px] px-2.5 py-1.5 border border-slate-200/90 dark:border-slate-700/90 shadow-lg shadow-slate-900/10 dark:shadow-black/30 whitespace-nowrap flex flex-col text-[11px] gap-0.5 pointer-events-none transition-all duration-100 ease-out ${
          isHovered
            ? 'opacity-100 scale-100 translate-y-0 visible'
            : 'opacity-0 scale-[0.98] translate-y-0.5 invisible'
        }`}
        role="tooltip"
      >
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          {windowLabel}
        </span>
        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
          {clampedPercent === 0
            ? t('unconsumed') || '未消耗'
            : `${clampedPercent.toFixed(0)}% (${t('resetsInHours', { time: resetsIn || '2h 30m' }) || `预计 ${resetsIn || '2h 30m'} 后重置`})`}
        </span>
        {Number.isFinite(used) && Number.isFinite(limit) && (
          <span className="text-[10px] text-slate-400 tabular-nums">
            {formatTokenCount(used!)} / {formatTokenCount(limit!)}
          </span>
        )}
      </div>

      {/* Hollow Circular Ring with SVG */}
      <div className="relative w-[38px] h-[38px] flex items-center justify-center shrink-0">
        <svg width={size} height={size} className="overflow-visible">
          {/* Background Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-100 dark:text-slate-700/60"
          />
          {/* Animated Progress Ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`transition-[stroke-dashoffset] duration-500 ease-out origin-center -rotate-90 ${
              isCritical
                ? 'text-rose-600 dark:text-rose-500'
                : clampedPercent >= 80
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-blue-600 dark:text-blue-400'
            }`}
          />
        </svg>

        {/* Center Percentage Display */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className={`text-[11px] font-bold font-mono tracking-tight tabular-nums ${
              isCritical
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-800 dark:text-slate-100'
            }`}
          >
            {Math.round(clampedPercent)}%
          </span>
        </div>
      </div>

      {/* Label and Subtitle to the right of Ring */}
      <div className="flex flex-col justify-center min-w-0">
        <span className="text-[11.5px] font-medium text-slate-600 dark:text-slate-300 leading-tight truncate">
          {windowLabel}
        </span>
        <span className="text-[10.5px] font-mono text-slate-400 dark:text-slate-500 tabular-nums leading-tight mt-0.5 truncate">
          {clampedPercent === 0 ? (t('unconsumed') || '未消耗') : (resetsIn ? `~${resetsIn}` : `${Math.round(clampedPercent)}%`)}
        </span>
      </div>
    </div>
  );
};

const OAuthUsageCard: React.FC<{
  quota5h?: RateLimitWindow;
  quota7d?: RateLimitWindow;
  className?: string;
}> = ({ quota5h, quota7d, className = '' }) => {
  const { t } = useI18n();
  const default5h: RateLimitWindow = quota5h || { percent: 0, resetsIn: '5h' };
  const default7d: RateLimitWindow = quota7d || { percent: 0, resetsIn: '7d' };

  const baseCardStyle = className
    ? className
    : 'bg-[#ffffff] dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]';

  return (
    <div
      className={`w-full h-[72px] px-3 flex items-center justify-between select-none transition-all ${baseCardStyle}`}
      role="region"
      aria-label={t('quota5h')}
      data-usage-card="oauth"
    >
      <HollowRingProgress
        ringKey="5h"
        windowLabel={t('quota5h') || '5小时限额'}
        percent={default5h.percent}
        resetsIn={default5h.resetsIn}
        used={default5h.used}
        limit={default5h.limit}
      />
      <div className="w-[1px] h-6 bg-slate-200/60 dark:bg-slate-700/50 shrink-0" />
      <HollowRingProgress
        ringKey="7d"
        windowLabel={t('quota7d') || '7天限额'}
        percent={default7d.percent}
        resetsIn={default7d.resetsIn}
        used={default7d.used}
        limit={default7d.limit}
      />
    </div>
  );
};

const ApiKeyUsageCard: React.FC<{
  totalCost?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  dailyTokens?: Record<string, number>;
  dailyCost?: Record<string, number>;
  className?: string;
}> = ({
  totalCost = 0,
  totalTokens = 0,
  inputTokens = 0,
  outputTokens = 0,
  cacheTokens = 0,
  dailyTokens,
  dailyCost,
  className = '',
}) => {
  const { t } = useI18n();
  const [isLeftHovered, setIsLeftHovered] = useState(false);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const leftLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLeftMouseEnter = () => {
    if (leftLeaveTimeoutRef.current) {
      clearTimeout(leftLeaveTimeoutRef.current);
      leftLeaveTimeoutRef.current = null;
    }
    setIsLeftHovered(true);
  };

  const handleLeftMouseLeave = () => {
    if (leftLeaveTimeoutRef.current) {
      clearTimeout(leftLeaveTimeoutRef.current);
    }
    leftLeaveTimeoutRef.current = setTimeout(() => {
      setIsLeftHovered(false);
      leftLeaveTimeoutRef.current = null;
    }, 80);
  };

  useEffect(() => {
    return () => {
      if (leftLeaveTimeoutRef.current) {
        clearTimeout(leftLeaveTimeoutRef.current);
      }
    };
  }, []);

  const totalReportedTokens = Math.max(inputTokens + cacheTokens + outputTokens, totalTokens, 0);
  const hasTokens = totalReportedTokens > 0;
  const inputRatio = hasTokens ? Math.round((inputTokens / totalReportedTokens) * 100) : 0;
  const cacheRatio = hasTokens ? Math.round((cacheTokens / totalReportedTokens) * 100) : 0;
  const outputRatio = hasTokens ? Math.max(0, 100 - inputRatio - cacheRatio) : 0;

  const formattedCost = totalCost >= 100
    ? totalCost.toFixed(1)
    : totalCost >= 0.01
    ? totalCost.toFixed(2)
    : totalCost > 0
    ? totalCost.toFixed(3)
    : '0.00';

  // Compute 7-day trend data
  const trendData = useMemo(() => {
    const result: Array<{ date: string; label: string; tokens: number; cost: number }> = [];
    const now = new Date();
    let hasDaily = false;

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const label = i === 0 ? (t('today') || '今日') : `${month}/${day}`;
      const tokens = dailyTokens?.[dateKey] || 0;
      const cost = dailyCost?.[dateKey] || 0;
      if (tokens > 0) hasDaily = true;
      result.push({ date: dateKey, label, tokens, cost });
    }

    if (!hasDaily && totalTokens > 0) {
      result[result.length - 1].tokens = totalTokens;
      result[result.length - 1].cost = totalCost;
    }

    return result;
  }, [dailyTokens, dailyCost, totalTokens, totalCost, t]);

  const maxTokens = useMemo(() => {
    const max = Math.max(...trendData.map((d) => d.tokens), 0);
    return max > 0 ? max : 0;
  }, [trendData]);

  // Coordinates for sparkline (viewBox: 0 0 160 28)
  const chartPoints = useMemo(() => {
    const width = 160;
    const paddingX = 6;
    const innerWidth = width - paddingX * 2;
    const baselineY = 24;
    const peakY = 5;
    const heightRange = baselineY - peakY;

    return trendData.map((d, index) => {
      const x = paddingX + (index / (trendData.length - 1)) * innerWidth;
      const y = maxTokens > 0 ? baselineY - (d.tokens / maxTokens) * heightRange : baselineY;
      return { ...d, x, y };
    });
  }, [trendData, maxTokens]);

  const { linePath, areaPath } = useMemo(() => {
    if (chartPoints.length < 2) return { linePath: '', areaPath: '' };
    let d = `M ${chartPoints[0].x.toFixed(1)},${chartPoints[0].y.toFixed(1)}`;
    for (let i = 0; i < chartPoints.length - 1; i++) {
      const p0 = chartPoints[Math.max(i - 1, 0)];
      const p1 = chartPoints[i];
      const p2 = chartPoints[i + 1];
      const p3 = chartPoints[Math.min(i + 2, chartPoints.length - 1)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    const lastX = chartPoints[chartPoints.length - 1].x.toFixed(1);
    const firstX = chartPoints[0].x.toFixed(1);
    const area = `${d} L ${lastX},26 L ${firstX},26 Z`;
    return { linePath: d, areaPath: area };
  }, [chartPoints]);

  const baseCardStyle = className
    ? className
    : 'bg-[#ffffff] dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]';

  return (
    <div
      className={`w-full h-[72px] px-3.5 py-1.5 flex items-center justify-between select-none transition-all ${baseCardStyle}`}
      role="region"
      aria-label={t('cumulativeCost')}
      data-usage-card="api_key"
    >
      {/* Left Column: Total Cost */}
      <div
        className="relative flex flex-col justify-between h-full min-w-[85px] max-w-[115px] pr-2 shrink-0 cursor-default select-none py-0.5"
        onMouseEnter={handleLeftMouseEnter}
        onMouseLeave={handleLeftMouseLeave}
        data-usage-side="cost"
      >
        {/* Tooltip on hover */}
        <div
          className={`absolute bottom-[calc(100%+6px)] left-0 z-30 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-slate-800 dark:text-slate-100 rounded-[8px] px-2.5 py-1.5 border border-slate-200/90 dark:border-slate-700/90 shadow-lg shadow-slate-900/10 dark:shadow-black/30 whitespace-nowrap flex flex-col text-[11px] gap-0.5 pointer-events-none transition-all duration-100 ease-out ${
            isLeftHovered
              ? 'opacity-100 scale-100 translate-y-0 visible'
              : 'opacity-0 scale-[0.98] translate-y-0.5 invisible'
          }`}
          role="tooltip"
        >
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {t('cumulativeCost') || '累计花费'}
          </span>
          <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            ${formattedCost} · {formatExactNumber(totalTokens)} {t('tokensUnit') || 'Tokens'}
          </span>
          {(inputRatio > 0 || cacheRatio > 0 || outputRatio > 0) && (
            <span className="text-[10px] text-slate-400 tabular-nums">
              {t('tokenInput') || '输入'}: {inputRatio}% · {t('tokenCache') || '缓存'}: {cacheRatio}% · {t('tokenOutput') || '输出'}: {outputRatio}%
            </span>
          )}
        </div>

        <div className="flex flex-col">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            {t('cumulativeCost') || '累计花费'}
          </span>
          <div className="flex items-baseline gap-0.5 mt-0.5">
            <span className="text-[12px] font-medium text-slate-400 dark:text-slate-500 font-mono mr-0.5">$</span>
            <span className="font-mono text-[16px] font-semibold text-slate-800 dark:text-slate-100 tabular-nums leading-none tracking-tight">
              {formattedCost}
            </span>
          </div>
        </div>
        <span className="text-[10.5px] font-mono text-slate-400 dark:text-slate-500 tabular-nums truncate">
          {formatTokenCount(totalTokens)} {t('tokensUnit') || 'Tokens'}
        </span>
      </div>

      {/* Center Divider Line */}
      <div className="w-[1px] h-6 bg-slate-200/60 dark:bg-slate-700/50 shrink-0 mx-1.5" />

      {/* Right Column: 7-Day Usage Trend Sparkline (折线图) */}
      <div
        className="relative flex-1 flex flex-col justify-between h-full pl-1.5 min-w-0 py-0.5"
        data-usage-side="trend"
      >
        {/* Header with Title and Peak */}
        <div className="flex items-center justify-between w-full text-[11px] font-medium leading-tight mb-0.5">
          <span className="text-slate-500 dark:text-slate-400 truncate">
            {t('usageTrend') || '7天用量走势'}
          </span>
          <span className="text-slate-400 dark:text-slate-500 font-mono text-[10.5px] tabular-nums shrink-0">
            {maxTokens > 0 ? formatTokenCount(maxTokens) : (t('unconsumed') || '未消耗')}
          </span>
        </div>

        {/* Interactive Sparkline SVG */}
        <div className="relative w-full h-[32px] flex items-center">
          {/* Tooltip for Hovered Point */}
          {hoveredPointIndex !== null && chartPoints[hoveredPointIndex] && (
            <div
              className="absolute bottom-[calc(100%+4px)] z-30 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md text-slate-800 dark:text-slate-100 rounded-[8px] px-2.5 py-1.5 border border-slate-200/90 dark:border-slate-700/90 shadow-lg shadow-slate-900/10 dark:shadow-black/30 whitespace-nowrap flex flex-col text-[11px] gap-0.5 pointer-events-none transition-all duration-100 ease-out -translate-x-1/2"
              style={{
                left: `${Math.min(Math.max((chartPoints[hoveredPointIndex].x / 160) * 100, 15), 85)}%`,
              }}
              role="tooltip"
            >
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {chartPoints[hoveredPointIndex].label}
              </span>
              <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {formatExactNumber(chartPoints[hoveredPointIndex].tokens)} {t('tokensUnit') || 'Tokens'}
              </span>
              {chartPoints[hoveredPointIndex].cost > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                  ${chartPoints[hoveredPointIndex].cost.toFixed(3)}
                </span>
              )}
            </div>
          )}

          <svg
            viewBox="0 0 160 28"
            preserveAspectRatio="none"
            className="w-full h-[28px] overflow-visible"
          >
            <defs>
              <linearGradient id="apiKeySparklineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Gradient Area Fill */}
            {areaPath && (
              <path
                d={areaPath}
                fill="url(#apiKeySparklineGrad)"
                className="transition-all duration-300 ease-out"
              />
            )}

            {/* Baseline Track */}
            <line
              x1="4"
              y1="24"
              x2="156"
              y2="24"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="2 2"
              className="text-slate-200/60 dark:text-slate-700/40"
            />

            {/* Smooth Curve Line */}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-blue-600 dark:text-blue-400 transition-all duration-300 ease-out"
              />
            )}

            {/* Interactive Hit Areas & Highlight Points */}
            {chartPoints.map((p, idx) => {
              const isHovered = hoveredPointIndex === idx;
              const isLast = idx === chartPoints.length - 1;
              const isPeak = maxTokens > 0 && p.tokens === maxTokens;
              const showDot = isHovered || (p.tokens > 0 && (isLast || isPeak));

              return (
                <g key={p.date}>
                  {/* Invisible wide hit area for effortless hover */}
                  <rect
                    x={Math.max(0, p.x - 10)}
                    y={0}
                    width={20}
                    height={28}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPointIndex(idx)}
                    onMouseLeave={() => setHoveredPointIndex(null)}
                  />
                  {showDot && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isHovered ? 3.5 : 2}
                      className={`pointer-events-none transition-all duration-150 ${
                        isHovered
                          ? 'fill-white dark:fill-slate-900 stroke-blue-600 dark:stroke-blue-400 stroke-[2]'
                          : 'fill-blue-600 dark:fill-blue-400'
                      }`}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
};

export const UsageQuotaCard: React.FC<UsageQuotaCardProps> = ({
  isOAuth = false,
  totalCost = 0,
  totalTokens = 0,
  inputTokens = 0,
  outputTokens = 0,
  cacheTokens = 0,
  quota5h,
  quota7d,
  dailyTokens,
  dailyCost,
  className = '',
}) => {
  if (isOAuth) {
    return (
      <OAuthUsageCard
        quota5h={quota5h}
        quota7d={quota7d}
        className={className}
      />
    );
  }

  return (
    <ApiKeyUsageCard
      totalCost={totalCost}
      totalTokens={totalTokens}
      inputTokens={inputTokens}
      outputTokens={outputTokens}
      cacheTokens={cacheTokens}
      dailyTokens={dailyTokens}
      dailyCost={dailyCost}
      className={className}
    />
  );
};
