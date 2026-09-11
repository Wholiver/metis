import React from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Button } from '../atoms/Button';

export interface AssistantErrorCardProps {
  error?: string;
  onRetry?: () => void;
  className?: string;
}

export const AssistantErrorCard: React.FC<AssistantErrorCardProps> = ({
  error,
  onRetry,
  className = '',
}) => {
  const { t } = useI18n();
  const errorText = error?.trim() || t('assistantErrorDefault') || 'The request timed out or was interrupted.';

  return (
    <div
      className={`my-2 w-full max-w-full rounded-card border border-[color-mix(in_srgb,var(--red)_28%,var(--line))] bg-red-tint/70 p-3.5 text-left text-ink ${className}`}
      data-assistant-error-card=""
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-red">
            {t('assistantErrorTitle') || 'Request failed'}
          </div>
          <div
            className="mt-1 select-text break-words whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[color-mix(in_srgb,var(--red)_80%,var(--ink))]"
            data-assistant-error-message=""
          >
            {errorText}
          </div>
          {onRetry && (
            <div className="mt-2.5 flex items-center">
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={onRetry}
                data-assistant-retry=""
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5 stroke-[2]" aria-hidden="true" />
                <span>{t('assistantRetry') || 'Retry'}</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AssistantErrorCard.displayName = 'AssistantErrorCard';
