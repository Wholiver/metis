import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { CollaborationMode, ModelOption } from '../../types';
import { modelLabel } from './ModelSwitcher';
import { useI18n } from '../../i18n';

export function collaborationModeLabel(mode?: CollaborationMode): string {
  if (mode === 'plan') return 'Plan';
  if (mode === 'build') return 'Build';
  return '';
}

export function buildAssistantTurnMeta(options: {
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
}): string {
  const parts = [collaborationModeLabel(options.collaborationMode)];
  if (options.model) parts.push(modelLabel(options.model));
  return parts.filter(Boolean).join(' · ');
}

interface AssistantTurnFooterProps {
  copyText: string;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
}

export const AssistantTurnFooter: React.FC<AssistantTurnFooterProps> = ({
  copyText,
  collaborationMode,
  model,
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const meta = buildAssistantTurnMeta({ collaborationMode, model });
  const trimmed = copyText.trim();
  if (!trimmed && !meta) return null;

  const handleCopy = async () => {
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const copyLabel = copied
    ? (t('responseCopied') || t('planCopied') || 'Copied')
    : (t('copyResponse') || t('copy') || 'Copy response');

  return (
    <div
      className="mt-1 flex min-h-6 items-center justify-start gap-2.5"
      data-slot="text-part-copy-wrapper"
      data-assistant-turn-footer=""
    >
      {trimmed ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { void handleCopy(); }}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
          title={copyLabel}
          aria-label={copyLabel}
          data-assistant-turn-copy=""
        >
          {copied
            ? <Check className="h-3.5 w-3.5 stroke-[2.2] text-green" aria-hidden="true" />
            : <Copy className="h-3.5 w-3.5 stroke-[1.8]" aria-hidden="true" />}
        </button>
      ) : null}
      {meta ? (
        <span
          className="cursor-default select-none text-[12px] leading-none text-ink-3"
          data-slot="text-part-meta"
          data-assistant-turn-meta=""
        >
          {meta}
        </span>
      ) : null}
    </div>
  );
};
