import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Agent, CollaborationMode, ContextUsage, MemoryState, Message, ModelOption, PendingUserInput, ProjectItem, SendMessageOptions, ThinkingOption, TokenBreakdown, UserInputResponse, WorkflowPlanState, WorkflowProposalState } from '../../types';
import { IDLE_COMPOSER_ACTIVITY, reduceComposerActivity } from '../../lib/composer';
import { formatAgentTitle } from '../../lib/task-agent';
import { SubagentItem } from '../../lib/subagents';
import { RateLimitWindow } from '../inspector/UsageQuotaCard';
import { ChatHeader, ChatBreadcrumbSegment } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { SkillCommand } from './SkillPicker';
import { UserInputCard } from './UserInputCard';
import { SubagentConversation } from './SubagentConversation';
import { useI18n } from '../../i18n';

interface ChatAreaProps {
  agent: Agent;
  messages: Message[];
  workspacePath?: string;
  projectName?: string;
  projects?: ProjectItem[];
  activeProject?: ProjectItem;
  onSelectProject?: (id: string) => void | Promise<void>;
  isSidebarOpen?: boolean;
  isInspectorOpen?: boolean;
  onToggleSidebar?: () => void;
  onSendMessage: (text: string, options?: SendMessageOptions) => boolean | void | Promise<boolean | void>;
  onAbort?: () => void | Promise<void>;
  models: ModelOption[];
  activeModel?: ModelOption;
  onSelectModel: (model: ModelOption) => void | Promise<void>;
  isChangingModel?: boolean;
  thinkingLevel?: string;
  thinkingLevels?: string[];
  thinkingOptions?: ThinkingOption[];
  supportsThinking?: boolean;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  isChangingThinking?: boolean;
  collaborationMode: CollaborationMode;
  onSelectCollaborationMode: (mode: CollaborationMode) => boolean | void | Promise<boolean | void>;
  isChangingCollaborationMode?: boolean;
  skills?: SkillCommand[];
  isCompacting?: boolean;
  onToggleInspector?: () => void;
  isStreaming?: boolean;
  isLoading?: boolean;
  workflowProposal?: WorkflowProposalState;
  workflowPlan?: WorkflowPlanState;
  onOpenPlan?: (markdown: string) => void;
  pendingUserInput?: PendingUserInput;
  onRespondToUserInput: (requestId: string, response: UserInputResponse) => boolean | Promise<boolean>;
  onNewChat?: () => void;
  memoryState?: MemoryState;
  onOpenMemorySettings?: () => void;
  contextUsage?: ContextUsage;
  tokenBreakdown?: TokenBreakdown;
  isOAuth?: boolean;
  totalCost?: number;
  totalTokens?: number;
  quota5h?: RateLimitWindow;
  quota7d?: RateLimitWindow;
  onOpenSubagent?: (partId: string) => void;
  viewingSubagent?: SubagentItem | null;
  subagentTrail?: SubagentItem[];
  onNavigateBreadcrumb?: (depth: number) => void;
  onBackToParent?: () => void;
}

