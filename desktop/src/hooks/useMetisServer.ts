import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Agent,
  AssistantContentPart,
  CollaborationMode,
  Message,
  MessageAttachment,
  ModelOption,
  ThinkingOption,
  PendingUserInput,
  ProjectItem,
  ServerSessionItem,
  SubagentProgress,
  SendMessageOptions,
  UserInputResponse,
  WorkflowPlanState,
  WorkflowProposalState,
  ToolCallResult,
  MemoryState,
  ContextUsage,
  TokenBreakdown,
} from '../types';
import { extractImageAttachments, parseAttachmentPayloadText } from '../lib/attachments';
import { applyToolExecutionUpdate, extractToolResultText } from '../lib/tool-execution-update';

type MetisResponse<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

type SessionState = {
  cwd: string;
  model?: ModelOption;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  thinkingLevel?: string;
  thinkingLevels?: string[];
  thinkingOptions?: ThinkingOption[];
  supportsThinking?: boolean;
  collaborationMode?: CollaborationMode;
  concurrencyStrategy?: 'tokensaver' | 'wide' | 'custom';
  maxConcurrent?: number;
  workflowPlan?: WorkflowPlanState;
  workflowProposal?: WorkflowProposalState;
  pendingUserInput?: PendingUserInput;
  contextUsage?: ContextUsage;
};

type ProviderModelsResponse = {
  models: ModelOption[];
};

type SessionListResponse = {
  cwd: string;
  sessions: ServerSessionItem[];
};

type SessionMessagesResponse = {
  serverInstanceId?: string;
  serverSequence?: number;
  serverSessionId?: string;
  messages: unknown[];
  messageTimings?: Array<{ messageTimestamp: number; completedAt: number }>;
};

type MetisEvent = {
  type?: string;
  id?: string;
  method?: string;
  serverInstanceId?: string;
  serverSequence?: number;
  serverSessionId?: string;
  message?: unknown;
  title?: string;
  url?: string;
  instructions?: string;
  placeholder?: string;
  prefill?: string;
  text?: string;
  options?: unknown[];
  notifyType?: 'info' | 'warning' | 'error';
  willRetry?: boolean;
  status?: string;
  name?: string;
  mode?: CollaborationMode;
  request?: PendingUserInput;
  entry?: { type?: string; customType?: string };
  state?: MemoryState;
};

const EMPTY_AGENT: Agent = {
  id: 'new-conversation',
  name: 'New conversation',
  avatarType: 'blob',
  gradient: 'from-slate-500 to-slate-700',
  subtitle: 'Start a new conversation',
  time: '',
};

function formatSessionTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function sessionTitle(session: ServerSessionItem): string {
  const title = session.name?.trim() || session.firstMessage?.trim();
  return !title || title === '(no messages)' ? 'New conversation' : title;
}

export function sessionToAgent(session: ServerSessionItem): Agent {
  const title = sessionTitle(session);
  return {
    id: session.id,
    name: title,
    avatarType: 'blob',
    gradient: 'from-slate-500 to-slate-700',
    subtitle: session.messageCount > 0 ? `${session.messageCount} messages` : 'No messages yet',
    time: formatSessionTime(session.modified || session.created),
    sessionPath: session.path,
    projectPath: session.cwd,
  };
}

export function reconcileSessionAgents(
  sessions: ServerSessionItem[],
  state: Pick<SessionState, 'sessionId' | 'sessionFile' | 'sessionName'>,
  projectPath: string,
): Agent[] {
  let nextAgents = sessions.map(sessionToAgent);
  const activeIndex = nextAgents.findIndex((agent) => (
    agent.id === state.sessionId || (state.sessionFile && agent.sessionPath === state.sessionFile)
  ));
  if (activeIndex >= 0 && state.sessionName?.trim() && nextAgents[activeIndex].name !== state.sessionName.trim()) {
    nextAgents = nextAgents.map((agent, index) => (
      index === activeIndex ? { ...agent, name: state.sessionName!.trim() } : agent
    ));
  }
  if (state.sessionId && !nextAgents.some((agent) => agent.id === state.sessionId)) {
    nextAgents = [{
      ...EMPTY_AGENT,
      id: state.sessionId,
      name: state.sessionName?.trim() || 'New conversation',
      sessionPath: state.sessionFile,
      projectPath,
    }, ...nextAgents];
  }
  return nextAgents;
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  if (typeof content === 'object' && !Array.isArray(content)) {
    const value = content as { text?: unknown; content?: unknown };
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
  }
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const value = part as { type?: string; text?: unknown; content?: unknown };
      if (value.type && !['text', 'input_text', 'output_text'].includes(value.type)) return '';
      return typeof value.text === 'string'
        ? value.text
        : typeof value.content === 'string'
          ? value.content
          : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function extractThinking(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const value = part as {
        type?: string;
        thinking?: unknown;
        reasoning?: unknown;
        text?: unknown;
        content?: unknown;
      };
      if (!['thinking', 'reasoning'].includes(value.type || '')) return '';
      if (typeof value.thinking === 'string') return value.thinking;
      if (typeof value.reasoning === 'string') return value.reasoning;
      if (typeof value.text === 'string') return value.text;
      return typeof value.content === 'string' ? value.content : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function extractThinkingDurationMs(content: unknown): number | undefined {
  if (!Array.isArray(content)) return undefined;
  const durations = content.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const value = part as {
      type?: string;
      durationMs?: unknown;
      duration_ms?: unknown;
      metadata?: { durationMs?: unknown };
    };
    if (!['thinking', 'reasoning'].includes(value.type || '')) return [];
    const duration = Number(value.durationMs ?? value.duration_ms ?? value.metadata?.durationMs);
    return Number.isFinite(duration) && duration >= 0 ? [duration] : [];
  });
  return durations.length > 0 ? durations.reduce((total, duration) => total + duration, 0) : undefined;
}

