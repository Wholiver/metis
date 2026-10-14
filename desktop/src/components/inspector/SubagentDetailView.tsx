import React from 'react';
import { Square } from 'lucide-react';
import { CollaborationMode, ModelOption } from '../../types';
import { SubagentItem } from '../../lib/subagents';
import { useI18n } from '../../i18n';
import { SubagentConversation } from '../chat/SubagentConversation';

interface SubagentDetailViewProps {
  subagent: SubagentItem;
  onOpenSubagent?: (partId: string) => void;
  onStop?: (subagentId: string) => void;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
  contentRef?: React.Ref<HTMLDivElement>;
}

/** Inspector transcript for one subagent, including a stop control while it runs. */
export const SubagentDetailView: React.FC<SubagentDetailViewProps> = ({
  subagent,
  onOpenSubagent,
  onStop,
  collaborationMode,
  model,
  contentRef,
}) => {
  const { t } = useI18n();
  const running = subagent.status === 'running';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-page" data-subagent-detail-view="">
      {running && onStop ? (
        <div className="flex shrink-0 items-center justify-end px-3.5 pt-2">
          <button
            type="button"
            onClick={() => onStop(subagent.agentId || subagent.id)}
            className="rounded-chip px-2.5 py-1 text-[12px] font-medium text-red hover:bg-red/10 transition-colors flex items-center gap-1.5"
            data-subagent-stop-button=""
            title={t('stopSubagent')}
            aria-label={t('stopSubagent')}
          >
            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            <span>{t('stopSubagent')}</span>
          </button>
        </div>
      ) : null}
      <SubagentConversation
        subagent={subagent}
        contentRef={contentRef}
        onOpenSubagent={onOpenSubagent}
        collaborationMode={collaborationMode}
        model={model}
        className="min-h-0 w-full flex-1 overflow-y-auto px-3.5 py-3 flex flex-col"
        fullWidth
      />
    </div>
  );
};