export const ChatArea = React.memo<ChatAreaProps>(({
  agent,
  messages,
  workspacePath,
  projectName,
  projects = [],
  activeProject,
  onSelectProject,
  isSidebarOpen = true,
  isInspectorOpen = true,
  onToggleSidebar,
  onSendMessage,
  onAbort,
  models,
  activeModel,
  onSelectModel,
  isChangingModel = false,
  thinkingLevel,
  thinkingLevels,
  thinkingOptions,
  supportsThinking = false,
  onSelectThinkingLevel,
  isChangingThinking = false,
  collaborationMode,
  onSelectCollaborationMode,
  isChangingCollaborationMode = false,
  skills = [],
  isCompacting = false,
  onToggleInspector,
  isStreaming = false,
  isLoading = false,
  workflowProposal,
  workflowPlan,
  onOpenPlan,
  pendingUserInput,
  onRespondToUserInput,
  onNewChat,
  memoryState,
  onOpenMemorySettings,
  contextUsage,
  tokenBreakdown,
  isOAuth = false,
  totalCost,
  totalTokens,
  quota5h,
  quota7d,
  onOpenSubagent,
  viewingSubagent = null,
  subagentTrail = [],
  onNavigateBreadcrumb,
  onBackToParent,
}) => {
  const { t } = useI18n();
  const [composerActivity, setComposerActivity] = useState(IDLE_COMPOSER_ACTIVITY);

  useEffect(() => {
    setComposerActivity((current) => reduceComposerActivity(current, {
      type: 'server-streaming-changed',
      streaming: isStreaming,
    }));
  }, [isStreaming]);

  const handleSendMessage = useCallback(async (text: string, options?: SendMessageOptions) => {
    setComposerActivity((current) => reduceComposerActivity(current, { type: 'send-started' }));
    try {
      const result = await onSendMessage(text, options);
      setComposerActivity((current) => reduceComposerActivity(current, { type: 'send-settled' }));
      return result;
    } catch (error) {
      setComposerActivity(IDLE_COMPOSER_ACTIVITY);
      throw error;
    }
  }, [onSendMessage]);

  const showActiveProgress = composerActivity.localTaskPending || isStreaming || Boolean(pendingUserInput);
  const lastMessage = messages[messages.length - 1];
  const workflowPlanInterrupted = !showActiveProgress
    && lastMessage?.role === 'assistant'
    && lastMessage.stopReason === 'aborted';
  const isHomeEmpty = messages.length === 0 && !isLoading && !showActiveProgress && !pendingUserInput && !viewingSubagent;

  const breadcrumb = useMemo((): ChatBreadcrumbSegment[] | undefined => {
    if (!viewingSubagent || subagentTrail.length === 0) return undefined;
    return [
      { id: `root:${agent.id}`, label: agent.name, depth: -1 },
      ...subagentTrail.map((item, index) => ({
        id: item.id,
        label: formatAgentTitle(item.role),
        depth: index,
      })),
    ];
  }, [agent.id, agent.name, subagentTrail, viewingSubagent]);

  const parentLabel = subagentTrail.length > 1
    ? formatAgentTitle(subagentTrail[subagentTrail.length - 2]!.role)
    : agent.name;

  return (
    <main data-purpose="main-chat" className="flex-1 h-full bg-page flex flex-col min-w-[360px] overflow-hidden relative">
      <ChatHeader
        agent={agent}
        isSidebarOpen={isSidebarOpen}
        isInspectorOpen={isInspectorOpen}
        onToggleSidebar={onToggleSidebar}
        onToggleInspector={onToggleInspector}
        onNewChat={onNewChat}
        memoryState={memoryState}
        onOpenMemorySettings={onOpenMemorySettings}
        breadcrumb={breadcrumb}
        onNavigateBreadcrumb={onNavigateBreadcrumb}
      />
      {viewingSubagent ? (
        <SubagentConversation
          key={viewingSubagent.id}
          subagent={viewingSubagent}
          onOpenSubagent={onOpenSubagent}
          collaborationMode={collaborationMode}
          model={activeModel}
        />
      ) : (
        <MessageList
          sessionId={agent.id}
          messages={messages}
          workspacePath={workspacePath}
          projectName={projectName}
          isLoading={isLoading}
          isStreaming={showActiveProgress}
          isHomeEmpty={isHomeEmpty}
          workflowProposal={workflowProposal}
          onOpenPlan={onOpenPlan}
          pendingUserInput={pendingUserInput}
          onSendMessage={handleSendMessage}
          collaborationMode={collaborationMode}
          model={activeModel}
          onOpenSubagent={onOpenSubagent}
        />
      )}
      {viewingSubagent ? (
        <div
          className="flex-shrink-0 border-t border-line px-4 py-3 flex items-center justify-center bg-page"
          data-subagent-composer-bar=""
        >
          <button
            type="button"
            onClick={onBackToParent}
            className="rounded-chip px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink transition-colors"
            data-back-to-parent=""
          >
            {t('backToParent', { name: parentLabel })}
          </button>
        </div>
      ) : pendingUserInput ? (
        <UserInputCard
          request={pendingUserInput}
          onRespond={onRespondToUserInput}
        />
      ) : (
        <Composer
          agent={agent}
          onSendMessage={handleSendMessage}
          models={models}
          activeModel={activeModel}
          onSelectModel={onSelectModel}
          isChangingModel={isChangingModel}
          thinkingLevel={thinkingLevel}
          thinkingLevels={thinkingLevels}
          thinkingOptions={thinkingOptions}
          supportsThinking={supportsThinking}
          onSelectThinkingLevel={onSelectThinkingLevel}
          isChangingThinking={isChangingThinking}
          collaborationMode={collaborationMode}
          onSelectCollaborationMode={onSelectCollaborationMode}
          isChangingCollaborationMode={isChangingCollaborationMode}
          skills={skills}
          disabled={showActiveProgress || isLoading || isCompacting}
          isStreaming={showActiveProgress}
          isHomeEmpty={isHomeEmpty}
          projects={projects}
          activeProject={activeProject}
          onSelectProject={onSelectProject}
          onAbort={onAbort}
          workflowPlan={workflowPlan}
          workflowPlanInterrupted={workflowPlanInterrupted}
          contextUsage={contextUsage}
          tokenBreakdown={tokenBreakdown}
          isOAuth={isOAuth}
          totalCost={totalCost}
          totalTokens={totalTokens}
          quota5h={quota5h}
          quota7d={quota7d}
        />
      )}
    </main>
  );
});

ChatArea.displayName = 'ChatArea';
