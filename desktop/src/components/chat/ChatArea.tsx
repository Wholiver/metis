import React, { useEffect, useState } from 'react';
import { Agent, CollaborationMode, ContextUsage, MemoryState, Message, ModelOption, PendingUserInput, SendMessageOptions, ThinkingOption, TokenBreakdown, UserInputResponse, WorkflowPlanState, WorkflowProposalState } from '../../types';
import { IDLE_COMPOSER_ACTIVITY, reduceComposerActivity } from '../../lib/composer';
import { resolveConversationProgress } from '../../lib/work-progress';
import { RateLimitWindow } from '../inspector/UsageQuotaCard';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { SkillCommand } from './SkillPicker';
import { UserInputCard } from './UserInputCard';

interface ChatAreaProps {
  agent: Agent;
  messages: Message[];
  workspacePath?: string;
  projectName?: string;
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
}

export const ChatArea = React.memo<ChatAreaProps>(({
  agent,
  messages,
  workspacePath,
  projectName,
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
}) => {
  const [composerActivity, setComposerActivity] = useState(IDLE_COMPOSER_ACTIVITY);

  useEffect(() => {
    setComposerActivity((current) => reduceComposerActivity(current, {
      type: 'server-streaming-changed',
      streaming: isStreaming,
    }));
  }, [isStreaming]);

  const handleSendMessage = async (text: string, options?: SendMessageOptions) => {
    setComposerActivity((current) => reduceComposerActivity(current, { type: 'send-started' }));
    try {
      const result = await onSendMessage(text, options);
      setComposerActivity((current) => reduceComposerActivity(current, { type: 'send-settled' }));
      return result;
    } catch (error) {
      setComposerActivity(IDLE_COMPOSER_ACTIVITY);
      throw error;
    }
  };

  const showActiveProgress = composerActivity.localTaskPending || isStreaming || Boolean(pendingUserInput);
  const { progress: currentProgress, idle: isCurrentIdle } = resolveConversationProgress(
    messages,
    showActiveProgress,
    Boolean(pendingUserInput)
  );
  const lastMessage = messages[messages.length - 1];
  const workflowPlanInterrupted = !showActiveProgress
    && lastMessage?.role === 'assistant'
    && lastMessage.stopReason === 'aborted';

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
      />
      <MessageList
        key={agent.id}
        messages={messages}
        workspacePath={workspacePath}
        projectName={projectName}
        isLoading={isLoading}
        isStreaming={showActiveProgress}
        workflowProposal={workflowProposal}
        onOpenPlan={onOpenPlan}
        pendingUserInput={pendingUserInput}
        onSendMessage={handleSendMessage}
        collaborationMode={collaborationMode}
        model={activeModel}
      />
      {pendingUserInput ? (
        <UserInputCard request={pendingUserInput}
          onRespond={onRespondToUserInput}
          progress={currentProgress}
          idle={isCurrentIdle}
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
          onAbort={onAbort}
          workProgress={currentProgress}
          isWorkIdle={isCurrentIdle}
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
