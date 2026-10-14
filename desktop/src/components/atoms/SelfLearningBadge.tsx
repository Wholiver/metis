'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

export interface SelfLearningBadgeProps {
  /** Optional custom text label for the badge. Defaults to localized 'Beta' / '测试' */
  label?: string;
  /** Optional custom tooltip text. Defaults to localized '测试功能，可能存在不稳定性' */
  tooltip?: string;
  /** Visual variant tone */
  variant?: 'accent' | 'neutral' | 'subtle';
  /** Additional classes on the badge pill container */
  className?: string;
  /** Additional classes on the tooltip bubble */
  tooltipClassName?: string;
  /** Placement direction of the floating tooltip. Defaults to 'top' */
  tooltipPlacement?: 'top' | 'bottom';
  /** Hide the info icon if desired */
  hideIcon?: boolean;
  /** Click handler if the badge is interactive */
  onClick?: (e: React.MouseEvent) => void;
  /** Optional data attribute pass-through */
  'data-routine-source'?: string;
  'data-self-learning-badge'?: string;
}

export function SelfLearningBadge({
  label,
  tooltip,
  variant = 'neutral',
  className,
  tooltipClassName,
  tooltipPlacement = 'top',
  hideIcon = false,
  onClick,
  'data-routine-source': dataRoutineSource,
  'data-self-learning-badge': dataSelfLearningBadge = '',
}: SelfLearningBadgeProps) {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);

  const displayText = label ?? (t('selfLearningBetaBadge') || '测试');
  const tooltipText = tooltip ?? (t('selfLearningBetaTooltip') || '测试功能，可能存在不稳定性');

  const variantClass =
    variant === 'accent'
      ? 'bg-accent/10 text-accent border border-accent/25 hover:bg-accent/15'
      : variant === 'subtle'
      ? 'bg-transparent text-ink-3 border border-line/60 hover:bg-hover-2 hover:text-ink-2'
      : 'bg-hover-2 text-ink-3 border border-line/70 hover:bg-hover hover:text-ink-2 hover:border-line';

  const isTop = tooltipPlacement === 'top';

  return (
    <span
      className={cn(
        'group/slb relative inline-flex items-center gap-1 shrink-0 select-none align-middle',
        'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors cursor-default',
        variantClass,
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      onClick={onClick}
      role="note"
      aria-label={`${displayText}: ${tooltipText}`}
      data-self-learning-badge={dataSelfLearningBadge || 'true'}
      {...(dataRoutineSource ? { 'data-routine-source': dataRoutineSource } : {})}
    >
      <span className="truncate leading-none">{displayText}</span>
      {!hideIcon && (
        <Info
          className="h-3 w-3 shrink-0 stroke-[1.8] opacity-80"
          aria-hidden="true"
        />
      )}

      {/* Floating Tooltip Box matching screenshot */}
      <div
        role="tooltip"
        aria-hidden={!isHovered}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[8px]',
          'border border-line bg-surface/98 px-2.5 py-1.5 text-[11.5px] font-normal leading-tight text-ink shadow-overlay backdrop-blur-sm',
          'transition-all duration-150 ease-out',
          isTop
            ? 'bottom-[calc(100%+6px)] origin-bottom'
            : 'top-[calc(100%+6px)] origin-top',
          isHovered
            ? 'opacity-100 scale-100 visible translate-y-0'
            : isTop
            ? 'opacity-0 scale-95 invisible translate-y-1'
            : 'opacity-0 scale-95 invisible -translate-y-1',
          tooltipClassName,
        )}
      >
        <span>{tooltipText}</span>
        {/* Tooltip Caret / Arrow pointing towards the badge */}
        <span
          className={cn(
            'absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-surface border-line',
            isTop
              ? '-bottom-[4px] border-b border-r'
              : '-top-[4px] border-t border-l',
          )}
          aria-hidden="true"
        />
      </div>
    </span>
  );
}

export default SelfLearningBadge;
