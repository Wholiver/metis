import React from 'react';
import { CloudAvatar } from './CloudAvatar';
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
      className="flex flex-1 flex-col items-center justify-center my-auto py-8 w-full max-w-[620px] select-none pointer-events-none animate-in fade-in duration-300"
      data-home-empty-state=""
    >
      {/* Cloud Avatar - Scaled up proportionally */}
      <div className="mb-6 flex items-center justify-center" data-home-cloud="">
        <CloudAvatar size={110} className="drop-shadow-sm" />
      </div>

      {/* Heading - Scaled up proportionally */}
      <h2 className="text-[24px] sm:text-[28px] font-normal text-slate-800 tracking-normal text-center select-text">
        {prefix ? `${prefix} ` : ''}
        <span className="underline decoration-slate-400 decoration-1 underline-offset-4 mx-1.5">
          {displayProject}
        </span>
        {suffix ? (suffix.startsWith(' ') || suffix.startsWith('?') || suffix.startsWith('？') ? suffix : ` ${suffix}`) : ''}
      </h2>
    </div>
  );
};
