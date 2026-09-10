import React from 'react';
import { ContextUsage, TokenBreakdown } from '../../types';
import { RateLimitWindow } from '../inspector/UsageQuotaCard';
import { formatTokenCount } from './TokenUsageBar';
import { useI18n } from '../../i18n';

export interface ComposerUsageFooterProps {
  isOAuth?: boolean;
  totalCost?: number;
  totalTokens?: number;
  quota5h?: RateLimitWindow;
  quota7d?: RateLimitWindow;
  contextUsage?: ContextUsage;
  tokenBreakdown?: TokenBreakdown;
}

function formatCost(totalCost: number): string {
  if (totalCost >= 100) return totalCost.toFixed(1);
  if (totalCost >= 0.01) return totalCost.toFixed(2);
  if (totalCost > 0) return totalCost.toFixed(3);
  return '0.00';
}

function formatQuotaPercent(percent: number | undefined): string {
  const value = Number.isFinite(percent) ? Math.min(Math.max(percent || 0, 0), 100) : 0;
  return `${Math.round(value)}%`;
}

export function ComposerUsageFooter({
  isOAuth = false,
  totalCost = 0,
  totalTokens = 0,
  quota5h,
  quota7d,
  contextUsage,
  tokenBreakdown,
}: ComposerUsageFooterProps) {
  const { t } = useI18n();
  const contextWindow = contextUsage?.contextWindow || tokenBreakdown?.contextWindow || 256_000;
  const usedTokens = contextUsage?.tokens ?? tokenBreakdown?.total ?? 0;
  const contextLabel = `${formatTokenCount(usedTokens)} / ${formatTokenCount(contextWindow)}`;

  const leading = isOAuth
    ? `5h ${formatQuotaPercent(quota5h?.percent)} · 7d ${formatQuotaPercent(quota7d?.percent)}`
    : `$${formatCost(totalCost)} · ${formatTokenCount(totalTokens)}`;

  return (
    <div
      className="pointer-events-auto mt-2 flex w-full max-w-[620px] items-center justify-between gap-3 px-1 text-[11px] leading-none text-ink-3 tabular-nums"
      data-composer-usage-footer=""
      aria-label={t('composerUsageAria')}
    >
      <span className="min-w-0 truncate" data-composer-usage-leading="">
        {leading}
      </span>
      <span className="shrink-0" data-composer-usage-context="">
        {contextLabel}
      </span>
    </div>
  );
}
