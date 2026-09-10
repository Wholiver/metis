import React from 'react';
import { useI18n } from '../../i18n';

interface ChatHomeEmptyStateProps {
  projectName?: string;
}

export const ChatHomeEmptyState: React.FC<ChatHomeEmptyStateProps> = ({
  projectName,
}) => {
  const { t } = useI18n();
  const displayProject = projectName || t('chatHomeDefaultProject');
  const prefix = t('chatHomePrefix');
  const suffix = t('chatHomeSuffix');

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center my-auto py-10 w-full max-w-[620px] select-none pointer-events-none"
      data-home-empty-state=""
    >
      <h2 className="text-[15px] font-normal text-ink-2 tracking-normal text-center select-text max-w-[420px] leading-relaxed">
        {prefix ? `${prefix} ` : ''}
        <span className="text-ink font-medium">
          {displayProject}
        </span>
        {suffix ? (suffix.startsWith(' ') || suffix.startsWith('?') || suffix.startsWith('？') ? suffix : ` ${suffix}`) : ''}
      </h2>
    </div>
  );
};
