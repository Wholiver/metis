/**
 * Source: https://www.beautifului.dev/r/recommendation-card.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, type ButtonVariant } from "../atoms/Button";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

export type RecommendationOption = {
  key: string;
  body: ReactNode;
  short: string;
  signal?: number;
  tone?: string;
  label?: string;
  cta: string;
  ctaVariant?: ButtonVariant;
};

export type RecommendationLabels = {
  title: string;
  alternatives?: string;
  otherOptions?: string;
  accepted?: string;
};

export type RecommendationCardProps = {
  options?: RecommendationOption[];
  labels?: Partial<RecommendationLabels>;
  eyebrow?: string;
  title?: string;
  body?: ReactNode;
  collapsedBody?: ReactNode;
  meta?: string;
  actionLabel?: string;
  disabled?: boolean;
  onAction?: () => void;
  children?: ReactNode;
  className?: string;
  variant?: string;
};

export default function RecommendationCard({
  options,
  labels,
  eyebrow,
  title,
  body,
  collapsedBody,
  meta,
  actionLabel,
  disabled = false,
  onAction,
  children,
  className,
}: RecommendationCardProps = {}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const active = options?.[0];
  const displayTitle = title || active?.short || t('proposedPlanReady') || 'Proposed plan';
  const rawBody = children ?? body ?? active?.body;
  const displayCta = actionLabel ?? active?.cta ?? (t('reactUiOpenPlanInInspector') || 'Open plan in inspector');
  const displayCtaVariant = (actionLabel ? "accent" : active?.ctaVariant || "accent") as ButtonVariant;

  const handleAction = () => {
    setAccepted(true);
    onAction?.();
  };

  const isLong = Boolean(collapsedBody) || (typeof rawBody === 'string' ? rawBody.trim().length > 120 || rawBody.includes('\n') : Boolean(rawBody));

  return (
    <div
      className={cn("w-full max-w-full overflow-hidden rounded-card bg-surface shadow-card", className)}
      data-recommendation-card=""
    >
      <div className="primitive-card-pad pb-1" data-recommendation-content="">
        {eyebrow && (
          <div className="flex items-center gap-2 pb-1.5 text-[11.5px] font-medium text-ink-3" data-recommendation-eyebrow="">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            <span>{eyebrow}</span>
            {meta && <span className="ml-auto font-mono tabular-nums">{meta}</span>}
          </div>
        )}
        <span className="text-[14px] font-medium text-ink" data-recommendation-title="">
          {displayTitle}
        </span>
        {rawBody ? (
          <div className="mt-2" data-recommendation-body="">
            <div
              className={cn(
                "text-[13px] leading-relaxed text-ink-2 whitespace-pre-wrap break-words",
                !expanded && "line-clamp-3 overflow-hidden text-ellipsis text-pretty",
              )}
            >
              {expanded ? rawBody : (collapsedBody ?? rawBody)}
            </div>
          </div>
        ) : null}
      </div>

      {/* Action footer without divider line */}
      <div className="primitive-card-footer flex items-center justify-end gap-2 border-0 px-3 py-2.5 bg-surface" data-recommendation-footer="">
        {isLong ? (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="px-2.5 text-[12.5px]"
            data-recommendation-expand=""
          >
            <span>{expanded ? (t('proposedPlanCollapse') || '收起方案') : (t('proposedPlanExpand') || '展开方案')}</span>
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </Button>
        ) : null}
        <Button
          variant={accepted ? "success" : displayCtaVariant}
          size="sm"
          disabled={disabled}
          onClick={handleAction}
          className="text-[12.5px] whitespace-nowrap shrink-0 px-3.5"
          data-recommendation-action=""
        >
          {accepted ? (labels?.accepted || t('confirm')) : displayCta}
        </Button>
      </div>
    </div>
  );
}
