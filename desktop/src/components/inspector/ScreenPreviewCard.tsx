import React from 'react';
import { Agent } from '../../types';
import AgentScreen from '../primitives/AgentScreen';
import { useI18n } from '../../i18n';

interface ScreenPreviewCardProps {
  agent: Agent;
}

export const ScreenPreviewCard: React.FC<ScreenPreviewCardProps> = ({ agent }) => {
  const { t } = useI18n();
  return agent.previewUrl ? (
    <AgentScreen
      agentName={agent.name}
      streamSrc={agent.previewUrl}
      screenLabel={t('screenPreviewTitle', { name: agent.name }) || `${agent.name} screen`}
      openLabel={t('dialogOpen') || 'Open'}
      closeLabel={t('close') || 'Close'}
    />
  ) : null;
};
