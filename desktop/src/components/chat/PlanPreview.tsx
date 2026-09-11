import React from 'react';
import { splitPlanTitle, summarizePlanPreview } from '../../lib/plan-preview';
import { useI18n } from '../../i18n';
import RecommendationCard from '../primitives/RecommendationCard';
import { MarkdownContent } from './MarkdownContent';

interface PlanPreviewProps {
  markdown: string;
  partial?: boolean;
  current?: boolean;
  onOpenPlan?: (markdown: string) => void;
}

export const PlanPreview: React.FC<PlanPreviewProps> = ({
  markdown,
  partial = false,
  current = false,
  onOpenPlan,
}) => {
  const { t } = useI18n();
  const { title, body } = splitPlanTitle(markdown);
  const summary = summarizePlanPreview(body);
  const partialLabel = t('reactUiDraftingPlan') || 'Drafting plan…';
  const openLabel = t('reactUiOpenPlanInInspector') || 'Open plan in inspector';

  return (
    <div
      className="plan-preview my-2.5 w-full max-w-full"
      data-plan-preview=""
      data-plan-current={current ? 'true' : 'false'}
      data-plan-partial={partial ? 'true' : 'false'}
    >
      {partial ? (
        <span className="sr-only" role="status">{partialLabel}</span>
      ) : null}
      <RecommendationCard
        title={title}
        body={body ? <MarkdownContent markdown={body} className="plan-preview-markdown" /> : undefined}
        collapsedBody={summary || undefined}
        actionLabel={openLabel}
        disabled={partial && !markdown.trim()}
        onAction={() => onOpenPlan?.(markdown)}
        className="border-0"
      />
    </div>
  );
};
