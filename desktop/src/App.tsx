import React, { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { RoutinesManager } from './components/routines/RoutinesManager';
import { CodeTreeManager } from './components/codetree/CodeTreeManager';
import { HarnessEditor } from './components/harness/HarnessEditor';
import { Inspector } from './components/inspector/Inspector';
import {
  createInspectorTabsState,
  inspectorTabsReducer,
  type InspectorTab,
  type InspectorTabKind,
} from './lib/inspector-tabs';
import { ExtensionUiRequest } from './lib/extension-ui';
import {
  collectSubagentItems,
  decideSubagentFollow,
  findSubagentById,
  mergeSubagentHistoryItems,
  parseSubagentHistory,
  SUBAGENT_HISTORY_STORAGE_KEY,
  type SubagentHistory,
} from './lib/subagents';
import {
  archiveSession,
  archivedSessionIds as archivedSessionIdSet,
  listArchivedSessions,
  loadArchivedSessions,
  saveArchivedSessions,
  unarchiveSession,
  type ArchivedSessionsMap,
} from './lib/archived-sessions';
import { pathsEqual, useMetisServer } from './hooks/useMetisServer';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import { useSystemTheme } from './hooks/useSystemTheme';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ExtensionUiDialog } from './components/ExtensionUiDialog';
import { RemotePathModal } from './components/workspace/RemotePathModal';
import { Onboarding, shouldShowOnboarding } from './components/onboarding/Onboarding';
import { OnboardingTransition, type OnboardingTransitionStage } from './components/onboarding/OnboardingTransition';
import { SkillCommand } from './components/chat/SkillPicker';
import { Agent, AssistantContentPart, Message, ModelOption, PendingUserInput, ProjectItem, ThinkingOption, WorkflowPlanState } from './types';
import { resolveBrowserShineActive } from './lib/browser-control';
import { useI18n } from './i18n';

const PROJECTS_STORAGE_KEY = 'metis.desktop.projects.v1';
const ACTIVE_PROJECT_STORAGE_KEY = 'metis.desktop.activeProject.v1';

const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 500;

const MIN_INSPECTOR_WIDTH = 360;
const MAX_INSPECTOR_WIDTH = 850;

const PLAN_CAPTURE_MARKDOWN = `# Plan、Ask、Memory 与默认工作流升级

## Summary

- 重写 Plan prompt 为三阶段协议：先理解仓库，再确认用户意图，最后锁定实现；存在高影响歧义时必须调用 \`ask_user\`，禁止提前输出 plan。
- 保持当前 workflow proposal 为唯一可执行版本，历史方案只读。

## Implementation

1. 接入 proposal 状态与消息渲染。
2. 验证流式、折叠和执行操作。`;

const CONVERSATION_ICON_CAPTURE_AGENTS: Agent[] = [
  { id: 'capture-chief-of-staff-0', name: 'Chief of Staff', subtitle: 'Got it! Product updates shared.', time: '7:34 PM', avatarType: 'blob', gradient: '' },
  { id: 'capture-ea-1', name: 'EA', subtitle: 'Responded in 3 threads, with notes ready.', time: '', avatarType: 'blob', gradient: '' },
  { id: 'capture-inbox-manager-0', name: 'Inbox Manager', subtitle: 'Inbox at zero. 2 replies ready.', time: '', avatarType: 'blob', gradient: '' },
  { id: 'capture-sales-outbound-0', name: 'Sales Outbound', subtitle: 'Outreach drafts queued for approval.', time: '11:18 AM', avatarType: 'blob', gradient: '' },
  { id: 'capture-talent-scout-3', name: 'Talent Scout', subtitle: 'Shortlist of 6 candidates ready.', time: '', unread: true, avatarType: 'blob', gradient: '' },
  { id: 'capture-growth-marketer-4', name: 'Growth Marketer', subtitle: 'A/B copy variants ready to review.', time: '9:04 AM', avatarType: 'blob', gradient: '' },
  { id: 'capture-customer-support-6', name: 'Customer Support', subtitle: '12 tickets resolved, 2 escalated.', time: '2:20 PM', avatarType: 'blob', gradient: '' },
  { id: 'capture-expense-manager-7', name: 'Expense Manager', subtitle: 'Receipts coded — one needs attention.', time: 'Tuesday', avatarType: 'blob', gradient: '' },
];

