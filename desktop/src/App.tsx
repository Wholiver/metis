import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { Inspector } from './components/inspector/Inspector';
import { collectTurnFileChanges } from './lib/turn-files';
import {
  collectSubagentItems,
  mergeSubagentHistoryItems,
  parseSubagentHistory,
  SUBAGENT_HISTORY_STORAGE_KEY,
  type SubagentHistory,
} from './lib/subagents';
import { useMetisServer } from './hooks/useMetisServer';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { Onboarding, shouldShowOnboarding } from './components/onboarding/Onboarding';
import { SkillCommand } from './components/chat/SkillPicker';
import { Agent, Message, ModelOption, PendingUserInput, ProjectItem, WorkflowPlanState } from './types';

const PROJECTS_STORAGE_KEY = 'metis.desktop.projects.v1';
const ACTIVE_PROJECT_STORAGE_KEY = 'metis.desktop.activeProject.v1';

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 500;

const MIN_INSPECTOR_WIDTH = 300;
const MAX_INSPECTOR_WIDTH = 550;

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
    { type: 'toolCall', id: 'capture-tool-memory', name: 'query_memory_db', arguments: { query: 'desktop tool rendering' }, result: { content: 'Found relevant session memory.' } },
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

export function App() {
  const captureParams = new URLSearchParams(window.location.search);
  const capturePlanPreview = captureParams.has('capture-plan-preview');
  const captureStreamingWork = captureParams.has('capture-streaming-work');
  const captureConversationIcons = captureParams.has('capture-conversation-icons');
  const captureModelSwitcher = captureParams.has('capture-model-switcher');
  const captureAttachments = captureParams.has('capture-attachments');
  const captureLocalSend = captureParams.has('capture-local-send');
  const captureThinkingProgress = captureParams.has('capture-thinking-progress');
  const captureMessageWidth = captureParams.has('capture-message-width');
  const captureTools = captureParams.has('capture-tools');
  const captureWorkDuration = captureParams.has('capture-work-duration');
  const captureThinkingOverflow = captureParams.has('capture-thinking-overflow');
  const capturePlanPoints = captureParams.has('capture-plan-points');
  const capturePlanPointsEmpty = captureParams.has('capture-plan-points-empty');
  const captureAsk = captureParams.has('capture-ask');
  const captureSkills = captureParams.has('capture-skills');
  const [captureThinkingState, setCaptureThinkingState] = useState<'thinking' | 'other'>('thinking');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [projectsReady, setProjectsReady] = useState(false);
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const {
    agents,
    activeAgent,
    activeAgentId,
    messages,
    sendMessage,
    models,
    activeModel,
    isChangingModel,
    selectModel,
    thinkingLevel,
    thinkingLevels,
    supportsThinking,
    isChangingThinking,
    selectThinkingLevel,
    isStreaming,
    isConnected,
    isCompacting,
    collaborationMode,
    isChangingCollaborationMode,
    selectCollaborationMode,
    workflowPlan,
    workflowProposal,
    pendingUserInput,
    isLoadingSessions,
    sessionError,
    memoryState,
    runMemory,
    abortMemory,
    refreshMemory,
    request,
    refresh,
    connectServer,
    selectConversation,
    newConversation,
    processProposal,
    refineProposal,
    respondToUserInput,
  } = useMetisServer(activeProject);

  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [inspectorWidth, setInspectorWidth] = useState<number>(320);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => shouldShowOnboarding());
  const [settingsTab, setSettingsTab] = useState<'general' | 'shortcuts' | 'server' | 'model' | 'agent' | 'security' | 'session' | 'about'>('general');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [skillCommands, setSkillCommands] = useState<SkillCommand[]>([]);
  const [activeResizer, setActiveResizer] = useState<'sidebar' | 'inspector' | null>(null);
  const [subagentHistory, setSubagentHistory] = useState<SubagentHistory>(() => {
    if (typeof localStorage === 'undefined') return {};
    return parseSubagentHistory(localStorage.getItem(SUBAGENT_HISTORY_STORAGE_KEY));
  });

  const handleOpenMemorySettings = useCallback(() => {
    setSettingsTab('agent');
    setIsSettingsOpen(true);
  }, []);

  useEffect(() => {
    const onMemoryFinished = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.status === 'completed') {
        const msg = `Memory consolidation completed: ${detail.processed} processed, ${detail.added} added, ${detail.skipped} skipped${detail.fallbackUsed ? ' (safe fallback used)' : ''}.`;
        setToast({ message: msg, tone: 'success' });
      } else if (detail?.status === 'failed') {
        setToast({ message: `Memory consolidation failed: ${detail.error || 'Unknown error'}`, tone: 'error' });
      }
    };
    const onExtensionNotice = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.message) {
        setToast({ message: detail.message, tone: detail.tone || 'info' });
      }
    };
    window.addEventListener('metis:memory-finished', onMemoryFinished);
    window.addEventListener('metis:extension-notify', onExtensionNotice);
    return () => {
      window.removeEventListener('metis:memory-finished', onMemoryFinished);
      window.removeEventListener('metis:extension-notify', onExtensionNotice);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
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
  const displayedMessages = capturePlanPoints ? PLAN_POINTS_CAPTURE_MESSAGES : captureWorkDuration ? WORK_DURATION_CAPTURE_MESSAGES : captureThinkingOverflow ? THINKING_OVERFLOW_CAPTURE_MESSAGES : captureTools ? TOOL_GROUP_CAPTURE_MESSAGES : captureMessageWidth ? MESSAGE_WIDTH_CAPTURE_MESSAGES : captureThinkingProgress ? thinkingCaptureMessages : captureLocalSend ? [{
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
  const displayedThinkingLevel = captureModelSwitcher ? 'medium' : thinkingLevel;
  const displayedSupportsThinking = captureModelSwitcher || supportsThinking;
  const displayedWorkflowPlan = capturePlanPoints
    ? PLAN_POINTS_CAPTURE
    : capturePlanPointsEmpty
      ? undefined
      : workflowPlan;
  const displayedWorkspacePath = capturePlanPoints ? PLAN_POINTS_CAPTURE_WORKSPACE : activeProject?.path;
  const displayedFileChanges = useMemo(
    () => collectTurnFileChanges(
      displayedMessages.flatMap((message) => message.parts || []),
      { workspacePath: displayedWorkspacePath },
    ),
    [displayedMessages, displayedWorkspacePath],
  );
  const currentSubagents = useMemo(() => collectSubagentItems(messages), [messages]);
  const restoredSubagents = useMemo(
    () => mergeSubagentHistoryItems(subagentHistory[activeAgentId] || [], currentSubagents),
    [activeAgentId, currentSubagents, subagentHistory],
  );
  const displayedSubagents = useMemo(() => (
    displayedMessages === messages ? restoredSubagents : collectSubagentItems(displayedMessages)
  ), [displayedMessages, messages, restoredSubagents]);

  useEffect(() => {
    if (!activeAgentId || currentSubagents.length === 0) return;
    setSubagentHistory((current) => {
      const existing = current[activeAgentId] || [];
      const merged = mergeSubagentHistoryItems(existing, currentSubagents);
      if (JSON.stringify(existing) === JSON.stringify(merged)) return current;
      return { ...current, [activeAgentId]: merged };
    });
  }, [activeAgentId, currentSubagents]);

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
        const workspace = await desktop?.workspace?.get?.();
        const current = workspace?.path
          ? { id: workspace.path, name: workspace.name || workspace.path.split('/').pop(), path: workspace.path }
          : undefined;
        const merged = current
          ? [current, ...storedProjects.filter((project) => project.path !== current.path)]
          : storedProjects;
        const storedActive = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
        const nextActive = merged.find((project) => project.id === storedActive) || current || merged[0];
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

  const handleSelectProject = async (id: string) => {
    const targetProj = projects.find((p) => p.id === id);
    if (!targetProj || targetProj.id === activeProjectId) return;
    setActiveProjectId(id);
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.set && targetProj?.path) {
      try {
        await desktop.workspace.set(targetProj.path);
      } catch (err) {
        console.warn('[desktop] Failed to set workspace:', err);
      }
    }
  };

  const handleAddProject = async () => {
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
        name: workspace.name || workspace.path.split('/').pop() || 'Project',
        path: workspace.path,
      }));
      setProjects((current) => [
        ...current,
        ...additions.filter((addition) => !current.some((project) => project.path === addition.path)),
      ]);
      const nextProject = additions[0];
      await desktop.workspace.set?.(nextProject.path);
      setActiveProjectId(nextProject.id);
    } catch (err) {
      console.warn('[desktop] Failed to select workspace folder:', err);
    }
  };

  const handleChangeWorkspace = async () => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.workspace?.select) return false;
    try {
      const workspace = await desktop.workspace.select();
      if (!workspace?.path) return false;
      const project: ProjectItem = {
        id: workspace.path,
        name: workspace.name || workspace.path.split('/').pop() || 'Project',
        path: workspace.path,
      };
      setProjects((current) => [project, ...current.filter((item) => item.path !== project.path)]);
      await desktop.workspace.set?.(project.path);
      setActiveProjectId(project.id);
      return true;
    } catch (error) {
      console.warn('[desktop] Failed to change workspace:', error);
      return false;
    }
  };

  const handleOnboardingProject = async (workspace: { name?: string; path: string }) => {
    const project: ProjectItem = {
      id: workspace.path,
      name: workspace.name || workspace.path.split('/').pop() || 'Project',
      path: workspace.path,
    };
    setProjects((current) => [project, ...current.filter((item) => item.path !== project.path)]);
    setActiveProjectId(project.id);
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

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = 'sidebar';
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    setActiveResizer('sidebar');
  }, [sidebarWidth]);

  const handleInspectorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = 'inspector';
    startXRef.current = e.clientX;
    startWidthRef.current = inspectorWidth;
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
        setSidebarWidth(newWidth);
      } else if (isDraggingRef.current === 'inspector') {
        const deltaX = startXRef.current - e.clientX;
        const newWidth = Math.min(
          MAX_INSPECTOR_WIDTH,
          Math.max(MIN_INSPECTOR_WIDTH, startWidthRef.current + deltaX)
        );
        setInspectorWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = null;
        setActiveResizer(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      className={`flex h-screen w-screen bg-white select-none overflow-hidden ${
        activeResizer ? 'cursor-col-resize select-none' : ''
      }`}
    >
      {/* 1. Left Sidebar Panel */}
      {isSidebarOpen && (
        <>
          <Sidebar
            width={sidebarWidth}
            agents={displayedSidebarAgents}
            activeAgentId={displayedSidebarActiveAgentId}
            projects={projects}
            activeProjectId={activeProjectId}
            isLoading={captureConversationIcons ? false : isLoadingSessions}
            error={captureConversationIcons ? undefined : sessionError}
            onSelectAgent={selectConversation}
            onSelectProject={handleSelectProject}
            onAddProject={handleAddProject}
            onNewChat={newConversation}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onToggleSidebar={() => setIsSidebarOpen(false)}
          />

          {/* Resizer Handle for Sidebar */}
          <div
            onMouseDown={handleSidebarResizeStart}
            className="w-[4px] -ml-[2px] h-full cursor-col-resize z-30 hover:bg-blue-500/40 active:bg-blue-500 transition-colors flex-shrink-0"
            title="Drag to resize sidebar"
          />
        </>
      )}

      {/* 2. Center Main Chat Area */}
      <ChatArea
        agent={activeAgent}
        messages={displayedMessages}
        workspacePath={displayedWorkspacePath}
        isSidebarOpen={isSidebarOpen}
        isInspectorOpen={isInspectorOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onNewChat={newConversation}
        onSendMessage={captureLocalSend ? () => new Promise<boolean | void>(() => {}) : sendMessage}
        models={displayedModels}
        activeModel={displayedActiveModel}
        onSelectModel={selectModel}
        isChangingModel={isChangingModel}
        thinkingLevel={displayedThinkingLevel}
        thinkingLevels={displayedThinkingLevels}
        supportsThinking={displayedSupportsThinking}
        onSelectThinkingLevel={selectThinkingLevel}
        isChangingThinking={isChangingThinking}
        collaborationMode={collaborationMode}
        onSelectCollaborationMode={selectCollaborationMode}
        isChangingCollaborationMode={isChangingCollaborationMode}
        skills={captureSkills ? SKILL_PICKER_CAPTURE_SKILLS : skillCommands}
        isCompacting={isCompacting}
        onToggleInspector={() => setIsInspectorOpen((prev) => !prev)}
        isStreaming={captureThinkingProgress || captureStreamingWork ? true : capturePlanPreview ? false : isStreaming}
        isLoading={captureMessageWidth || captureThinkingProgress || capturePlanPreview || captureLocalSend ? false : isLoadingSessions}
        workflowProposal={displayedProposal}
        planActionsEnabled={capturePlanPreview || (isConnected && collaborationMode === 'plan' && !isStreaming && !isCompacting)}
        onProcessProposal={capturePlanPreview || collaborationMode === 'plan' ? processProposal : undefined}
        onRefineProposal={capturePlanPreview || collaborationMode === 'plan' ? refineProposal : undefined}
        pendingUserInput={captureAsk ? ASK_CAPTURE : pendingUserInput}
        onRespondToUserInput={captureAsk ? async () => true : respondToUserInput}
        memoryState={memoryState}
        onOpenMemorySettings={handleOpenMemorySettings}
      />

      {/* 3. Right Inspector Panel */}
      {isInspectorOpen && (
        <>
          {/* Resizer Handle for Inspector */}
          <div
            onMouseDown={handleInspectorResizeStart}
            className="w-[4px] -mr-[2px] h-full cursor-col-resize z-30 hover:bg-blue-500/40 active:bg-blue-500 transition-colors flex-shrink-0"
            title="Drag to resize inspector"
          />

          <Inspector
            width={inspectorWidth}
            workflowPlan={displayedWorkflowPlan}
            fileChanges={displayedFileChanges}
            subagents={displayedSubagents}
            onClose={() => setIsInspectorOpen(false)}
            onCollapse={() => setIsInspectorOpen(false)}
          />
        </>
      )}
      <SettingsDialog
        open={isSettingsOpen}
        initialTab={settingsTab}
        memoryState={memoryState}
        onClose={() => setIsSettingsOpen(false)}
        request={request}
        refresh={refresh}
        onConnectServer={connectServer}
        isConnected={isConnected}
        isBusy={isStreaming || isCompacting || isLoadingSessions}
        models={models}
        activeModel={activeModel}
        thinkingLevel={thinkingLevel}
        thinkingLevels={thinkingLevels}
        supportsThinking={supportsThinking}
        collaborationMode={collaborationMode}
        activeProject={activeProject}
        onChangeWorkspace={handleChangeWorkspace}
        onOpenOnboarding={() => { setIsSettingsOpen(false); setIsOnboardingOpen(true); }}
        onSelectModel={selectModel}
        onSelectThinkingLevel={selectThinkingLevel}
        onSelectCollaborationMode={selectCollaborationMode}
        onNewSession={newConversation}
      />
      <Onboarding
        open={isOnboardingOpen}
        request={request}
        isConnected={isConnected}
        models={models}
        onComplete={() => setIsOnboardingOpen(false)}
        onProjectReady={handleOnboardingProject}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[200] max-w-md rounded-2xl border px-4 py-3 text-[12.5px] font-medium shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 ${
            toast.tone === 'success'
              ? 'border-emerald-200/90 bg-emerald-50/95 text-emerald-800'
              : toast.tone === 'error'
                ? 'border-rose-200/90 bg-rose-50/95 text-rose-800'
                : 'border-slate-200/90 bg-white/95 text-slate-800'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-black/5 hover:text-slate-700"
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