export function extractAssistantParts(
  content: unknown,
  toolResults: ReadonlyMap<string, ToolCallResult> = new Map(),
  messageId?: string,
): AssistantContentPart[] {
  const sourceParts = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  if (!Array.isArray(sourceParts)) return [];
  const idPrefix = messageId ? `${messageId}-` : '';
  return sourceParts.flatMap((part, index): AssistantContentPart[] => {
    if (typeof part === 'string') {
      return part ? [{ type: 'text', id: `${idPrefix}text-${index}`, text: part }] : [];
    }
    if (!part || typeof part !== 'object') return [];
    const value = part as {
      type?: string;
      id?: unknown;
      thinking?: unknown;
      reasoning?: unknown;
      text?: unknown;
      content?: unknown;
      durationMs?: unknown;
      duration_ms?: unknown;
      metadata?: { durationMs?: unknown };
      name?: unknown;
      arguments?: unknown;
      input?: unknown;
    };
    const id = typeof value.id === 'string' ? value.id : `${idPrefix}${value.type || 'part'}-${index}`;
    if (value.type === 'thinking' || value.type === 'reasoning') {
      const thinking = typeof value.thinking === 'string'
        ? value.thinking
        : typeof value.reasoning === 'string'
          ? value.reasoning
          : typeof value.text === 'string'
            ? value.text
            : typeof value.content === 'string' ? value.content : '';
      if (!thinking) return [];
      const rawDuration = Number(value.durationMs ?? value.duration_ms ?? value.metadata?.durationMs);
      return [{
        type: 'thinking',
        id,
        thinking,
        ...(Number.isFinite(rawDuration) && rawDuration >= 0 ? { durationMs: rawDuration } : {}),
      }];
    }
    if (value.type === 'toolCall') {
      const name = typeof value.name === 'string' ? value.name : 'tool';
      return [{
        type: 'toolCall',
        id,
        name,
        arguments: value.arguments ?? value.input ?? {},
        result: toolResults.get(id),
      }];
    }
    if (!value.type || ['text', 'input_text', 'output_text'].includes(value.type)) {
      const text = typeof value.text === 'string'
        ? value.text
        : typeof value.content === 'string' ? value.content : '';
      return text ? [{ type: 'text', id, text }] : [];
    }
    return [];
  });
}

export function toMessage(
  item: unknown,
  index = 0,
  streaming = false,
  toolResults: ReadonlyMap<string, ToolCallResult> = new Map(),
): Message | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const raw = item as Record<string, unknown>;
  const source = (raw.type === 'message' && raw.message && typeof raw.message === 'object')
    ? raw.message as Record<string, unknown>
    : raw;
  const role = source.role || raw.role;
  if (role !== 'user' && role !== 'assistant') return undefined;
  const timestamp = typeof source.timestamp === 'string' || typeof source.timestamp === 'number'
    ? source.timestamp
    : typeof raw.timestamp === 'string' || typeof raw.timestamp === 'number'
      ? raw.timestamp
      : undefined;
  const rawId = typeof source.id === 'string' ? source.id : typeof raw.id === 'string' ? raw.id : undefined;
  const messageId = rawId || `${role}-${String(timestamp ?? index)}`;
  const rawText = extractText(source.content) || (typeof source.text === 'string' ? source.text : '') || extractText(raw.content);
  const parsedPayload = parseAttachmentPayloadText(rawText);
  const content = parsedPayload.text;
  const imageAttachments = extractImageAttachments(source.content || raw.content);
  let imageIndex = 0;
  const attachments: MessageAttachment[] = parsedPayload.attachments.map((attachment) => {
    if (attachment.kind !== 'image') return attachment;
    const image = imageAttachments[imageIndex++];
    return image ? {
      ...attachment,
      ...image,
      id: attachment.id,
      name: attachment.name,
      sizeText: attachment.sizeText,
    } : attachment;
  });
  attachments.push(...imageAttachments.slice(imageIndex));
  const thinking = role === 'assistant' ? extractThinking(source.content || raw.content) : '';
  const thinkingDurationMs = thinking ? extractThinkingDurationMs(source.content || raw.content) : undefined;
  const parts = role === 'assistant' ? extractAssistantParts(source.content || raw.content, toolResults, messageId) : undefined;
  if (!content && !thinking && attachments.length === 0 && (!parts || parts.length === 0)) return undefined;
  const message: Message = {
    id: messageId,
    role: role as 'user' | 'assistant',
    content,
  };
  if (thinking) message.thinking = thinking;
  if (thinkingDurationMs !== undefined) message.thinkingDurationMs = thinkingDurationMs;
  if (parts && parts.length > 0) message.parts = parts;
  if (attachments.length > 0) message.attachments = attachments;
  if (typeof source.stopReason === 'string') message.stopReason = source.stopReason;
  if (timestamp !== undefined) {
    message.time = formatSessionTime(timestamp);
    message.serverTimestamp = timestamp;
  }
  if (role === 'assistant' && streaming) message.streaming = true;
  const usageSource = (source.usage && typeof source.usage === 'object')
    ? source.usage
    : (raw.usage && typeof raw.usage === 'object') ? raw.usage : undefined;
  if (usageSource) {
    const u = usageSource as Record<string, unknown>;
    const input = Number(u.input) || 0;
    const output = Number(u.output) || 0;
    const cacheRead = Number(u.cacheRead) || 0;
    const cacheWrite = Number(u.cacheWrite) || 0;
    const totalTokens = Number(u.totalTokens) || (input + output + cacheRead + cacheWrite);
    const cost = Number(u.cost) || 0;
    message.usage = { input, output, cacheRead, cacheWrite, totalTokens, cost };
  }
  return message;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function messageText(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  return extractToolResultText((item as { content?: unknown }).content);
}