const MODEL_SWITCHER_CAPTURE_MODELS: ModelOption[] = [
  { provider: 'openai-codex', id: 'gpt-5.6-codex', name: 'GPT-5.6 Codex', reasoning: true },
  { provider: 'anthropic', id: 'claude-opus-4-6', name: 'Claude Opus 4.6', reasoning: true },
  { provider: 'google', id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', reasoning: true },
];
const MODEL_SWITCHER_CAPTURE_THINKING_OPTIONS: ThinkingOption[] = [
  { id: 'off', label: 'None', value: 'none' },
  { id: 'low', label: 'Low', value: 'low' },
  { id: 'medium', label: 'Medium', value: 'medium' },
  { id: 'high', label: 'High', value: 'high' },
  { id: 'xhigh', label: 'Xhigh', value: 'xhigh' },
];

const SKILL_PICKER_CAPTURE_SKILLS: SkillCommand[] = [
  { name: 'make-interfaces-feel-better', description: 'Design engineering principles for polished interfaces.' },
  { name: 'pdf', description: 'Read, create, inspect, and verify PDF files.' },
  { name: 'imagegen', description: 'Generate or edit raster images.' },
];

const ATTACHMENT_CAPTURE_MESSAGES: Message[] = [
  {
    id: 'capture-attachment-user',
    role: 'user',
    content: '请分析附件中的界面和说明。',
    attachments: [
      {
        id: 'capture-image',
        kind: 'image',
        name: 'interface.svg',
        sizeText: '1.2 KB',
        mimeType: 'image/svg+xml',
        previewUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="100"%3E%3Crect width="160" height="100" rx="18" fill="%236366f1"/%3E%3Ccircle cx="42" cy="50" r="20" fill="white" fill-opacity=".8"/%3E%3Crect x="75" y="35" width="58" height="8" rx="4" fill="white"/%3E%3Crect x="75" y="52" width="42" height="8" rx="4" fill="white" fill-opacity=".65"/%3E%3C/svg%3E',
      },
      {
        id: 'capture-file',
        kind: 'text',
        name: 'requirements.md',
        sizeText: '2.4 KB',
      },
    ],
  },
  {
    id: 'capture-attachment-assistant',
    role: 'assistant',
    content: '已收到图片和说明文件，可以开始分析。',
  },
];

const MESSAGE_WIDTH_CAPTURE_TEXT = Array.from(
  { length: 18 },
  (_, index) => `${index + 1}. eval.scm 已成功就绪并已通过所有验证。解释器支持从 STDIN 读取目标路径、将输出写入 STDOUT，并支持多层递归自解释。`,
).join('\n\n');

const MESSAGE_WIDTH_CAPTURE_MESSAGES: Message[] = [
  { id: 'capture-width-user', role: 'user', content: 'hi' },
  {
    id: 'capture-width-assistant',
    role: 'assistant',
    content: MESSAGE_WIDTH_CAPTURE_TEXT,
    thinkingDurationMs: 2800,
    parts: [
      { type: 'thinking', id: 'capture-width-thinking', thinking: 'Analyzing the context.', durationMs: 2800 },
      { type: 'text', id: 'capture-width-final', text: MESSAGE_WIDTH_CAPTURE_TEXT },
    ],
  },
];

const TOOL_GROUP_CAPTURE_MESSAGES: Message[] = [{
  id: 'capture-tool-group-assistant',
  role: 'assistant',
  content: 'Tool group capture complete.',
  thinkingDurationMs: 4200,
  parts: [
    { type: 'thinking', id: 'capture-tools-thinking', thinking: 'Inspecting and updating the Desktop tool presentation.', durationMs: 4200 },
    { type: 'text', id: 'capture-tools-status', text: 'Keeping the existing reasoning narrative between tool activity.' },
    { type: 'toolCall', id: 'capture-tool-adapt', name: 'adapt', arguments: { action: 'list' }, result: { content: 'Adaptations: 0 loaded.' } },
    { type: 'toolCall', id: 'capture-tool-read-1', name: 'read', arguments: { path: 'desktop/src/components/chat/AssistantWork.tsx' }, result: { content: 'Loaded file.' } },
    { type: 'toolCall', id: 'capture-tool-read-2', name: 'read', arguments: { path: 'desktop/src/components/chat/ToolCard.tsx' }, result: { content: 'Loaded file.' } },
    { type: 'toolCall', id: 'capture-tool-read-3', name: 'read', arguments: { path: 'desktop/src/index.css' }, result: { content: 'Loaded file.' } },
    { type: 'toolCall', id: 'capture-tool-edit-1', name: 'write', arguments: { path: 'desktop/main.cjs', content: 'captureQuery["capture-tools"] = "1";\n' }, result: { content: 'Updated file.' } },
    { type: 'toolCall', id: 'capture-tool-edit-2', name: 'edit', arguments: { path: 'desktop/src/components/chat/Composer.tsx', edits: [{ oldText: 'px-1', newText: '' }, { oldText: 'rounded-xl', newText: 'rounded-2xl' }] }, result: { content: 'Updated file.' } },
    { type: 'toolCall', id: 'capture-tool-edit-3', name: 'edit', arguments: { path: 'test/desktop-react-mode-switcher.test.ts', edits: [{ oldText: 'expect(first)', newText: 'expect(group)' }, { oldText: '', newText: 'expect(second)\n' }] }, result: { content: 'Updated file.' } },
    { type: 'toolCall', id: 'capture-tool-command-1', name: 'exec_command', arguments: { cmd: 'npm test -- test/desktop-react-tool-group.test.ts' }, result: { content: 'Tests passed.' } },
    { type: 'toolCall', id: 'capture-tool-command-2', name: 'exec_command', arguments: { cmd: 'npm --prefix desktop run build' }, result: { content: 'Build passed.' } },
    { type: 'toolCall', id: 'capture-tool-command-3', name: 'exec_command', arguments: { cmd: 'git diff --check' }, result: { content: 'No whitespace errors.' } },
    { type: 'text', id: 'capture-tools-final', text: 'Tool group capture complete.' },
  ],
}];

const WORK_DURATION_CAPTURE_MESSAGES: Message[] = [{
  id: 'capture-work-duration-assistant',
  role: 'assistant',
  content: 'Tool-only work capture complete.',
  serverTimestamp: 1_000,
  parts: [
    { type: 'toolCall', id: 'capture-work-duration-tool', name: 'exec_command', arguments: { cmd: 'python test.py' }, result: { content: 'Passed.', timestamp: 15_800 } },
    { type: 'text', id: 'capture-work-duration-final', text: 'Tool-only work capture complete.' },
  ],
}];

const THINKING_OVERFLOW_CAPTURE_TEXT = `# Investigating File Permissions

I’m checking the existence and writability of the application directory.

The current working directory and target script paths are being compared.

Parent-directory creation behavior is being inspected.

## Access details

**Permission errors** and access controls are being separated from missing-path errors.

Write operations are being checked without changing unrelated files.

Command output is being compared with expected status codes.

Fallback paths are being evaluated for sandboxed environments.

The final result will identify the smallest safe implementation change.`;

const THINKING_OVERFLOW_CAPTURE_MESSAGES: Message[] = [{
  id: 'capture-thinking-overflow-assistant',
  role: 'assistant',
  content: 'Thinking overflow capture complete.\n\n---\n\n## Final result\n\nThe response body remains visually distinct from work details.',
  thinkingDurationMs: 5100,
  parts: [
    { type: 'text', id: 'capture-thinking-status', text: 'Inspecting persistence state and execution progress.' },
    { type: 'thinking', id: 'capture-thinking-overflow-part', thinking: THINKING_OVERFLOW_CAPTURE_TEXT, durationMs: 5100 },
    { type: 'toolCall', id: 'capture-thinking-read', name: 'read', arguments: { path: 'test.py' }, result: { content: 'Loaded file.' } },
    { type: 'toolCall', id: 'capture-thinking-read-output', name: 'read', arguments: { path: 'test_outputs.py' }, result: { content: 'Loaded file.' } },
    { type: 'text', id: 'capture-thinking-overflow-final', text: 'Thinking overflow capture complete.\n\n---\n\n## Final result\n\nThe response body remains visually distinct from work details.' },
  ],
}];

const PLAN_POINTS_CAPTURE: WorkflowPlanState = {
  taskId: 'capture-plan-points',
  phase: 'active',
  explanation: 'Implement and verify the requested Desktop changes.',
  plan: [
    { step: 'Trace the active Desktop state and rendering path', status: 'completed' },
    { step: 'Connect plan points to the Server workflow state', status: 'in_progress' },
    { step: 'Verify populated and empty sidebar states', status: 'pending' },
    { step: 'Confirm scrolling when more than three plan rows are present', status: 'pending' },
  ],
  updatedAt: '2026-08-21T00:00:00.000Z',
};

const PLAN_POINTS_CAPTURE_WORKSPACE = '/workspace/test-project';
const PLAN_POINTS_CAPTURE_MESSAGES: Message[] = [{
  id: 'capture-plan-points-files',
  role: 'assistant',
  content: 'Project update complete.',
  parts: [
    { type: 'toolCall', id: 'capture-roadmap', name: 'write', arguments: { path: 'ROADMAP.md', content: 'Agent governance roadmap.\n' }, result: { content: 'Updated.' } },
    { type: 'toolCall', id: 'capture-scope-receipt', name: 'write', arguments: { path: '/Users/capture/.metis/agent/performance-runs/run-1/artifacts/g2-scope-receipt.md', content: 'Agent governance receipt.\n' }, result: { content: 'Updated.' } },
    { type: 'toolCall', id: 'capture-readme', name: 'edit', arguments: { path: `${PLAN_POINTS_CAPTURE_WORKSPACE}/README.md`, oldText: 'Old copy.', newText: 'Updated project copy.' }, result: { content: 'Updated.' } },
    { type: 'text', id: 'capture-plan-points-final', text: 'Project update complete.' },
  ],
}];

const ASK_CAPTURE: PendingUserInput = {
  requestId: 'capture-ask-request',
  toolCallId: 'capture-ask-tool',
  questions: [
    {
      id: 'scope',
      header: 'Scope',
      question: 'Which scope should this change cover?',
      options: [
        { label: 'Focused', description: 'Only the requested workflow', recommended: true },
        { label: 'Broad', description: 'Related workflows too' },
      ],
    },
    {
      id: 'audience',
      header: 'Audience',
      question: 'Who is this for?',
      options: [
        { label: 'Developers', description: 'Optimize for contributors' },
        { label: 'Everyone', description: 'Balance all readers' },
      ],
    },
  ],
};

const EXTENSION_UI_CAPTURE_REQUEST: ExtensionUiRequest = {
  id: 'capture-extension-ui',
  method: 'input',
  title: 'Complete provider sign in',
  message: 'Paste the authorization code from your browser.',
  placeholder: 'Authorization code',
  options: [],
};

export function App() {
  useSystemTheme();
  const { t } = useI18n();
  const captureParams = new URLSearchParams(window.location.search);
  const capturePlanPreview = captureParams.has('capture-plan-preview');
  const captureWorkflowPlan = captureParams.has('capture-workflow-plan');
  const captureStreamingWork = captureParams.has('capture-streaming-work');
  const captureConversationIcons = captureParams.has('capture-conversation-icons');
  const captureModelSwitcher = captureParams.has('capture-model-switcher');
  const captureAttachments = captureParams.has('capture-attachments');
  const captureLocalSend = captureParams.has('capture-local-send');
  const captureSettledSend = captureParams.has('capture-send-settled');
  const captureThinkingProgress = captureParams.has('capture-thinking-progress');
  const captureMessageWidth = captureParams.has('capture-message-width');
  const captureTools = captureParams.has('capture-tools');
  const captureWorkDuration = captureParams.has('capture-work-duration');
  const captureThinkingOverflow = captureParams.has('capture-thinking-overflow');
  const capturePlanPoints = captureParams.has('capture-plan-points');
  const capturePlanPointsEmpty = captureParams.has('capture-plan-points-empty');
  const captureInspectorTabs = captureParams.has('capture-inspector-tabs');
  const captureAsk = captureParams.has('capture-ask');
  const captureSkills = captureParams.has('capture-skills');
  const captureExtensionUi = captureParams.has('capture-extension-ui');
  const skipSubagentFollow = [...captureParams.keys()].some((key) => key.startsWith('capture-'));
  const [captureThinkingState, setCaptureThinkingState] = useState<'thinking' | 'other'>('thinking');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [projectsReady, setProjectsReady] = useState(false);
  const [isRemoteServer, setIsRemoteServer] = useState(false);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionsMap>(() => loadArchivedSessions());
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const {
    agents,
    projectAgentsByPath,
    prefetchProjectSessions,
    activeAgent,
    activeAgentId,
    messagesSessionId,
    messages,
    sendMessage,
    abortTurn,
    abortSubagent,
    models,
    providerCatalog,
    refreshModels,
    activeModel,
    isChangingModel,
    selectModel,
    thinkingLevel,
    thinkingLevels,
    thinkingOptions,
    supportsThinking,
    isChangingThinking,
    selectThinkingLevel,
    isStreaming,
    workingSessionIds,
    isConnected,
    isCompacting,
    collaborationMode,
    isChangingCollaborationMode,
    selectCollaborationMode,
    workflowPlan,
    workflowProposal,
    pendingUserInput,
    isLoadingSessions,
    isLoadingMessages,
    sessionError,
    request,
    refresh,
    removeConversation,
    connectServer: baseConnectServer,
    selectConversation,
    selectProject,
    newConversation,
    processProposal,
    refineProposal,
    respondToUserInput,
    extensionUiRequest,
    isRespondingToExtensionUi,
    respondToExtensionUi,
    contextUsage,
    tokenBreakdown,
    learningProgress,
    dismissLearningProgress,
  } = useMetisServer(activeProject);

  const { updateCheck, checkForUpdates } = useUpdateCheck(isConnected);

  const [sidebarWidth, setSidebarWidth] = useState<number>(224);
  const [inspectorWidth, setInspectorWidth] = useState<number>(300);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [browserHostBusy, setBrowserHostBusy] = useState(false);
  const [browserShineLatched, setBrowserShineLatched] = useState(false);
  const [isRoutinesViewActive, setIsRoutinesViewActive] = useState(false);
  const [isCodeTreeOpen, setIsCodeTreeOpen] = useState(false);
  const [isHarnessOpen, setIsHarnessOpen] = useState(false);
  const isHarnessOpenRef = useRef(false);
  const harnessLeaveGuardRef = useRef<((proceed: () => void) => void) | null>(null);
  isHarnessOpenRef.current = isHarnessOpen;

  const registerHarnessLeaveGuard = useCallback((guard: ((proceed: () => void) => void) | null) => {
    harnessLeaveGuardRef.current = guard;
  }, []);

  const runIfHarnessAllows = useCallback((action: () => void) => {
    if (!isHarnessOpenRef.current) {
      action();
      return;
    }
    const guard = harnessLeaveGuardRef.current;
    if (!guard) {
      action();
      return;
    }
    guard(action);
  }, []);
  const [treeActiveFilePath, setTreeActiveFilePath] = useState<string | null>(null);
  const [inspectorTabsState, dispatchInspectorTabs] = useReducer(
    inspectorTabsReducer,
    undefined,
    () => {
      let state = createInspectorTabsState();
      if (captureInspectorTabs) {
        const kinds: InspectorTabKind[] = ['files', 'plan', 'subagents'];
        for (let index = 0; index < 20; index += 1) {
          state = inspectorTabsReducer(state, { type: 'open', kind: kinds[index % kinds.length] });
        }
      } else if (capturePlanPreview) {
        state = inspectorTabsReducer(state, {
          type: 'openOrActivate',
          kind: 'plan',
          viewedProposalMarkdown: PLAN_CAPTURE_MARKDOWN,
        });
      } else if (capturePlanPoints || capturePlanPointsEmpty) {
        state = inspectorTabsReducer(state, { type: 'openOrActivate', kind: 'plan' });
      }
      return state;
    },
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => (
    captureSettledSend || captureExtensionUi || captureInspectorTabs || capturePlanPreview || captureWorkflowPlan || capturePlanPoints || capturePlanPointsEmpty || captureTools || captureThinkingOverflow ? false : shouldShowOnboarding()
  ));
  const [onboardingTransitionActive, setOnboardingTransitionActive] = useState(false);
  const [onboardingSourceRect, setOnboardingSourceRect] = useState<DOMRect | null>(null);
  const [transitionStage, setTransitionStage] = useState<OnboardingTransitionStage>('idle');
  const [settingsTab, setSettingsTab] = useState<'general' | 'shortcuts' | 'server' | 'model' | 'agent' | 'security' | 'session' | 'about' | 'adaptations'>('general');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [skillCommands, setSkillCommands] = useState<SkillCommand[]>([]);
  const [activeResizer, setActiveResizer] = useState<'sidebar' | 'inspector' | null>(null);
  const inspectorTabsRef = useRef(inspectorTabsState);
  inspectorTabsRef.current = inspectorTabsState;
  const subagentFollowRef = useRef({
    seenIds: [] as string[],
    followLive: false,
    focusedId: null as string | null,
    restoreTabId: null as string | null,
    autoCreatedTab: false,
  });
  const clearFollowedSubagent = useCallback(() => {
    subagentFollowRef.current.seenIds = [];
    subagentFollowRef.current.followLive = false;
    subagentFollowRef.current.focusedId = null;
    subagentFollowRef.current.restoreTabId = null;
    subagentFollowRef.current.autoCreatedTab = false;
    const subTab = inspectorTabsRef.current.tabs.find((tab) => tab.kind === 'subagents');
    if (subTab?.selectedSubagentId) {
      dispatchInspectorTabs({ type: 'update', tabId: subTab.id, patch: { selectedSubagentId: null } });
    }
  }, []);
  const [subagentHistory, setSubagentHistory] = useState<SubagentHistory>(() => {
    if (typeof localStorage === 'undefined') return {};
    return parseSubagentHistory(localStorage.getItem(SUBAGENT_HISTORY_STORAGE_KEY));
  });

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleOpenSettingsTab = useCallback((tab: string) => {
    setSettingsTab(tab as any);
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  useEffect(() => {
    const onExtensionNotice = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.message) {
        setToast({ message: detail.message, tone: detail.tone || 'info' });
      }
    };
    window.addEventListener('metis:extension-notify', onExtensionNotice);
    return () => {
      window.removeEventListener('metis:extension-notify', onExtensionNotice);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isConnected) return;
    void (async () => {
      try {
        const result = await request<{ enabled: boolean; unnotifiedCount: number }>('/adaptations');
        if (!result || !result.enabled || !result.unnotifiedCount) return;
        await request('/adaptations/clear-notifications', 'POST').catch(() => null);
      } catch {
        // ignore
      }
    })();
  }, [isConnected, request]);
  const thinkingCaptureMessages: Message[] = captureThinkingState === 'thinking' ? [{
    id: 'capture-thinking-progress',
    role: 'assistant',
    content: '',
    parts: [{
      type: 'thinking',
      id: 'capture-thinking-progress-part',
      thinking: 'I am inspecting the current rendering path.',
    }],
  }] : [{
    id: 'capture-thinking-progress',
    role: 'assistant',
    content: 'Continuing with the task.',
    parts: [{ type: 'text', id: 'capture-working-text', text: 'Continuing with the task.' }],
  }];
  const displayedMessages = capturePlanPoints || captureInspectorTabs ? PLAN_POINTS_CAPTURE_MESSAGES : captureWorkDuration ? WORK_DURATION_CAPTURE_MESSAGES : captureThinkingOverflow ? THINKING_OVERFLOW_CAPTURE_MESSAGES : captureTools ? TOOL_GROUP_CAPTURE_MESSAGES : captureMessageWidth ? MESSAGE_WIDTH_CAPTURE_MESSAGES : captureThinkingProgress ? thinkingCaptureMessages : captureLocalSend ? [{
    id: 'capture-local-user',
    role: 'user' as const,
    content: 'Run this task immediately.',
  }] : capturePlanPreview ? [{
    id: 'capture-plan-preview',
    role: 'assistant' as const,
    thinking: 'I’ll first inspect the existing workflow state and rendering path, then keep the implementation scoped to the active Desktop source.\n\nNext I’ll verify streaming updates and the final collapsed state.',
    content: `<proposed_plan>\n${PLAN_CAPTURE_MARKDOWN}\n</proposed_plan>`,
    parts: [
      {
        type: 'thinking' as const,
        id: 'capture-thinking',
        thinking: 'I’ll first inspect the existing workflow state and rendering path, then keep the implementation scoped to the active Desktop source.\n\nNext I’ll verify streaming updates and the final collapsed state.',
        durationMs: 1700,
      },
      {
        type: 'toolCall' as const,
        id: 'capture-read',
        name: 'read',
        arguments: { path: 'desktop/renderer/message-turns.js', offset: 1, limit: 220 },
        result: {
          content: 'Loaded archived assistant turn and Tool rendering contracts.',
          timestamp: '2026-08-20T10:00:01.000Z',
        },
      },
      {
        type: 'toolCall' as const,
        id: 'capture-agent-kqpvqh',
        name: 'spawn_agent',
        arguments: { agent: 'implementer', task: 'Restore archived Tool rendering', mode: 'async', worktree: 'desktop' },
        progress: { jobId: 'kqpvqh', state: 'completed' as const, durationMs: 3450 },
      },
      {
        type: 'text' as const,
        id: 'capture-plan-text',
        text: `<proposed_plan>\n${PLAN_CAPTURE_MARKDOWN}\n</proposed_plan>`,
      },
    ],
  }] : captureAttachments ? ATTACHMENT_CAPTURE_MESSAGES : messages;
  const displayedProposal = capturePlanPreview ? {
    markdown: PLAN_CAPTURE_MARKDOWN,
    revision: 2,
    updatedAt: '2026-08-20T10:00:00.000Z',
  } : workflowProposal;
  const displayedSidebarAgents = captureConversationIcons ? CONVERSATION_ICON_CAPTURE_AGENTS : agents;
  const displayedSidebarActiveAgentId = captureConversationIcons
    ? CONVERSATION_ICON_CAPTURE_AGENTS[0].id
    : activeAgentId;
  const displayedModels = captureModelSwitcher ? MODEL_SWITCHER_CAPTURE_MODELS : models;
  const displayedActiveModel = captureModelSwitcher ? MODEL_SWITCHER_CAPTURE_MODELS[0] : activeModel;
  const displayedThinkingLevels = captureModelSwitcher ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] : thinkingLevels;
  const displayedThinkingOptions = captureModelSwitcher ? MODEL_SWITCHER_CAPTURE_THINKING_OPTIONS : thinkingOptions;
  const displayedThinkingLevel = captureModelSwitcher ? 'medium' : thinkingLevel;
  const displayedSupportsThinking = captureModelSwitcher || supportsThinking;
  const displayedWorkflowPlan = capturePlanPoints || captureInspectorTabs || captureWorkflowPlan
    ? PLAN_POINTS_CAPTURE
    : capturePlanPointsEmpty
      ? undefined
      : workflowPlan;
  const displayedWorkspacePath = capturePlanPoints || captureInspectorTabs ? PLAN_POINTS_CAPTURE_WORKSPACE : activeProject?.path;
  const previousToolPartsRef = useRef<AssistantContentPart[]>([]);
  const displayedToolParts = useMemo(() => {
    const toolParts: AssistantContentPart[] = [];
    for (const msg of displayedMessages) {
      if (msg.role !== 'assistant' || !msg.parts) continue;
      for (const part of msg.parts) {
        if (part.type === 'toolCall') toolParts.push(part);
      }
    }
    const previous = previousToolPartsRef.current;
    if (
      previous.length === toolParts.length
      && previous.every((part, index) => part === toolParts[index])
    ) {
      return previous;
    }
    previousToolPartsRef.current = toolParts;
    return toolParts;
  }, [displayedMessages]);
  const browserShine = resolveBrowserShineActive({
    hostBusy: browserHostBusy,
    streaming: isStreaming,
    latched: browserShineLatched,
    toolParts: displayedToolParts,
  });
  const browserModelControlled = browserShine.active;
  useEffect(() => {
    setBrowserShineLatched(browserShine.nextLatched);
  }, [browserShine.nextLatched]);
  const isMessagesInSync = Boolean(activeAgentId && messagesSessionId === activeAgentId);
  const currentSubagents = useMemo(
    () => (isMessagesInSync ? collectSubagentItems(messages, activeAgentId) : []),
    [isMessagesInSync, messages, activeAgentId],
  );
  const restoredSubagents = useMemo(
    () => (isMessagesInSync ? mergeSubagentHistoryItems(subagentHistory[activeAgentId] || [], currentSubagents) : []),
    [activeAgentId, currentSubagents, isMessagesInSync, subagentHistory],
  );
  const displayedSubagents = useMemo(() => (
    displayedMessages === messages
      ? restoredSubagents
      : collectSubagentItems(displayedMessages, activeAgentId)
  ), [displayedMessages, messages, restoredSubagents, activeAgentId]);

  const handleStopSubagent = useCallback(async (subagentId: string) => {
    void abortSubagent(subagentId);
    if (!activeAgentId) return;
    setSubagentHistory((current) => {
      const existing = current[activeAgentId] || [];
      const updated = existing.map((item) => {
        if (item.id === subagentId || item.agentId === subagentId) {
          return {
            ...item,
            status: 'failed' as const,
            error: t('subagentStopped') || 'Subagent stopped',
          };
        }
        return item;
      });
      return { ...current, [activeAgentId]: updated };
    });
  }, [abortSubagent, activeAgentId, t]);

  useEffect(() => {
    if (!activeAgentId || !messagesSessionId || messagesSessionId !== activeAgentId) return;
    if (currentSubagents.length === 0) {
      if (subagentHistory[activeAgentId]?.length) {
        setSubagentHistory((current) => {
          if (!current[activeAgentId]?.length) return current;
          const next = { ...current };
          delete next[activeAgentId];
          return next;
        });
      }
      return;
    }
    setSubagentHistory((current) => {
      const existing = current[activeAgentId] || [];
      const merged = mergeSubagentHistoryItems(existing, currentSubagents);
      if (existing.length === merged.length && JSON.stringify(existing) === JSON.stringify(merged)) return current;
      return { ...current, [activeAgentId]: merged };
    });
  }, [activeAgentId, messagesSessionId, currentSubagents, subagentHistory]);

  useEffect(() => {
    const persist = () => {
      try {
        localStorage.setItem(SUBAGENT_HISTORY_STORAGE_KEY, JSON.stringify(subagentHistory));
      } catch (error) {
        console.warn('[desktop] Failed to persist Subagent history:', error);
      }
    };
    const timer = window.setTimeout(persist, 200);
    window.addEventListener('beforeunload', persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeunload', persist);
    };
  }, [subagentHistory]);

  useEffect(() => {
    if (!captureThinkingProgress) return;
    const handleCaptureState = (event: Event) => {
      const nextState = (event as CustomEvent<'thinking' | 'other'>).detail;
      if (nextState === 'thinking' || nextState === 'other') setCaptureThinkingState(nextState);
    };
    window.addEventListener('metis:capture-thinking-state', handleCaptureState);
    return () => window.removeEventListener('metis:capture-thinking-state', handleCaptureState);
  }, [captureThinkingProgress]);

  useEffect(() => {
    if (!isConnected) {
      setSkillCommands([]);
      return;
    }
    let current = true;
    void request<{ commands?: Array<{ name?: string; description?: string; source?: string }> }>('/commands')
      .then((result) => {
        if (!current) return;
        setSkillCommands((result.commands || [])
          .filter((command) => command.source === 'skill' && typeof command.name === 'string' && command.name.startsWith('skill:'))
          .map((command) => ({ name: command.name!.slice('skill:'.length), description: command.description || '' })));
      })
      .catch(() => { if (current) setSkillCommands([]); });
    return () => { current = false; };
  }, [isConnected, request]);

  const [sessionCostStats, setSessionCostStats] = useState<{
    tokenTotal: number;
    costTotal: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    recent5hTokens: number;
    recent7dTokens: number;
    dailyTokens?: Record<string, number>;
    dailyCost?: Record<string, number>;
  }>({
    tokenTotal: 0,
    costTotal: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    recent5hTokens: 0,
    recent7dTokens: 0,
    dailyTokens: {},
    dailyCost: {},
  });

  useEffect(() => {
    if (isStreaming) return;
    const desktop = (window as any).metisDesktop;
    const sessionPaths = agents.map((a) => a.sessionPath).filter(Boolean);
    if (desktop?.sessionTokens?.costActivity && sessionPaths.length > 0) {
      desktop.sessionTokens.costActivity(sessionPaths).then((stats: any) => {
        if (!stats) return;
        setSessionCostStats((current) => (
          current.tokenTotal === stats.tokenTotal
          && current.costTotal === stats.costTotal
          && current.recent5hTokens === stats.recent5hTokens
          && current.recent7dTokens === stats.recent7dTokens
            ? current
            : stats
        ));
      }).catch(() => {});
    }
  }, [agents, isStreaming]);

  const liveUsage = useMemo(() => {
    let cost = 0;
    let input = 0;
    let output = 0;
    let cache = 0;
    let total = 0;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.usage) {
        cost += msg.usage.cost || 0;
        input += msg.usage.input || 0;
        output += msg.usage.output || 0;
        cache += (msg.usage.cacheRead || 0) + (msg.usage.cacheWrite || 0);
        total += msg.usage.totalTokens || ((msg.usage.input || 0) + (msg.usage.output || 0) + (msg.usage.cacheRead || 0) + (msg.usage.cacheWrite || 0));
      }
    }
    return { cost, input, output, cache, total };
  }, [messages]);

  const aggregateCost = Math.max(sessionCostStats.costTotal, liveUsage.cost);
  const aggregateTotalTokens = Math.max(sessionCostStats.tokenTotal, liveUsage.total);

  const isOAuthModel = useMemo(() => {
    if (!displayedActiveModel?.provider) return false;
    const catalogEntry = providerCatalog.find((p) => p.id === displayedActiveModel.provider);
    if (catalogEntry?.authMethods) {
      return catalogEntry.authMethods.includes('oauth') && !catalogEntry.authMethods.includes('api_key');
    }
    return false;
  }, [displayedActiveModel, providerCatalog]);

  const quota5h = useMemo(() => {
    const used = sessionCostStats.recent5hTokens || 0;
    const limit = 200_000;
    const percent = Math.min((used / limit) * 100, 100);
    return { percent, used, limit, resetsIn: '4h 15m' };
  }, [sessionCostStats.recent5hTokens]);

  const quota7d = useMemo(() => {
    const used = sessionCostStats.recent7dTokens || 0;
    const limit = 1_000_000;
    const percent = Math.min((used / limit) * 100, 100);
    return { percent, used, limit, resetsIn: '5d' };
  }, [sessionCostStats.recent7dTokens]);

  const isDraggingRef = useRef<'sidebar' | 'inspector' | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Restore project grouping, then make the Electron workspace authoritative.
  useEffect(() => {
    const desktop = (window as any).metisDesktop;
    let storedProjects: ProjectItem[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || '[]');
      if (Array.isArray(parsed)) {
        storedProjects = parsed.filter((project) =>
          project && typeof project.name === 'string' && typeof project.path === 'string'
        ).map((project) => ({ ...project, id: project.path }));
      }
    } catch {}

    const restore = async () => {
      try {
        const isRemote = Boolean(await desktop?.workspace?.isRemote?.());
        setIsRemoteServer(isRemote);
        const workspace = await desktop?.workspace?.get?.();
        const isAppPath = (p?: string) => {
          if (!p) return true;
          const norm = p.replace(/\\/g, '/');
          return norm.includes('/Metis.app') || norm.includes('app.asar');
        };
        const current = workspace?.path && !isAppPath(workspace.path)
          ? {
              id: workspace.path,
              name: workspace.name || workspace.path.split(/[/\\]/).filter(Boolean).pop() || 'Project',
              path: workspace.path,
              isRemote: Boolean(workspace.isRemote || isRemote),
            }
          : undefined;
        const merged = storedProjects.length > 0
          ? (current && !storedProjects.some((project) => pathsEqual(project.path, current.path))
              ? [...storedProjects, current]
              : storedProjects.map((p) => (current && pathsEqual(p.path, current.path) ? { ...p, isRemote: Boolean(current.isRemote || p.isRemote) } : p)))
          : (current ? [current] : []);
        const storedActive = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
        let nextActive: ProjectItem | undefined;
        if (isRemote) {
          const storedRemote = merged.find((project) => (project.id === storedActive || pathsEqual(project.path, storedActive || '')) && project.isRemote);
          nextActive = current || storedRemote || merged.find((p) => p.isRemote) || merged[0];
        } else {
          nextActive = merged.find((project) => project.id === storedActive || pathsEqual(project.path, storedActive || '')) || current || merged[0];
        }
        setProjects(merged);
        setActiveProjectId(nextActive?.id || '');
      } catch (error) {
        console.warn('[desktop] Failed to restore projects:', error);
        setProjects(storedProjects);
        setActiveProjectId(storedProjects[0]?.id || '');
      } finally {
        setProjectsReady(true);
      }
    };
    void restore();
  }, []);

  useEffect(() => {
    if (!projectsReady) return;
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
  }, [activeProjectId, projects, projectsReady]);

  useEffect(() => {
    saveArchivedSessions(archivedSessions);
  }, [archivedSessions]);

  const archivedIds = useMemo(() => archivedSessionIdSet(archivedSessions), [archivedSessions]);
  const archivedSessionList = useMemo(() => listArchivedSessions(archivedSessions), [archivedSessions]);

  const handleArchiveAgent = useCallback(async (agent: Agent) => {
    if (!agent.sessionPath) return;
    let nextArchived: ArchivedSessionsMap = {};
    setArchivedSessions((current) => {
      nextArchived = archiveSession(current, {
        id: agent.id,
        name: agent.name,
        sessionPath: agent.sessionPath!,
        projectPath: agent.projectPath,
      });
      return nextArchived;
    });
    if (agent.id !== activeAgentId) return;

    const projectPath = agent.projectPath || activeProject?.path;
    const pool = (projectPath && projectAgentsByPath[projectPath])
      || agents.filter((item) => !item.projectPath || item.projectPath === projectPath);
    const visibleNext = pool.find((item) => item.id !== agent.id && !nextArchived[item.id]);
    if (visibleNext) {
      await selectConversation(visibleNext.id);
      return;
    }
    await newConversation();
  }, [activeAgentId, activeProject?.path, agents, newConversation, projectAgentsByPath, selectConversation]);

  const handleRestoreArchivedSession = useCallback((sessionId: string) => {
    setArchivedSessions((current) => unarchiveSession(current, sessionId));
  }, []);

  const handleDeleteArchivedSession = useCallback(async (sessionId: string) => {
    const record = archivedSessions[sessionId];
    if (!record) return;
    if (sessionId === activeAgentId || record.sessionPath === activeAgent?.sessionPath) {
      throw new Error('Cannot permanently delete the active conversation. Restore it or switch away first.');
    }
    await request('/session', 'DELETE', { sessionPath: record.sessionPath });
    setArchivedSessions((current) => unarchiveSession(current, sessionId));
    removeConversation(sessionId);
  }, [activeAgent?.sessionPath, activeAgentId, archivedSessions, removeConversation, request]);

  const handleSelectProject = useCallback((id: string) => {
    const apply = () => {
      setIsRoutinesViewActive(false);
      const targetProj = projects.find((p) => p.id === id);
      if (!targetProj || targetProj.id === activeProjectId) return;
      setActiveProjectId(id);
      void selectProject(targetProj);
      const desktop = (window as any).metisDesktop;
      if (desktop?.workspace?.set && targetProj?.path) {
        void desktop.workspace.set(targetProj.path).catch((err: unknown) => {
          console.warn('[desktop] Failed to set workspace:', err);
        });
      }
    };
    if (!isHarnessOpenRef.current || id === activeProjectId) {
      apply();
      return;
    }
    runIfHarnessAllows(apply);
  }, [activeProjectId, projects, runIfHarnessAllows, selectProject]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const handleAbortTurn = useCallback(() => {
    void abortTurn();
  }, [abortTurn]);

  const handleSelectAgent = useCallback(async (agentId: string) => {
    runIfHarnessAllows(() => {
      setIsRoutinesViewActive(false);
      setIsCodeTreeOpen(false);
      setIsHarnessOpen(false);
      clearFollowedSubagent();
      const switching = selectConversation(agentId);
      let ownerPath: string | undefined;
      for (const [path, list] of Object.entries(projectAgentsByPath)) {
        if (list.some((agent) => agent.id === agentId)) {
          ownerPath = path;
          break;
        }
      }
      if (!ownerPath) {
        ownerPath = agents.find((agent) => agent.id === agentId)?.projectPath;
      }
      if (ownerPath && !pathsEqual(ownerPath, activeProject?.path)) {
        const ownerProject = projects.find((project) => pathsEqual(project.path, ownerPath));
        if (ownerProject) {
          setActiveProjectId(ownerProject.id);
          const desktop = (window as any).metisDesktop;
          if (desktop?.workspace?.set) {
            void desktop.workspace.set(ownerProject.path).catch((err: unknown) => {
              console.warn('[desktop] Failed to set workspace:', err);
            });
          }
        }
      }
      void switching;
    });
  }, [activeProject?.path, agents, clearFollowedSubagent, projectAgentsByPath, projects, runIfHarnessAllows, selectConversation]);

  const handleSelectRemotePath = useCallback(async (remotePath: string) => {
    const desktop = (window as any).metisDesktop;
    const name = remotePath.split(/[/\\]/).filter(Boolean).pop() || 'Project';
    const project: ProjectItem = {
      id: remotePath,
      name,
      path: remotePath,
      isRemote: true,
    };
    setProjects((current) => [project, ...current.filter((item) => !pathsEqual(item.path, project.path))]);
    if (desktop?.workspace?.set) {
      await desktop.workspace.set(project.path).catch((err: unknown) => {
        console.warn('[desktop] Failed to set remote workspace:', err);
      });
    }
    setActiveProjectId(project.id);
    void selectProject(project);
  }, [selectProject]);

  const connectServer = useCallback(async (options: { baseUrl: string; username: string; password?: string }) => {
    const ok = await baseConnectServer(options);
    if (!ok) return false;
    const desktop = (window as any).metisDesktop;
    try {
      const isRemote = Boolean(await desktop?.workspace?.isRemote?.());
      setIsRemoteServer(isRemote);
      const workspace = await desktop?.workspace?.get?.();
      if (workspace?.path) {
        const project: ProjectItem = {
          id: workspace.path,
          name: workspace.name || workspace.path.split(/[/\\]/).filter(Boolean).pop() || 'Project',
          path: workspace.path,
          isRemote,
        };
        setProjects((current) => {
          const exists = current.some((p) => pathsEqual(p.path, project.path));
          if (exists) {
            return current.map((p) => (pathsEqual(p.path, project.path) ? { ...p, isRemote } : p));
          }
          return [project, ...current];
        });
        setActiveProjectId(project.id);
        void selectProject(project);
      }
    } catch (err) {
      console.warn('[desktop] Failed to sync workspace after connecting server:', err);
    }
    return true;
  }, [baseConnectServer, selectProject]);

  const handleAddProject = async () => {
    if (isRemoteServer) {
      setIsRemoteModalOpen(true);
      return;
    }
    const desktop = (window as any).metisDesktop;
    if (!desktop?.workspace) return;
    try {
      const selected = desktop.workspace.selectMany
        ? await desktop.workspace.selectMany()
        : desktop.workspace.select
          ? [await desktop.workspace.select()].filter(Boolean)
          : [];
      if (selected.length === 0) return;
      const additions: ProjectItem[] = selected.map((workspace: { name?: string; path: string }) => ({
        id: workspace.path,
        name: workspace.name || workspace.path.split(/[/\\]/).filter(Boolean).pop() || 'Project',
        path: workspace.path,
      }));
      setProjects((current) => [
        ...current,
        ...additions.filter((addition) => !current.some((project) => pathsEqual(project.path, addition.path))),
      ]);
      const nextProject = additions[0];
      await desktop.workspace.set?.(nextProject.path);
      setActiveProjectId(nextProject.id);
      void selectProject(nextProject);
    } catch (err) {
      console.warn('[desktop] Failed to select workspace folder:', err);
    }
  };

  const handleChangeWorkspace = async () => {
    if (isRemoteServer) {
      setIsRemoteModalOpen(true);
      return true;
    }
    const desktop = (window as any).metisDesktop;
    if (!desktop?.workspace?.select) return false;
    try {
      const workspace = await desktop.workspace.select();
      if (!workspace?.path) return false;
      const project: ProjectItem = {
        id: workspace.path,
        name: workspace.name || workspace.path.split(/[/\\]/).filter(Boolean).pop() || 'Project',
        path: workspace.path,
      };
      setProjects((current) => [project, ...current.filter((item) => !pathsEqual(item.path, project.path))]);
      await desktop.workspace.set?.(project.path);
      setActiveProjectId(project.id);
      void selectProject(project);
      return true;
    } catch (error) {
      console.warn('[desktop] Failed to change workspace:', error);
      return false;
    }
  };

  const handleOnboardingProject = async (workspace: { name?: string; path: string }) => {
    const project: ProjectItem = {
      id: workspace.path,
      name: workspace.name || workspace.path.split(/[/\\]/).filter(Boolean).pop() || 'Project',
      path: workspace.path,
    };
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.set) {
      await desktop.workspace.set(project.path).catch((err: unknown) => {
        console.warn('[desktop] Failed to set workspace:', err);
      });
    }
    setProjects((current) => {
      const filtered = current.filter((item) => {
        const norm = item.path.replace(/\\/g, '/');
        return !norm.includes('/Metis.app') && !norm.includes('app.asar') && !pathsEqual(item.path, project.path);
      });
      return [project, ...filtered];
    });
    setActiveProjectId(project.id);
    void selectProject(project);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      if (isConnected && !isLoadingSessions) void newConversation();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isConnected, isLoadingSessions, newConversation]);

  const sidebarRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const currentDragWidthRef = useRef<number>(0);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = 'sidebar';
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    currentDragWidthRef.current = sidebarWidth;
    setActiveResizer('sidebar');
  }, [sidebarWidth]);

  const handleInspectorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = 'inspector';
    startXRef.current = e.clientX;
    startWidthRef.current = inspectorWidth;
    currentDragWidthRef.current = inspectorWidth;
    setActiveResizer('inspector');
  }, [inspectorWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      if (isDraggingRef.current === 'sidebar') {
        const deltaX = e.clientX - startXRef.current;
        const newWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidthRef.current + deltaX)
        );
        currentDragWidthRef.current = newWidth;
        if (sidebarRef.current) {
          sidebarRef.current.style.width = `${newWidth}px`;
        }
      } else if (isDraggingRef.current === 'inspector') {
        const deltaX = startXRef.current - e.clientX;
        const newWidth = Math.min(
          MAX_INSPECTOR_WIDTH,
          Math.max(MIN_INSPECTOR_WIDTH, startWidthRef.current + deltaX)
        );
        currentDragWidthRef.current = newWidth;
        if (inspectorRef.current) {
          inspectorRef.current.style.width = `${newWidth}px`;
        }
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        if (isDraggingRef.current === 'sidebar' && currentDragWidthRef.current) {
          setSidebarWidth(currentDragWidthRef.current);
        } else if (isDraggingRef.current === 'inspector' && currentDragWidthRef.current) {
          setInspectorWidth(currentDragWidthRef.current);
        }
        isDraggingRef.current = null;
        currentDragWidthRef.current = 0;
        setActiveResizer(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleNewChat = useCallback(() => {
    runIfHarnessAllows(() => {
      setIsRoutinesViewActive(false);
      setIsCodeTreeOpen(false);
      setIsHarnessOpen(false);
      clearFollowedSubagent();
      void newConversation();
    });
  }, [clearFollowedSubagent, newConversation, runIfHarnessAllows]);

  const handleOpenRoutines = useCallback(() => {
    runIfHarnessAllows(() => {
      setIsCodeTreeOpen(false);
      setIsHarnessOpen(false);
      setIsRoutinesViewActive(true);
    });
  }, [runIfHarnessAllows]);

  const handleCloseRoutines = useCallback(() => {
    setIsRoutinesViewActive(false);
  }, []);

  const handleToggleCodeTree = useCallback(() => {
    runIfHarnessAllows(() => {
      setIsRoutinesViewActive(false);
      setIsHarnessOpen(false);
      setIsCodeTreeOpen((prev) => !prev);
    });
  }, [runIfHarnessAllows]);

  const handleCloseCodeTree = useCallback(() => {
    setIsCodeTreeOpen(false);
  }, []);

  const handleToggleHarness = useCallback(() => {
    if (isHarnessOpenRef.current) {
      runIfHarnessAllows(() => setIsHarnessOpen(false));
      return;
    }
    setIsRoutinesViewActive(false);
    setIsCodeTreeOpen(false);
    setIsHarnessOpen(true);
  }, [runIfHarnessAllows]);

  const handleCloseHarness = useCallback(() => {
    runIfHarnessAllows(() => setIsHarnessOpen(false));
  }, [runIfHarnessAllows]);

  const handleSelectFileFromTree = useCallback((relativePath: string, hasGitChanges: boolean) => {
    setTreeActiveFilePath(relativePath);
    if (hasGitChanges) {
      dispatchInspectorTabs({
        type: 'openOrActivate',
        kind: 'files',
      });
    }
  }, []);

  const handleJumpToRoutineSession = useCallback(async (sessionId: string, projectPath?: string) => {
    setIsRoutinesViewActive(false);
    if (projectPath && (!activeProject || !pathsEqual(projectPath, activeProject.path))) {
      const targetProject = projects.find((p) => pathsEqual(p.path, projectPath));
      if (targetProject) {
        setActiveProjectId(targetProject.id);
        const desktop = (window as any).metisDesktop;
        if (desktop?.workspace?.set) {
          void desktop.workspace.set(targetProject.path).catch((err: unknown) => {
            console.warn('[desktop] Failed to set workspace:', err);
          });
        }
        await selectProject(targetProject);
      }
    } else {
      await refresh();
    }
    await handleSelectAgent(sessionId);
  }, [activeProject, handleSelectAgent, projects, refresh, selectProject]);

  const handleOpenInspectorTab = useCallback((kind: InspectorTabKind) => {
    dispatchInspectorTabs({ type: 'open', kind });
  }, []);

  const handleToggleWideInspector = useCallback(() => {
    setInspectorWidth((prev) => {
      const next = prev >= 650 ? 380 : 750;
      if (inspectorRef.current) {
        inspectorRef.current.style.width = `${next}px`;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleOpenBrowser = (event: Event) => {
      const customEvent = event as CustomEvent<{ url?: string; newTab?: boolean }>;
      const url = customEvent.detail?.url;
      if (customEvent.detail?.newTab) {
        dispatchInspectorTabs({ type: 'open', kind: 'browser', browserUrl: url });
      } else {
        dispatchInspectorTabs({ type: 'openOrActivate', kind: 'browser', browserUrl: url });
      }
    };
    window.addEventListener('metis:open-browser', handleOpenBrowser);
    return () => window.removeEventListener('metis:open-browser', handleOpenBrowser);
  }, []);

  useEffect(() => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.browser?.onEnsureTab) return;
    const offEnsure = desktop.browser.onEnsureTab((payload: {
      url?: string;
      newTab?: boolean;
      tabId?: string;
    }) => {
      if (payload?.tabId) {
        dispatchInspectorTabs({ type: 'activate', tabId: payload.tabId });
        if (payload.url) {
          dispatchInspectorTabs({
            type: 'update',
            tabId: payload.tabId,
            patch: { browserUrl: payload.url, browserIsLoading: true },
          });
        }
        return;
      }
      if (payload?.newTab) {
        dispatchInspectorTabs({ type: 'open', kind: 'browser', browserUrl: payload.url || '' });
        return;
      }
      dispatchInspectorTabs({
        type: 'openOrActivate',
        kind: 'browser',
        browserUrl: payload?.url || '',
      });
    });
    const offSelect = desktop.browser.onSelectTab?.((payload: { tabId?: string }) => {
      if (!payload?.tabId) return;
      dispatchInspectorTabs({ type: 'activate', tabId: payload.tabId });
    });
    const offBusy = desktop.browser.onBusy?.((payload: { busy?: boolean }) => {
      setBrowserHostBusy(Boolean(payload?.busy));
    });
    return () => {
      offEnsure?.();
      offSelect?.();
      offBusy?.();
    };
  }, []);

  const openInspectorPlan = useCallback((markdown?: string) => {
    dispatchInspectorTabs({
      type: 'openOrActivate',
      kind: 'plan',
      viewedProposalMarkdown: markdown ?? null,
      viewedProposalSessionId: activeAgentId || messagesSessionId || null,
    });
  }, [activeAgentId, messagesSessionId]);

  const openSubagentInInspector = useCallback((id: string, followLive: boolean) => {
    const tabsState = inspectorTabsRef.current;
    const existing = tabsState.tabs.find((tab) => tab.kind === 'subagents');
    const alreadyShowingDetail = Boolean(
      existing && tabsState.activeTabId === existing.id && existing.selectedSubagentId,
    );
    const follow = subagentFollowRef.current;
    if (!alreadyShowingDetail) {
      follow.restoreTabId = tabsState.activeTabId;
      follow.autoCreatedTab = !existing;
    }
    follow.followLive = followLive;
    follow.focusedId = id;
    dispatchInspectorTabs({ type: 'openSubagentDetail', selectedSubagentId: id });
  }, []);

  const closeSubagentInspector = useCallback(() => {
    const follow = subagentFollowRef.current;
    const tabsState = inspectorTabsRef.current;
    const subTab = tabsState.tabs.find((tab) => tab.kind === 'subagents');
    follow.followLive = false;
    follow.focusedId = null;
    if (!subTab) return;
    if (follow.autoCreatedTab) {
      dispatchInspectorTabs({ type: 'close', tabId: subTab.id });
      if (follow.restoreTabId && follow.restoreTabId !== subTab.id) {
        dispatchInspectorTabs({ type: 'activate', tabId: follow.restoreTabId });
      }
    } else if (subTab.selectedSubagentId) {
      dispatchInspectorTabs({ type: 'update', tabId: subTab.id, patch: { selectedSubagentId: null } });
      if (follow.restoreTabId && follow.restoreTabId !== subTab.id && tabsState.activeTabId === subTab.id) {
        dispatchInspectorTabs({ type: 'activate', tabId: follow.restoreTabId });
      }
    }
    follow.autoCreatedTab = false;
  }, []);

  const handleOpenSubagent = useCallback((partId: string) => {
    const follow = subagentFollowRef.current;
    if (!follow.seenIds.includes(partId)) follow.seenIds = [...follow.seenIds, partId];
    const item = findSubagentById(displayedSubagents, partId);
    openSubagentInInspector(partId, item?.status === 'running');
  }, [displayedSubagents, openSubagentInInspector]);

  useEffect(() => {
    clearFollowedSubagent();
  }, [activeAgentId, clearFollowedSubagent]);

  useEffect(() => {
    if (skipSubagentFollow) return;
    const follow = subagentFollowRef.current;
    const decision = decideSubagentFollow(displayedSubagents, {
      seenIds: new Set(follow.seenIds),
      followLive: follow.followLive,
      focusedId: follow.focusedId,
    });
    follow.seenIds = decision.seenIds;
    if (decision.type === 'open') openSubagentInInspector(decision.id, true);
    else if (decision.type === 'close') closeSubagentInspector();
  }, [activeAgentId, closeSubagentInspector, displayedSubagents, openSubagentInInspector, skipSubagentFollow]);

  useEffect(() => {
    if (capturePlanPreview || capturePlanPoints || capturePlanPointsEmpty || captureInspectorTabs || captureWorkflowPlan) return;
    dispatchInspectorTabs({ type: 'clearPlanViews' });
  }, [activeAgentId, captureInspectorTabs, capturePlanPoints, capturePlanPointsEmpty, capturePlanPreview, captureWorkflowPlan]);

  const handleActivateInspectorTab = useCallback((tabId: string) => {
    const subTab = inspectorTabsRef.current.tabs.find((tab) => tab.kind === 'subagents');
    if (!subTab || tabId !== subTab.id) {
      subagentFollowRef.current.followLive = false;
    }
    dispatchInspectorTabs({ type: 'activate', tabId });
  }, []);

  const handleCloseInspectorTab = useCallback((tabId: string) => {
    const subTab = inspectorTabsRef.current.tabs.find((tab) => tab.kind === 'subagents');
    if (subTab && tabId === subTab.id) {
      subagentFollowRef.current.followLive = false;
      subagentFollowRef.current.focusedId = null;
      subagentFollowRef.current.autoCreatedTab = false;
    }
    dispatchInspectorTabs({ type: 'close', tabId });
  }, []);

  const handleMoveInspectorTab = useCallback((tabId: string, toIndex: number) => {
    dispatchInspectorTabs({ type: 'move', tabId, toIndex });
  }, []);

  const handleUpdateInspectorTab = useCallback((
    tabId: string,
    patch: Partial<InspectorTab>,
  ) => {
    dispatchInspectorTabs({ type: 'update', tabId, patch });
  }, []);

  return (
    <div
      className={`flex h-screen w-screen bg-transparent text-ink select-none overflow-hidden ${
        activeResizer ? 'cursor-col-resize select-none' : ''
      }`}
      data-onboarding-tour-stage={onboardingTransitionActive ? transitionStage : undefined}
    >
      {/* 1. Left Sidebar Panel */}
      <div className={isSidebarOpen ? 'contents' : 'hidden'} aria-hidden={!isSidebarOpen || undefined} data-sidebar-shell="">
          <Sidebar
            ref={sidebarRef}
            width={sidebarWidth}
            agents={displayedSidebarAgents}
            agentsByProject={captureConversationIcons ? undefined : projectAgentsByPath}
            activeAgentId={displayedSidebarActiveAgentId}
            projects={projects}
            activeProjectId={activeProjectId}
            isLoading={captureConversationIcons ? false : isLoadingSessions}
            error={captureConversationIcons ? undefined : sessionError}
            updateCheck={updateCheck}
            archivedSessionIds={archivedIds}
            onSelectAgent={handleSelectAgent}
            onSelectProject={handleSelectProject}
            onPrefetchProjectSessions={captureConversationIcons ? undefined : prefetchProjectSessions}
            onAddProject={handleAddProject}
            onNewChat={handleNewChat}
            isRoutinesOpen={isRoutinesViewActive}
            onOpenRoutines={handleOpenRoutines}
            isCodeTreeOpen={isCodeTreeOpen}
            onToggleCodeTree={handleToggleCodeTree}
            isHarnessOpen={isHarnessOpen}
            onToggleHarness={handleToggleHarness}
            onSelectFileFromTree={handleSelectFileFromTree}
            activeFilePath={treeActiveFilePath}
            onArchiveAgent={captureConversationIcons ? undefined : handleArchiveAgent}
            onOpenSettings={handleOpenSettings}
            onToggleSidebar={handleCloseSidebar}
            workingAgentIds={
              captureConversationIcons
                ? undefined
                : workingSessionIds
            }
          />

          {/* Resizer Handle for Sidebar */}
          <div
            onMouseDown={handleSidebarResizeStart}
            className="relative w-px h-full cursor-col-resize z-30 bg-line-strong hover:bg-accent/40 active:bg-accent transition-colors flex-shrink-0 before:absolute before:inset-y-0 before:left-1/2 before:w-[8px] before:-translate-x-1/2 before:content-['']"
            title="Drag to resize sidebar"
            data-sidebar-resizer=""
          />
      </div>

      {/* 2. Center Main Workspace Area: Routines Manager, Code Tree, or Chat Area */}
      {isRoutinesViewActive ? (
        <RoutinesManager
          projects={projects}
          activeProjectPath={activeProject?.path}
          onClose={handleCloseRoutines}
          onSelectSession={handleJumpToRoutineSession}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onNewChat={handleNewChat}
        />
      ) : isCodeTreeOpen ? (
        <CodeTreeManager
          projects={projects}
          activeProjectId={activeProjectId}
          activeProjectPath={activeProject?.path}
          onSelectProject={handleSelectProject}
          onClose={handleCloseCodeTree}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onNewChat={handleNewChat}
          onSelectFile={handleSelectFileFromTree}
        />
      ) : isHarnessOpen ? (
        <HarnessEditor
          projects={projects}
          activeProjectId={activeProjectId}
          activeProjectPath={activeProject?.path}
          onSelectProject={handleSelectProject}
          onClose={handleCloseHarness}
          registerLeaveGuard={registerHarnessLeaveGuard}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onNewChat={handleNewChat}
          availableModels={models}
        />
      ) : (
      <ChatArea
        agent={activeAgent}
        messages={displayedMessages}
        workspacePath={displayedWorkspacePath}
        projectName={activeProject?.name}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={handleSelectProject}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        onNewChat={handleNewChat}
        onSendMessage={captureSettledSend
          ? async () => true
          : captureLocalSend
            ? () => new Promise<boolean | void>(() => {})
            : sendMessage}
        onAbort={handleAbortTurn}
        models={displayedModels}
        activeModel={displayedActiveModel}
        onSelectModel={selectModel}
        isChangingModel={isChangingModel}
        thinkingLevel={displayedThinkingLevel}
        thinkingLevels={displayedThinkingLevels}
        thinkingOptions={displayedThinkingOptions}
        supportsThinking={displayedSupportsThinking}
        onSelectThinkingLevel={selectThinkingLevel}
        isChangingThinking={isChangingThinking}
        collaborationMode={captureWorkflowPlan ? 'build' : collaborationMode}
        onSelectCollaborationMode={selectCollaborationMode}
        isChangingCollaborationMode={isChangingCollaborationMode}
        skills={captureSkills ? SKILL_PICKER_CAPTURE_SKILLS : skillCommands}
        isCompacting={isCompacting}
        isStreaming={captureWorkflowPlan || captureTools || captureThinkingProgress || captureStreamingWork ? true : capturePlanPreview ? false : isStreaming}
        isLoading={captureMessageWidth || captureThinkingProgress || capturePlanPreview || captureWorkflowPlan || captureLocalSend || captureSettledSend ? false : isLoadingMessages}
        workflowProposal={displayedProposal}
        workflowPlan={displayedWorkflowPlan}
        onOpenPlan={openInspectorPlan}
        pendingUserInput={captureAsk ? ASK_CAPTURE : pendingUserInput}
        onRespondToUserInput={captureAsk ? async () => true : respondToUserInput}
        contextUsage={contextUsage}
        tokenBreakdown={tokenBreakdown}
        isOAuth={isOAuthModel}
        totalCost={aggregateCost}
        totalTokens={aggregateTotalTokens}
        quota5h={quota5h}
        quota7d={quota7d}
        onOpenSubagent={handleOpenSubagent}
        learningProgress={learningProgress}
        onOpenSettingsTab={handleOpenSettingsTab}
        onDismissLearningProgress={dismissLearningProgress}
      />
      )}

      {/* 3. Right Inspector Panel */}
      <div
        className={isRoutinesViewActive || isCodeTreeOpen || isHarnessOpen ? 'hidden' : 'contents'}
        aria-hidden={isRoutinesViewActive || isCodeTreeOpen || isHarnessOpen || undefined}
        data-inspector-shell=""
      >
          {/* Resizer Handle for Inspector */}
          <div
            onMouseDown={handleInspectorResizeStart}
            className="relative w-px h-full cursor-col-resize z-30 bg-line-strong hover:bg-accent/40 active:bg-accent transition-colors flex-shrink-0 before:absolute before:inset-y-0 before:left-1/2 before:w-[8px] before:-translate-x-1/2 before:content-['']"
            title="Drag to resize inspector"
            data-inspector-resizer=""
          />

          <Inspector
            ref={inspectorRef}
            width={inspectorWidth}
            tabs={inspectorTabsState.tabs}
            activeTabId={inspectorTabsState.activeTabId}
            workflowPlan={displayedWorkflowPlan}
            workflowProposal={displayedProposal}
            planActionsEnabled={capturePlanPreview || (isConnected && collaborationMode === 'plan' && !isStreaming && !isCompacting)}
            onProcessProposal={capturePlanPreview || collaborationMode === 'plan' ? processProposal : undefined}
            onRefineProposal={capturePlanPreview || collaborationMode === 'plan' ? refineProposal : undefined}
            toolParts={displayedToolParts}
            workspacePath={displayedWorkspacePath}
            subagents={displayedSubagents}
            onOpenTab={handleOpenInspectorTab}
            onActivateTab={handleActivateInspectorTab}
            onCloseTab={handleCloseInspectorTab}
            onMoveTab={handleMoveInspectorTab}
            onUpdateTab={handleUpdateInspectorTab}
            onOpenSubagent={handleOpenSubagent}
            onStopSubagent={handleStopSubagent}
            collaborationMode={collaborationMode}
            model={activeModel}
            activeSessionId={activeAgentId || messagesSessionId || null}
            onToggleWideWidth={handleToggleWideInspector}
            isWideWidth={inspectorWidth >= 650}
            browserModelControlled={browserModelControlled}
          />
      </div>
      <SettingsDialog
        open={isSettingsOpen}
        initialTab={settingsTab}
        onClose={handleCloseSettings}
        request={request}
        refresh={refresh}
        onConnectServer={connectServer}
        isConnected={isConnected}
        isBusy={isStreaming || isCompacting || isLoadingSessions || isLoadingMessages}
        models={models}
        providerCatalog={providerCatalog}
        activeModel={activeModel}
        thinkingLevel={thinkingLevel}
        thinkingLevels={thinkingLevels}
        thinkingOptions={thinkingOptions}
        supportsThinking={supportsThinking}
        collaborationMode={collaborationMode}
        activeProject={activeProject}
        updateCheck={updateCheck}
        onCheckForUpdates={checkForUpdates}
        onChangeWorkspace={handleChangeWorkspace}
        onOpenOnboarding={() => { setIsSettingsOpen(false); setIsOnboardingOpen(true); }}
        onSelectModel={selectModel}
        onSelectThinkingLevel={selectThinkingLevel}
        onSelectCollaborationMode={selectCollaborationMode}
        onNewSession={newConversation}
        archivedSessions={archivedSessionList}
        onRestoreArchivedSession={handleRestoreArchivedSession}
        onDeleteArchivedSession={handleDeleteArchivedSession}
      />
      <RemotePathModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        onSelect={handleSelectRemotePath}
        initialPath={activeProject?.path}
      />
      <Onboarding
        open={isOnboardingOpen}
        request={request}
        isConnected={isConnected}
        models={models}
        onComplete={(rect) => {
          setIsOnboardingOpen(false);
          handleNewChat();
          if (rect) {
            setOnboardingSourceRect(rect);
            setTransitionStage('flying');
            setOnboardingTransitionActive(true);
          }
        }}
        onProjectReady={handleOnboardingProject}
        onSelectModel={selectModel}
        onRefreshModels={refreshModels}
      />
      <OnboardingTransition
        active={onboardingTransitionActive}
        sourceRect={onboardingSourceRect}
        sidebarWidth={sidebarWidth}
        inspectorWidth={inspectorWidth}
        onStageChange={setTransitionStage}
        onNewChat={handleNewChat}
        onFinish={() => {
          setOnboardingTransitionActive(false);
          setOnboardingSourceRect(null);
          setTransitionStage('idle');
        }}
      />
      <ExtensionUiDialog
        request={captureExtensionUi ? EXTENSION_UI_CAPTURE_REQUEST : extensionUiRequest}
        busy={isRespondingToExtensionUi}
        onRespond={captureExtensionUi ? async () => true : respondToExtensionUi}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[200] max-w-md rounded-window border px-4 py-3 text-[12.5px] font-medium shadow-overlay transition-[opacity,transform] duration-300 animate-in fade-in slide-in-from-bottom-4 ${
            toast.tone === 'success'
              ? 'border-green/30 bg-green-tint text-green'
              : toast.tone === 'error'
                ? 'border-red/30 bg-red-tint text-red'
                : 'border-line bg-surface/95 text-ink'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-green" />
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded-chip p-1 text-ink-3 hover:bg-hover hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
