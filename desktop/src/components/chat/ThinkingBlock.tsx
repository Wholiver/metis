import React from 'react';
import { useI18n } from '../../i18n';
import { TextShimmer } from './TextShimmer';

interface ThinkingBlockProps {
  thinking?: string;
  streaming?: boolean;
  active?: boolean;
}

export function thinkingSummary(thinking: string): string {
  const heading = thinking.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  const firstLine = thinking.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const summary = (heading || firstLine)
    .replace(/^[-*+>\s#]+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
  if (!summary) return 'Thinking';
  return summary.length > 88 ? `${summary.slice(0, 87).trimEnd()}…` : summary;
}

export function thinkingBody(thinking: string): string {
  const withoutLeadingHeading = thinking.replace(/^\s{0,3}#{1,6}\s+.+?\s*#*\s*(?:\r?\n)+/, '');
  if (withoutLeadingHeading !== thinking) {
    return withoutLeadingHeading.trim() || thinking.trim();
  }
  const trimmed = thinking.trim();
  const newlineIndex = trimmed.search(/\r?\n/);
  if (newlineIndex !== -1) {
    const remainder = trimmed.slice(newlineIndex).trim();
    if (remainder) return remainder;
  }
  return trimmed;
}

export function thinkingSubtitle(thinking: string): string {
  const firstLine = thinking.trim().split(/\r?\n/)[0] ?? '';
  return firstLine.slice(0, 80);
}

/** OpenCode TimelineThinkingRow: shimmer only — no reasoning body or title. */
export const ThinkingBlock = React.memo<ThinkingBlockProps>(({
  streaming = false,
  active,
}) => {
  const isActive = active ?? streaming;
  const { t } = useI18n();

  if (!isActive) return null;

  return (
    <div
      data-slot="session-turn-thinking"
      data-thinking-block=""
      data-direct-thinking="true"
      data-part-type="thinking"
      role="status"
    >
      <TextShimmer text={t('sessionThinking')} active />
    </div>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';