export function getSubagentProgress(
  part: Extract<AssistantContentPart, { type: 'toolCall' }>,
  items: unknown[],
): SubagentProgress {
  const jobId = String(part.id || '').slice(-6);
  const toolResult = items.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const message = item as { role?: unknown; toolCallId?: unknown };
    return message.role === 'toolResult' && message.toolCallId === part.id;
  }) as { content?: unknown; isError?: unknown; timestamp?: unknown } | undefined;
  const launchMessage = items.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const content = (item as { content?: unknown }).content;
    return Array.isArray(content) && content.some((contentPart) => {
      if (!contentPart || typeof contentPart !== 'object') return false;
      return (contentPart as { id?: unknown }).id === part.id;
    });
  }) as { timestamp?: unknown } | undefined;
  const startedAt = toTimestamp(launchMessage?.timestamp);
  const progress = (state: SubagentProgress['state'], finishedAt?: number, exactDurationMs?: number): SubagentProgress => {
    const durationMs = exactDurationMs ?? (
      startedAt !== undefined && finishedAt !== undefined && finishedAt >= startedAt
        ? finishedAt - startedAt
        : undefined
    );
    return {
      jobId,
      state,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(finishedAt !== undefined ? { completedAt: finishedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  };
  if (toolResult?.isError) {
    return progress('failed', toTimestamp(toolResult.timestamp));
  }

  const completionMarker = `[Subagent Job ${jobId} finished]`;
  const completionMessage = items.find((item) => messageText(item).includes(completionMarker)) as { timestamp?: unknown } | undefined;
  if (toolResult) {
    const resultText = messageText(toolResult);
    let resultPayload: { status?: unknown; elapsedSec?: unknown } | undefined;
    try {
      const parsed = JSON.parse(resultText);
      if (parsed && typeof parsed === 'object') resultPayload = parsed as { status?: unknown; elapsedSec?: unknown };
    } catch {}
    const isStartedNotice = /started/i.test(resultText) || resultPayload?.status === 'started';
    if (resultPayload && !isStartedNotice) {
      const isSuccess = resultPayload.status === 'success' || resultPayload.status === 'completed';
      const isFail = resultPayload.status === 'error' || resultPayload.status === 'timed_out';
      const state = isFail ? 'failed' : isSuccess ? 'completed' : 'running';
      const finishedAt = state === 'running' ? undefined : toTimestamp(toolResult.timestamp);
      const elapsedSec = Number(resultPayload.elapsedSec);
      const exactDurationMs = Number.isFinite(elapsedSec) && elapsedSec >= 0 ? elapsedSec * 1000 : undefined;
      return progress(state, finishedAt, exactDurationMs);
    }
    const args = part.arguments && typeof part.arguments === 'object'
      ? part.arguments as Record<string, unknown>
      : {};
    if (!isStartedNotice && !completionMessage && part.name.toLowerCase() === 'spawn_agent' && args.mode !== 'async') {
      return progress('completed', toTimestamp(toolResult.timestamp));
    }
  }

  const state = completionMessage ? 'completed' : 'running';
  return progress(state, toTimestamp(completionMessage?.timestamp));
}

export function toMessages(
  items: unknown[],
  messageTimings: Array<{ messageTimestamp: number; completedAt: number }> = [],
): Message[] {
  const completionByTimestamp = new Map(messageTimings.map((timing) => [String(timing.messageTimestamp), timing.completedAt]));
  const toolResults = new Map<string, ToolCallResult>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const source = item as {
      role?: unknown;
      toolCallId?: unknown;
      content?: unknown;
      isError?: unknown;
      timestamp?: unknown;
    };
    if (source.role !== 'toolResult' || typeof source.toolCallId !== 'string') continue;
    toolResults.set(source.toolCallId, {
      content: extractToolResultText(source.content),
      isError: Boolean(source.isError),
      ...(typeof source.timestamp === 'string' || typeof source.timestamp === 'number'
        ? { timestamp: source.timestamp }
        : {}),
    });
  }
  return items.flatMap((item, index) => {
    const message = toMessage(item, index, false, toolResults);
    if (message?.role === 'assistant' && message.serverTimestamp !== undefined) {
      const completedAt = completionByTimestamp.get(String(message.serverTimestamp));
      if (Number.isFinite(completedAt)) message.completedAt = completedAt;
    }
    if (message?.parts) {
      message.parts = message.parts.map((part) => part.type === 'toolCall' && /^(subagent|spawn_agent)$/i.test(part.name)
        ? { ...part, progress: getSubagentProgress(part, items) }
        : part);
    }
    return message ? [message] : [];
  });
}

export function mergeAssistantParts(
  previous: AssistantContentPart[] = [],
  incoming: AssistantContentPart[] = [],
): AssistantContentPart[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;
  const incomingById = new Map(incoming.map((part) => [part.id, part]));
  const merged: AssistantContentPart[] = [];
  const seen = new Set<string>();
  for (const part of previous) {
    const replacement = incomingById.get(part.id);
    if (replacement) {
      merged.push(replacement.type === 'toolCall' && part.type === 'toolCall' && !replacement.result && part.result
        ? {
            ...replacement,
            result: part.result,
            progress: replacement.progress ?? part.progress,
          }
        : replacement);
      seen.add(part.id);
    } else if (part.type === 'thinking' || part.type === 'toolCall') {
      merged.push(part);
      seen.add(part.id);
    }
  }
  for (const part of incoming) {
    if (!seen.has(part.id)) merged.push(part);
  }
  return merged;
}

export function upsertConversationMessage(messages: Message[], incoming: Message): Message[] {
  let index = messages.findIndex((message) =>
    (incoming.id && message.id === incoming.id)
    || (incoming.serverTimestamp !== undefined
      && message.role === incoming.role
      && message.serverTimestamp === incoming.serverTimestamp)
  );
  if (index === -1 && incoming.role === 'user') {
    index = messages.findIndex((message) => message.role === 'user' && message.optimistic);
  }
  if (index === -1) return [...messages, incoming];
  const next = [...messages];
  const previous = next[index];
  next[index] = incoming.role === 'assistant'
    ? {
        ...incoming,
        ...(!incoming.thinking && previous.thinking ? { thinking: previous.thinking } : {}),
        ...(incoming.thinkingDurationMs === undefined && previous.thinkingDurationMs !== undefined
          ? { thinkingDurationMs: previous.thinkingDurationMs }
          : {}),
        ...((incoming.parts || previous.parts) ? {
          parts: mergeAssistantParts(previous.parts, incoming.parts),
        } : {}),
      }
    : incoming;
  return next;
}

function responseError(response: MetisResponse<unknown>, fallback: string): Error {
  const data = response.data as { error?: { message?: string } } | undefined;
  return new Error(data?.error?.message || response.error || fallback);
}

export function useMetisServer(activeProject?: ProjectItem) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [workflowPlan, setWorkflowPlan] = useState<WorkflowPlanState>();
  const [workflowProposal, setWorkflowProposal] = useState<WorkflowProposalState>();
  const [pendingUserInput, setPendingUserInput] = useState<PendingUserInput>();
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>('build');
  const [isCompacting, setIsCompacting] = useState(false);
  const [isChangingCollaborationMode, setIsChangingCollaborationMode] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [activeModel, setActiveModel] = useState<ModelOption>();
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [thinkingOptions, setThinkingOptions] = useState<ThinkingOption[]>([]);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [isChangingThinking, setIsChangingThinking] = useState(false);
  const [memoryState, setMemoryState] = useState<MemoryState>();
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const prevMemoryPhaseRef = useRef<string>();
  const activeProjectRef = useRef(activeProject);
  const agentsRef = useRef<Agent[]>([]);
  const loadVersionRef = useRef(0);
  const messageLoadVersionRef = useRef(0);
  const refreshTimerRef = useRef<number>();
  const activeSessionIdRef = useRef('');
  const serverInstanceIdRef = useRef('');
  const lastServerSequenceRef = useRef(0);

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const request = useCallback(async <T,>(path: string, method = 'GET', body?: unknown, timeoutMs?: number): Promise<T> => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.metis?.request) throw new Error('Metis Desktop bridge is unavailable');
    const response = await desktop.metis.request({ path, method, body, timeoutMs }) as MetisResponse<T>;
    if (!response.ok) throw responseError(response, `Request failed (${response.status})`);
    return response.data as T;
  }, []);

  const loadMessages = useCallback(async (expectedSessionId?: string, force = false) => {
    const version = ++messageLoadVersionRef.current;
    const [state, result, memoryRes] = await Promise.all([
      request<SessionState>('/session'),
      request<SessionMessagesResponse>('/session/messages'),
      request<MemoryState>('/memory').catch(() => undefined),
    ]);
    if (version !== messageLoadVersionRef.current) return;
    if (expectedSessionId && state.sessionId !== expectedSessionId && state.sessionFile !== expectedSessionId) {
      const matchesAgent = agentsRef.current.some((agent) => (
        (agent.id === expectedSessionId || agent.sessionPath === expectedSessionId) &&
        (agent.id === state.sessionId || (state.sessionFile && agent.sessionPath === state.sessionFile))
      ));
      if (!matchesAgent) return;
    }
    if (result.serverSessionId && result.serverSessionId !== state.sessionId) return;
    if (!force && Number.isSafeInteger(result.serverSequence)
      && (result.serverSequence || 0) < lastServerSequenceRef.current) return;
    activeSessionIdRef.current = state.sessionId;
    if (result.serverInstanceId) serverInstanceIdRef.current = result.serverInstanceId;
    if (Number.isSafeInteger(result.serverSequence)) {
      lastServerSequenceRef.current = Math.max(lastServerSequenceRef.current, result.serverSequence || 0);
    }
    if (memoryRes) {
      prevMemoryPhaseRef.current = memoryRes.phase;
      setMemoryState(memoryRes);
    }
    if (state.contextUsage !== undefined) {
      setContextUsage(state.contextUsage);
    }
    const nextMessages = toMessages(
      Array.isArray(result.messages) ? result.messages : [],
      Array.isArray(result.messageTimings) ? result.messageTimings : [],
    );
    if (state.isStreaming) {
      let lastAssistant = -1;
      for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
        if (nextMessages[index].role === 'assistant') {
          lastAssistant = index;
          break;
        }
      }
      if (lastAssistant >= 0) nextMessages[lastAssistant] = { ...nextMessages[lastAssistant], streaming: true };
    }
    setMessages((current) => {
      const optimisticUser = current.find((msg) => msg.role === 'user' && msg.optimistic);
      if (optimisticUser && !nextMessages.some((msg) => msg.role === 'user')) {
        return [optimisticUser, ...nextMessages];
      }
      return nextMessages;
    });
    const nextStreaming = Boolean(state.isStreaming);
    const nextCompacting = Boolean(state.isCompacting);
    setIsStreaming(nextStreaming);
    setIsCompacting(nextCompacting);
    setCollaborationMode(state.collaborationMode || 'build');
    setWorkflowPlan(state.workflowPlan);
    setWorkflowProposal(state.workflowProposal);
    setPendingUserInput(state.pendingUserInput);
    setActiveModel(state.model);
    setThinkingLevel(state.thinkingLevel || '');
    setThinkingLevels(Array.isArray(state.thinkingLevels) ? state.thinkingLevels : []);
    setThinkingOptions(Array.isArray(state.thinkingOptions) ? state.thinkingOptions : (state.thinkingLevels || []).map((id) => ({ id, label: id, value: id })));
    setSupportsThinking(Boolean(state.supportsThinking));
    if (state.sessionId) setActiveAgentId(state.sessionId);
  }, [request]);

  const tokenBreakdown = useMemo<TokenBreakdown | undefined>(() => {
    const contextWindow = contextUsage?.contextWindow || 128_000;
    let latestUsage: MessageUsage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].usage) {
        latestUsage = messages[i].usage;
        break;
      }
    }
    const input = latestUsage?.input ?? (contextUsage?.tokens ?? 0);
    const output = latestUsage?.output ?? 0;
    const cacheRead = latestUsage?.cacheRead ?? 0;
    const cacheWrite = latestUsage?.cacheWrite ?? 0;
    const total = contextUsage?.tokens ?? (input + output + cacheRead + cacheWrite);
    const percent = contextUsage?.percent ?? (contextWindow > 0 ? (total / contextWindow) * 100 : null);

    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      total,
      contextWindow,
      percent,
    };
  }, [messages, contextUsage]);

  const loadProject = useCallback(async (project: ProjectItem, switchWhenNeeded = true) => {
    const version = ++loadVersionRef.current;
    setIsLoadingSessions(true);
    setSessionError('');
    try {
      const result = await request<SessionListResponse>(`/sessions?cwd=${encodeURIComponent(project.path)}`, 'GET', undefined, 60_000);
      if (!Array.isArray(result.sessions)) throw new Error('Invalid session list response');
      if (version !== loadVersionRef.current) return;

      let state = await request<SessionState>('/session');
      const current = result.sessions.find((session) => session.path === state.sessionFile);
      if (switchWhenNeeded && (state.cwd !== project.path || !current)) {
        const destination = result.sessions[0]?.path;
        if (destination) {
          await request('/session/switch', 'POST', { sessionPath: destination });
        } else {
          await request('/session/new', 'POST', { cwd: project.path, collaborationMode: 'build' });
        }
        state = await request<SessionState>('/session');
      }

      if (version !== loadVersionRef.current) return;
      const nextAgents = reconcileSessionAgents(result.sessions, state, project.path);
      setAgents(nextAgents);
      activeSessionIdRef.current = state.sessionId || '';
      setActiveAgentId(state.sessionId || nextAgents[0]?.id || '');
      await loadMessages(state.sessionId || undefined);
    } catch (error) {
      if (version !== loadVersionRef.current) return;
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === loadVersionRef.current) setIsLoadingSessions(false);
    }
  }, [loadMessages, request]);

  const connectServer = useCallback(async (options?: { baseUrl?: string; username?: string; password?: string }) => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.metis?.connect) {
      setSessionError('Metis Desktop bridge is unavailable');
      return false;
    }
    setSessionError('');
    try {
      const response = await desktop.metis.connect(options);
      if (response?.ok === false) throw responseError(response, 'Unable to connect to the Metis Server');
      setIsConnected(true);
      const project = activeProjectRef.current;
      if (project) await loadProject(project, false);
      else await loadMessages(activeSessionIdRef.current || undefined);
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [loadMessages, loadProject]);

  useEffect(() => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.metis) return;
    let disposed = false;

    const connect = async () => {
      const connected = await connectServer();
      if (!disposed && !connected) setIsConnected(false);
    };

    void connect();
    const acceptsEvent = (event: MetisEvent) => {
      const instanceId = event.serverInstanceId;
      const sequence = event.serverSequence;
      if (event.type === 'server.connected' && instanceId && instanceId !== serverInstanceIdRef.current) {
        serverInstanceIdRef.current = instanceId;
        lastServerSequenceRef.current = 0;
      } else if (instanceId && serverInstanceIdRef.current && instanceId !== serverInstanceIdRef.current) {
        return false;
      } else if (instanceId && !serverInstanceIdRef.current) {
        serverInstanceIdRef.current = instanceId;
      }
      if (event.type !== 'server.session_changed'
        && event.serverSessionId
        && activeSessionIdRef.current
        && event.serverSessionId !== activeSessionIdRef.current) {
        const matchesActiveAgent = agentsRef.current.some((agent) => (
          (agent.id === activeSessionIdRef.current || agent.sessionPath === activeSessionIdRef.current) &&
          (agent.id === event.serverSessionId || (agent.sessionPath && (event as any).sessionFile === agent.sessionPath))
        ));
        if (!matchesActiveAgent) return false;
      }
      if (Number.isSafeInteger(sequence)) {
        if ((sequence || 0) <= lastServerSequenceRef.current) return false;
        lastServerSequenceRef.current = sequence || 0;
      }
      return true;
    };

    const reconcileCurrentSession = () => {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        const sessionId = activeSessionIdRef.current;
        void loadMessages(sessionId || undefined).catch((error) => {
          setSessionError(error instanceof Error ? error.message : String(error));
        });
      }, 80);
    };

    let pendingMessageUpdate: Message | null = null;
    let updateRafId: number | null = null;

    const flushPendingUpdate = () => {
      if (updateRafId !== null) {
        window.cancelAnimationFrame(updateRafId);
        updateRafId = null;
      }
      if (pendingMessageUpdate) {
        const msg = pendingMessageUpdate;
        pendingMessageUpdate = null;
        setMessages((current) => upsertConversationMessage(current, msg));
      }
    };

    const scheduleMessageUpdate = (message: Message) => {
      pendingMessageUpdate = message;
      if (updateRafId === null) {
        updateRafId = window.requestAnimationFrame(() => {
          updateRafId = null;
          if (pendingMessageUpdate) {
            const msg = pendingMessageUpdate;
            pendingMessageUpdate = null;
            setMessages((current) => upsertConversationMessage(current, msg));
          }
        });
      }
    };

    const unsubscribeEvent = desktop.metis.onEvent((event: MetisEvent) => {
      if (!acceptsEvent(event)) return;
      const type = event?.type || '';
      if (['server.connected', 'message_start', 'message_update', 'message_end', 'agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end', 'user_input_request', 'session_info_changed'].includes(type)) {
        setSessionError('');
      }
      if (type === 'extension_ui_request') {
        void (async () => {
          if (event.method === 'open_url') {
            if (event.url) await desktop.openExternal?.(event.url);
            if (event.instructions) {
              console.info('[desktop extension]', event.instructions);
              window.dispatchEvent(new CustomEvent('metis:extension-notify', { detail: { message: event.instructions, tone: 'info' } }));
            }
            return;
          }
          if (event.method === 'notify' || event.method === 'setStatus') {
            const notice = typeof event.message === 'string' ? event.message : event.instructions;
            if (notice) {
              console[event.notifyType === 'error' ? 'error' : 'info']('[desktop extension]', notice);
              window.dispatchEvent(new CustomEvent('metis:extension-notify', { detail: { message: notice, tone: event.notifyType || 'info' } }));
            }
            return;
          }
          if (!event.id || !['confirm', 'select', 'input', 'editor'].includes(event.method || '')) return;
          let response: Record<string, unknown>;
          if (event.method === 'confirm') {
            response = { id: event.id, confirmed: window.confirm([event.title, event.message].filter(Boolean).join('\n\n')) };
          } else if (event.method === 'select') {
            const choices = (event.options || []).map(String);
            const answer = window.prompt(`${event.title || 'Select'}\n\n${choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n')}`);
            if (answer === null) response = { id: event.id, cancelled: true };
            else {
              const numbered = choices[Number.parseInt(answer, 10) - 1];
              response = { id: event.id, value: numbered || choices.find((choice) => choice === answer) || answer };
            }
          } else {
            const answer = window.prompt(event.title || 'Input', event.prefill || event.placeholder || '');
            response = answer === null ? { id: event.id, cancelled: true } : { id: event.id, value: answer };
          }
          await request('/extension/ui-response', 'POST', response);
        })().catch((error) => setSessionError(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (type === 'server.connected') {
        setIsConnected(true);
        return;
      }
      if (type === 'message_start' || type === 'message_update' || type === 'message_end') {
        const isEnd = type === 'message_end';
        const message = toMessage(event.message, Date.now(), !isEnd);
        if (message) {
          if (isEnd) {
            flushPendingUpdate();
            setMessages((current) => upsertConversationMessage(current, message));
          } else {
            scheduleMessageUpdate(message);
          }
        }
        if (!isEnd) {
          setIsStreaming(true);
        }
        if (isEnd) reconcileCurrentSession();
        return;
      }
      if (type === 'tool_execution_update') {
        setIsStreaming(true);
        const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
        if (toolCallId) {
          setMessages((current) => applyToolExecutionUpdate(current, toolCallId, event.partialResult));
        }
        return;
      }
      if (['agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end'].includes(type)) {
        setIsStreaming(true);
        if (type === 'tool_execution_start' || type === 'tool_execution_end') reconcileCurrentSession();
        return;
      }
      if (type === 'agent_end') {
        flushPendingUpdate();
        if (!event.willRetry) {
          setIsStreaming(false);
        }
        reconcileCurrentSession();
        const project = activeProjectRef.current;
        if (project) void loadProject(project, false);
        return;
      }
      if (type === 'server.session_changed') {
        const project = activeProjectRef.current;
        if (project) void loadProject(project, false);
        return;
      }
      if (type === 'collaboration_mode_changed' && (event.mode === 'plan' || event.mode === 'build')) {
        setCollaborationMode(event.mode);
        return;
      }
      if (type === 'user_input_request' && event.request) {
        setPendingUserInput(event.request);
        return;
      }
      if (type === 'entry_appended' && ['workflow_plan', 'workflow_plan_reset'].includes(event.entry?.customType || '')) {
        reconcileCurrentSession();
        return;
      }
      if (type === 'session_info_changed' || (type === 'session_name_generation' && event.status === 'completed')) {
        const generatedName = event.name?.trim();
        if (generatedName) {
          setAgents((current) => current.map((agent) => (
            agent.id === activeSessionIdRef.current ? { ...agent, name: generatedName } : agent
          )));
        }
        const project = activeProjectRef.current;
        if (project) void loadProject(project, false);
        void refreshModels();
      }
      if (type === 'memory_state_changed' && event.state) {
        const nextMemoryState = event.state as MemoryState;
        const prevPhase = prevMemoryPhaseRef.current;
        prevMemoryPhaseRef.current = nextMemoryState.phase;
        setMemoryState(nextMemoryState);
        if ((prevPhase === 'extracting' || prevPhase === 'consolidating') && nextMemoryState.phase === 'idle') {
          window.dispatchEvent(new CustomEvent('metis:memory-finished', {
            detail: {
              status: 'completed',
              processed: nextMemoryState.lastRunProcessed ?? 0,
              added: nextMemoryState.lastRunAdded ?? 0,
              skipped: nextMemoryState.lastRunSkipped ?? 0,
              fallbackUsed: nextMemoryState.fallbackUsed,
            },
          }));
        } else if ((prevPhase === 'extracting' || prevPhase === 'consolidating') && (nextMemoryState.phase === 'retry_wait' || nextMemoryState.phase === 'error')) {
          window.dispatchEvent(new CustomEvent('metis:memory-finished', {
            detail: {
              status: 'failed',
              error: nextMemoryState.error,
            },
          }));
        }
        return;
      }
      if (type === 'memory_records_changed') {
        void request<MemoryState>('/memory').then((res) => {
          if (res) {
            prevMemoryPhaseRef.current = res.phase;
            setMemoryState(res);
          }
        }).catch(() => {});
        return;
      }
    });
    const unsubscribeDisconnect = desktop.metis.onDisconnect(() => {
      flushPendingUpdate();
      setIsConnected(false);
      setIsStreaming(false);
    });
    const unsubscribeServerReady = desktop.metis.onServerReady?.(() => {
      void connect();
    });

    return () => {
      disposed = true;
      if (updateRafId !== null) {
        window.cancelAnimationFrame(updateRafId);
        updateRafId = null;
      }
      pendingMessageUpdate = null;
      window.clearTimeout(refreshTimerRef.current);
      unsubscribeEvent?.();
      unsubscribeDisconnect?.();
      unsubscribeServerReady?.();
    };
  }, [connectServer, loadProject, request]);

  useEffect(() => {
    if (isConnected && activeProject) void loadProject(activeProject);
  }, [activeProject, isConnected, loadProject]);

  const refreshModels = useCallback(async () => {
    try {
      const result = await request<ProviderModelsResponse>('/config/providers');
      const nextModels = Array.isArray(result.models) ? result.models : [];
      setModels(nextModels);
      const state = await request<SessionState>('/session');
      setActiveModel(state.model);
      setThinkingLevel(state.thinkingLevel || '');
      setThinkingLevels(Array.isArray(state.thinkingLevels) ? state.thinkingLevels : []);
      setThinkingOptions(Array.isArray(state.thinkingOptions) ? state.thinkingOptions : (state.thinkingLevels || []).map((id) => ({ id, label: id, value: id })));
      setSupportsThinking(Boolean(state.supportsThinking));
      return nextModels;
    } catch (error) {
      return [];
    }
  }, [request]);

  useEffect(() => {
    if (!isConnected) {
      setModels([]);
      return;
    }
    void refreshModels();
  }, [isConnected, refreshModels]);

  const selectConversation = useCallback(async (agentId: string) => {
    const agent = agentsRef.current.find((item) => item.id === agentId);
    if (!agent?.sessionPath) return;
    if (agentId === activeSessionIdRef.current) return;
    setIsLoadingSessions(true);
    setSessionError('');
    try {
      const switchResult = await request<SessionState & { cancelled: boolean }>('/session/switch', 'POST', { sessionPath: agent.sessionPath });
      messageLoadVersionRef.current += 1;
      const targetSessionId = switchResult.sessionId || agentId;
      activeSessionIdRef.current = targetSessionId;
      setActiveAgentId(targetSessionId);
      if (switchResult.pendingUserInput !== undefined) {
        setPendingUserInput(switchResult.pendingUserInput);
      } else {
        setPendingUserInput(undefined);
      }
      if (switchResult.collaborationMode) {
        setCollaborationMode(switchResult.collaborationMode);
      }
      if (switchResult.workflowPlan !== undefined) {
        setWorkflowPlan(switchResult.workflowPlan);
      }
      if (switchResult.workflowProposal !== undefined) {
        setWorkflowProposal(switchResult.workflowProposal);
      }
      if (switchResult.model) {
        setActiveModel(switchResult.model);
      }
      await loadMessages(targetSessionId, true);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [loadMessages, request]);

  const newConversation = useCallback(async () => {
    const project = activeProjectRef.current;
    if (!project) return false;
    setIsLoadingSessions(true);
    setSessionError('');
    try {
      const state = await request<SessionState>('/session/new', 'POST', { cwd: project.path, collaborationMode: 'build' });
      activeSessionIdRef.current = state.sessionId || '';
      setActiveAgentId(state.sessionId || '');
      setMessages([]);
      setWorkflowPlan(undefined);
      setWorkflowProposal(undefined);
      setPendingUserInput(undefined);
      await loadProject(project, false);
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
      setIsLoadingSessions(false);
      return false;
    }
  }, [loadProject, request]);

  const sendMessage = useCallback(async (text: string, options: SendMessageOptions = {}) => {
    const optimistic: Message = {
      id: `optimistic-user-${Date.now()}`,
      role: 'user',
      content: options.displayText ?? text,
      optimistic: true,
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    };
    setMessages((current) => [...current, optimistic]);
    setIsStreaming(true);
    try {
      await request('/session/prompt', 'POST', {
        message: text,
        ...(options.images?.length ? { images: options.images } : {}),
        ...(options.workflowAction ? { workflowAction: options.workflowAction } : {}),
      }, 120_000);
      await loadMessages(activeSessionIdRef.current || undefined);
      return true;
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setSessionError(error instanceof Error ? error.message : String(error));
      setIsStreaming(false);
      return false;
    }
  }, [loadMessages, request]);

  const selectModel = useCallback(async (model: ModelOption) => {
    if (isStreaming || isChangingModel) return;
    setIsChangingModel(true);
    setSessionError('');
    try {
      const selected = await request<ModelOption>('/session/model', 'PUT', {
        provider: model.provider,
        modelId: model.id,
      });
      setActiveModel(selected);
      const state = await request<SessionState>('/session');
      setThinkingLevel(state.thinkingLevel || '');
      setThinkingLevels(Array.isArray(state.thinkingLevels) ? state.thinkingLevels : []);
      setThinkingOptions(Array.isArray(state.thinkingOptions) ? state.thinkingOptions : (state.thinkingLevels || []).map((id) => ({ id, label: id, value: id })));
      setSupportsThinking(Boolean(state.supportsThinking));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsChangingModel(false);
    }
  }, [isChangingModel, isStreaming, request]);

  const selectThinkingLevel = useCallback(async (level: string) => {
    if (!level || isStreaming || isChangingThinking) return;
    setIsChangingThinking(true);
    setSessionError('');
    try {
      const result = await request<{ level: string }>('/session/thinking', 'PUT', { level });
      setThinkingLevel(result.level);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsChangingThinking(false);
    }
  }, [isChangingThinking, isStreaming, request]);

  const selectCollaborationMode = useCallback(async (mode: CollaborationMode) => {
    if (mode === collaborationMode) return true;
    if (isStreaming || isCompacting || isChangingCollaborationMode) return false;
    setIsChangingCollaborationMode(true);
    setSessionError('');
    try {
      const state = await request<SessionState>('/session/collaboration-mode', 'PUT', { mode });
      setCollaborationMode(state.collaborationMode || mode);
      setWorkflowPlan(state.workflowPlan);
      setWorkflowProposal(state.workflowProposal);
      setIsCompacting(Boolean(state.isCompacting));
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsChangingCollaborationMode(false);
    }
  }, [collaborationMode, isChangingCollaborationMode, isCompacting, isStreaming, request]);

  const respondToUserInput = useCallback(async (requestId: string, response: UserInputResponse) => {
    setSessionError('');
    try {
      await request(`/session/user-input/${encodeURIComponent(requestId)}`, 'POST', response);
      setPendingUserInput((current) => current?.requestId === requestId ? undefined : current);
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [request]);

  const processProposal = useCallback(async () => {
    if (!await selectCollaborationMode('build')) return false;
    return sendMessage('Process this plan.', { workflowAction: 'process_proposal' });
  }, [selectCollaborationMode, sendMessage]);

  const refineProposal = useCallback((requestText: string) => (
    sendMessage(`Revise the current plan with this request:\n\n${requestText}`)
  ), [sendMessage]);

  const refresh = useCallback(async () => {
    const project = activeProjectRef.current;
    if (project) await loadProject(project, false);
    else await loadMessages(activeSessionIdRef.current || undefined);
  }, [loadMessages, loadProject]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) || {
      ...EMPTY_AGENT,
      name: activeProject?.name ? `New conversation · ${activeProject.name}` : EMPTY_AGENT.name,
    },
    [activeAgentId, activeProject?.name, agents],
  );

  const runMemory = useCallback(async () => {
    return await request<MemoryState>('/memory/run', 'POST', undefined, 10 * 60_000);
  }, [request]);

  const abortMemory = useCallback(async () => {
    return await request<MemoryState>('/memory/abort', 'POST');
  }, [request]);

  const abortTurn = useCallback(async () => {
    setIsStreaming(false);
    return await request<{ success?: boolean }>('/session/abort', 'POST');
  }, [request]);

  const refreshMemory = useCallback(async () => {
    try {
      const next = await request<MemoryState>('/memory');
      if (next) {
        prevMemoryPhaseRef.current = next.phase;
        setMemoryState(next);
      }
      return next;
    } catch {
      return undefined;
    }
  }, [request]);

  return {
    agents,
    activeAgent,
    activeAgentId,
    messages,
    sendMessage,
    abortTurn,
    models,
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
    contextUsage,
    tokenBreakdown,
  };
}

