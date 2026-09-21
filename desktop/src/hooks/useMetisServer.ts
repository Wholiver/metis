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
  ProviderCatalogEntry,
  ServerSessionItem,
  SubagentProgress,
  SendMessageOptions,
  UserInputResponse,
  WorkflowPlanState,
  WorkflowProposalState,
  ToolCallResult,
  MemoryState,
  ContextUsage,
  MessageUsage,
  TokenBreakdown,
} from '../types';
import { extractImageAttachments, parseAttachmentPayloadText } from '../lib/attachments';
import { cleanPastedText } from '../lib/composer';
import { revealPromptForDisplay, rewritePromptForModel } from '../lib/prompt-rewrite';
import {
  ExtensionUiRequest,
  ExtensionUiResponse,
  toExtensionUiRequest,
} from '../lib/extension-ui';
import { applyToolExecutionEnd, applyToolExecutionUpdate, extractToolResultText } from '../lib/tool-execution-update';
import { workflowPlanFromCustomEntry } from '../lib/workflow-plan';

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
  providers?: ProviderCatalogEntry[];
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
  entry?: { type?: string; customType?: string; timestamp?: string; data?: unknown };
  state?: MemoryState;
  toolCallId?: string;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  session?: SessionState;
};

const EMPTY_AGENT: Agent = {
  id: 'new-conversation',
  name: 'New conversation',
  avatarType: 'blob',
  gradient: 'from-slate-500 to-slate-700',
  subtitle: 'Start a new conversation',
  time: '',
};

/** Compact relative labels like Codex/Cursor: 4m, 1h, 2d, 11d */
export function formatSessionTime(value: string | number, now = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return '1m';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function sessionTitle(session: ServerSessionItem): string {
  const raw = session.name?.trim() || session.firstMessage?.trim();
  const title = revealPromptForDisplay(cleanPastedText(raw || ''));
  return !title || title === '(no messages)' ? 'New conversation' : title;
}

export function sessionSubtitle(session: ServerSessionItem): string {
  const rawPrompt = session.lastMessage?.trim() || session.firstMessage?.trim();
  const prompt = revealPromptForDisplay(cleanPastedText(rawPrompt || ''));
  return !prompt || prompt === '(no messages)' ? 'No messages yet' : prompt;
}

export function sessionToAgent(session: ServerSessionItem): Agent {
  const title = sessionTitle(session);
  return {
    id: session.id,
    name: title,
    avatarType: 'blob',
    gradient: 'from-slate-500 to-slate-700',
    subtitle: sessionSubtitle(session),
    time: formatSessionTime(session.modified || session.created),
    sessionPath: session.path,
    projectPath: session.cwd,
  };
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^file:\/\//i, '').replace(/\/+$/, '');
}

export function pathsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const normA = normalizePath(a);
  const normB = normalizePath(b);
  const isWindows = /^[a-z]:\//i.test(normA) || /^[a-z]:\//i.test(normB);
  return isWindows ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

export function isSessionOwnedByProject(
  state: { cwd?: string; sessionFile?: string },
  projectPath: string,
): boolean {
  if (!projectPath) return false;
  if (state.cwd) {
    return pathsEqual(state.cwd, projectPath);
  }
  if (state.sessionFile) {
    const normFile = normalizePath(state.sessionFile);
    const normWorkspace = normalizePath(projectPath);
    const isWindows = /^[a-z]:\//i.test(normFile) || /^[a-z]:\//i.test(normWorkspace);
    const file = isWindows ? normFile.toLowerCase() : normFile;
    const workspace = isWindows ? normWorkspace.toLowerCase() : normWorkspace;
    if (file === workspace || file.startsWith(`${workspace}/`)) {
      return true;
    }
    const safePath = `--${workspace.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    if (file.includes(safePath)) {
      return true;
    }
    return false;
  }
  return false;
}

export function reconcileSessionAgents(
  sessions: ServerSessionItem[],
  state: Pick<SessionState, 'sessionId' | 'sessionFile' | 'sessionName'> & { cwd?: string },
  projectPath: string,
): Agent[] {
  let nextAgents = sessions.map(sessionToAgent);
  const belongsToProject = isSessionOwnedByProject(state, projectPath);
  const activeIndex = nextAgents.findIndex((agent) => (
    agent.id === state.sessionId || (state.sessionFile && agent.sessionPath === state.sessionFile)
  ));
  if (activeIndex >= 0 && state.sessionName?.trim() && nextAgents[activeIndex].name !== state.sessionName.trim()) {
    nextAgents = nextAgents.map((agent, index) => (
      index === activeIndex ? { ...agent, name: state.sessionName!.trim() } : agent
    ));
  }
  if (belongsToProject && state.sessionId && !nextAgents.some((agent) => agent.id === state.sessionId)) {
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
  const rawRole = source.role || raw.role;
  const isCompaction = rawRole === 'compactionSummary';
  const role = isCompaction ? 'assistant' : rawRole;
  if (role !== 'user' && role !== 'assistant') return undefined;
  const timestamp = typeof source.timestamp === 'string' || typeof source.timestamp === 'number'
    ? source.timestamp
    : typeof raw.timestamp === 'string' || typeof raw.timestamp === 'number'
      ? raw.timestamp
      : undefined;
  const rawId = typeof source.id === 'string' ? source.id : typeof raw.id === 'string' ? raw.id : undefined;
  const messageId = rawId || `${rawRole}-${String(timestamp ?? index)}`;
  const stopReason = typeof source.stopReason === 'string'
    ? source.stopReason
    : typeof raw.stopReason === 'string' ? raw.stopReason : undefined;
  const errorMessage = typeof source.errorMessage === 'string'
    ? source.errorMessage.trim()
    : typeof raw.errorMessage === 'string' ? raw.errorMessage.trim() : '';
  const isFailure = role === 'assistant' && (
    stopReason === 'error' ||
    stopReason === 'aborted' ||
    Boolean(errorMessage)
  );
  const rawText = isCompaction
    ? `**[Context Compacted]** (Tokens before: ${source.tokensBefore ?? raw.tokensBefore ?? 'unknown'})\n\n${source.summary || raw.summary || extractText(source.content) || ''}`
    : (extractText(source.content)
        || (typeof source.text === 'string' ? source.text : '')
        || extractText(raw.content)
        || (role === 'assistant' && (stopReason === 'error' || stopReason === 'aborted') ? errorMessage : ''));
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
  if (!content && !thinking && attachments.length === 0 && (!parts || parts.length === 0) && !isFailure) return undefined;
  const message: Message = {
    id: messageId,
    role: role as 'user' | 'assistant',
    content,
  };
  if (isCompaction) message.tags = ['compaction'];
  if (thinking) message.thinking = thinking;
  if (thinkingDurationMs !== undefined) message.thinkingDurationMs = thinkingDurationMs;
  if (parts && parts.length > 0) message.parts = parts;
  if (attachments.length > 0) message.attachments = attachments;
  if (stopReason) message.stopReason = stopReason;
  if (errorMessage) message.errorMessage = errorMessage;
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

type SubagentLookupItem = {
  content?: unknown;
  isError?: unknown;
  timestamp?: unknown;
  role?: unknown;
  toolCallId?: unknown;
};

type SubagentProgressIndex = {
  toolResultById: Map<string, SubagentLookupItem>;
  launchByPartId: Map<string, SubagentLookupItem>;
  completionByJobId: Map<string, SubagentLookupItem>;
};

export function buildSubagentProgressIndex(items: unknown[]): SubagentProgressIndex {
  const toolResultById = new Map<string, SubagentLookupItem>();
  const launchByPartId = new Map<string, SubagentLookupItem>();
  const completionByJobId = new Map<string, SubagentLookupItem>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const source = item as SubagentLookupItem & { content?: unknown };
    if (source.role === 'toolResult' && typeof source.toolCallId === 'string') {
      toolResultById.set(source.toolCallId, source);
    }
    const content = source.content;
    if (Array.isArray(content)) {
      for (const contentPart of content) {
        if (!contentPart || typeof contentPart !== 'object') continue;
        const id = (contentPart as { id?: unknown }).id;
        if (typeof id === 'string' && id && !launchByPartId.has(id)) {
          launchByPartId.set(id, source);
        }
      }
    }
    const text = messageText(source);
    const markerMatch = text.match(/\[Subagent Job ([^\]]+) finished\]/);
    if (markerMatch?.[1] && !completionByJobId.has(markerMatch[1])) {
      completionByJobId.set(markerMatch[1], source);
    }
  }
  return { toolResultById, launchByPartId, completionByJobId };
}

export function getSubagentProgress(
  part: Extract<AssistantContentPart, { type: 'toolCall' }>,
  items: unknown[],
  index: SubagentProgressIndex = buildSubagentProgressIndex(items),
): SubagentProgress {
  const jobId = String(part.id || '').slice(-6);
  const toolResult = index.toolResultById.get(part.id);
  const launchMessage = index.launchByPartId.get(part.id);
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

  const completionMessage = index.completionByJobId.get(jobId);
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

function partsContentEqual(previous?: AssistantContentPart[], incoming?: AssistantContentPart[]): boolean {
  if (previous === incoming) return true;
  if (!previous || !incoming || previous.length !== incoming.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index];
    const right = incoming[index];
    if (left.id !== right.id || left.type !== right.type) return false;
    if (left.type === 'text' && right.type === 'text') {
      if (left.text !== right.text) return false;
      continue;
    }
    if (left.type === 'thinking' && right.type === 'thinking') {
      if (left.thinking !== right.thinking || left.durationMs !== right.durationMs) return false;
      continue;
    }
    if (left.type === 'toolCall' && right.type === 'toolCall') {
      if (left.name !== right.name) return false;
      if ((left.result?.content ?? '') !== (right.result?.content ?? '')) return false;
      if (Boolean(left.result?.isError) !== Boolean(right.result?.isError)) return false;
      if (left.progress?.state !== right.progress?.state) return false;
      if (left.progress?.durationMs !== right.progress?.durationMs) return false;
      if (left.progress?.startedAt !== right.progress?.startedAt) return false;
      if (left.progress?.completedAt !== right.progress?.completedAt) return false;
      if (JSON.stringify(left.arguments ?? null) !== JSON.stringify(right.arguments ?? null)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function attachmentsIdentityEqual(previous?: Message['attachments'], incoming?: Message['attachments']): boolean {
  if (previous === incoming) return true;
  if ((previous?.length ?? 0) !== (incoming?.length ?? 0)) return false;
  if (!previous || !incoming) return true;
  return previous.every((item, index) => (
    item.id === incoming[index]?.id
    && item.previewUrl === incoming[index]?.previewUrl
    && item.path === incoming[index]?.path
  ));
}

function messagesContentEqual(previous: Message, incoming: Message): boolean {
  return previous.id === incoming.id
    && previous.role === incoming.role
    && previous.content === incoming.content
    && previous.thinking === incoming.thinking
    && previous.thinkingDurationMs === incoming.thinkingDurationMs
    && previous.streaming === incoming.streaming
    && previous.stopReason === incoming.stopReason
    && previous.errorMessage === incoming.errorMessage
    && previous.completedAt === incoming.completedAt
    && previous.serverTimestamp === incoming.serverTimestamp
    && previous.optimistic === incoming.optimistic
    && previous.time === incoming.time
    && previous.file?.url === incoming.file?.url
    && (previous.tags || []).join('\0') === (incoming.tags || []).join('\0')
    && (previous.usage?.totalTokens ?? 0) === (incoming.usage?.totalTokens ?? 0)
    && (previous.usage?.cost ?? 0) === (incoming.usage?.cost ?? 0)
    && (previous.usage?.input ?? 0) === (incoming.usage?.input ?? 0)
    && (previous.usage?.output ?? 0) === (incoming.usage?.output ?? 0)
    && (previous.usage?.cacheRead ?? 0) === (incoming.usage?.cacheRead ?? 0)
    && (previous.usage?.cacheWrite ?? 0) === (incoming.usage?.cacheWrite ?? 0)
    && partsContentEqual(previous.parts, incoming.parts)
    && attachmentsIdentityEqual(previous.attachments, incoming.attachments);
}

/** Reuse prior message object identity when snapshot content is unchanged. */
export function reuseStableMessages(previous: Message[], next: Message[]): Message[] {
  if (previous.length === 0) return next;
  if (previous === next) return previous;
  const previousById = new Map(previous.map((message) => [message.id, message]));
  let unchanged = previous.length === next.length;
  const reused = next.map((incoming, index) => {
    const prior = previousById.get(incoming.id);
    if (prior && messagesContentEqual(prior, incoming)) {
      if (previous[index] !== prior) unchanged = false;
      return prior;
    }
    unchanged = false;
    return incoming;
  });
  return unchanged && previous.every((message, index) => message === reused[index]) ? previous : reused;
}

/** True when live streaming content is longer than a lagging snapshot of the same message. */
export function messageIsStrictlyAhead(live: Message, snapshot: Message): boolean {
  if (live.role !== snapshot.role) return false;
  if ((live.content?.length ?? 0) > (snapshot.content?.length ?? 0)) return true;
  if ((live.thinking?.length ?? 0) > (snapshot.thinking?.length ?? 0)) return true;
  const liveParts = live.parts || [];
  const snapshotParts = snapshot.parts || [];
  if (liveParts.length > snapshotParts.length) return true;
  const limit = Math.min(liveParts.length, snapshotParts.length);
  for (let index = 0; index < limit; index += 1) {
    const left = liveParts[index];
    const right = snapshotParts[index];
    if (left.type !== right.type || left.id !== right.id) continue;
    if (left.type === 'text' && right.type === 'text' && left.text.length > right.text.length) return true;
    if (left.type === 'thinking' && right.type === 'thinking' && left.thinking.length > right.thinking.length) return true;
    if (left.type === 'toolCall' && right.type === 'toolCall') {
      if ((left.result?.content?.length ?? 0) > (right.result?.content?.length ?? 0)) return true;
    }
  }
  return false;
}

function mergeSnapshotMetadata(live: Message, snapshot: Message): Message {
  const patch: Partial<Message> = {};
  if (snapshot.usage && (!live.usage || (snapshot.usage.totalTokens || 0) > (live.usage.totalTokens || 0))) {
    patch.usage = snapshot.usage;
  }
  if (snapshot.completedAt !== undefined && live.completedAt === undefined) patch.completedAt = snapshot.completedAt;
  if (snapshot.stopReason && !live.stopReason) patch.stopReason = snapshot.stopReason;
  if (snapshot.errorMessage && !live.errorMessage) patch.errorMessage = snapshot.errorMessage;
  if (live.streaming && snapshot.streaming === false) patch.streaming = false;
  if (Object.keys(patch).length === 0) return live;
  return { ...live, ...patch };
}

/**
 * Keep in-flight SSE/rAF content when a snapshot is shorter or older.
 * Still accepts snapshot metadata (usage, completion) and trailing live messages.
 */
export function adoptSnapshotWithoutRegressing(live: Message[], snapshot: Message[]): Message[] {
  if (live.length === 0) return snapshot;
  if (snapshot.length === 0) return live;
  const liveById = new Map(live.map((message) => [message.id, message]));
  const snapshotIds = new Set(snapshot.map((message) => message.id));
  const snapshotHasUser = snapshot.some((message) => message.role === 'user');
  const merged = snapshot.map((incoming) => {
    const prior = liveById.get(incoming.id);
    if (!prior) return incoming;
    return messageIsStrictlyAhead(prior, incoming) ? mergeSnapshotMetadata(prior, incoming) : incoming;
  });
  const extra = live.filter((message) => {
    if (snapshotIds.has(message.id)) return false;
    if (message.optimistic && snapshotHasUser) return false;
    return true;
  });
  const combined = extra.length > 0 ? [...merged, ...extra] : merged;
  return reuseStableMessages(live, combined);
}

export function isPlaceholderSessionName(name?: string): boolean {
  const value = name?.trim() || '';
  return !value || value === 'New conversation' || value.startsWith('New conversation ·');
}

export function sessionNameFromPrompt(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/, 1)[0] || '';
  if (!line) return '';
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

/** Keep the same Set reference when membership does not change. */
export function applyWorkingSessionIds(
  current: ReadonlySet<string>,
  ids: readonly string[],
  working: boolean,
): ReadonlySet<string> {
  if (ids.length === 0) return current;
  let changed = false;
  const next = new Set(current);
  for (const id of ids) {
    if (working) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    } else if (next.delete(id)) {
      changed = true;
    }
  }
  return changed ? next : current;
}

export type SessionViewExtras = {
  workflowPlan?: WorkflowPlanState;
  workflowProposal?: WorkflowProposalState;
  pendingUserInput?: PendingUserInput;
  collaborationMode?: CollaborationMode;
  model?: ModelOption;
  thinkingLevel?: string;
  thinkingLevels?: string[];
  thinkingOptions?: ThinkingOption[];
  supportsThinking?: boolean;
  contextUsage?: ContextUsage;
  isStreaming?: boolean;
  isCompacting?: boolean;
};

/** In-flight new-chat / project-switch shells that must not be written into the transcript cache. */
export const PROJECT_SWITCH_PENDING_ID = '__project_switch__';
export const NEW_CONVERSATION_PENDING_PREFIX = 'new-conversation:';

export function isTransientSessionId(sessionId?: string): boolean {
  if (!sessionId) return true;
  return sessionId === PROJECT_SWITCH_PENDING_ID || sessionId.startsWith(NEW_CONVERSATION_PENDING_PREFIX);
}

export function pickPreferredProjectSession(
  agents: readonly Agent[],
  lastSessionId?: string,
): Agent | undefined {
  if (lastSessionId) {
    const match = agents.find((agent) => agent.id === lastSessionId);
    if (match) return match;
  }
  return agents[0];
}

/** Transcript cache must be keyed by the session the messages belong to — never the in-flight switch target. */
export function rememberSessionMessages(
  cache: Map<string, Message[]>,
  sessionId: string | undefined,
  messages: Message[],
): void {
  if (!sessionId || isTransientSessionId(sessionId)) return;
  cache.set(sessionId, messages);
}

export type PendingStreamToolUpdate = {
  kind: 'update' | 'end';
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
};

export type PendingStreamBatch = {
  sessionId: string;
  message?: { raw: unknown; streaming: boolean };
  tools: Map<string, PendingStreamToolUpdate>;
};

/** Trailing timeout so the last coalesced SSE frame still flushes if rAF is paused. */
export const STREAM_FLUSH_FALLBACK_MS = 32;

/** Keep a completed tool_execution_end; never let an older partial overwrite it in the same batch. */
export function queuePendingToolUpdate(
  batch: PendingStreamBatch,
  toolCallId: string,
  update: PendingStreamToolUpdate,
): void {
  if (!toolCallId) return;
  const existing = batch.tools.get(toolCallId);
  if (existing?.kind === 'end' && update.kind === 'update') return;
  batch.tools.set(toolCallId, update);
}

/** Main may send SSE envelopes as JSON strings to avoid nested IPC structured clones. */
export function parseMetisIpcEvent(payload: unknown): MetisEvent | undefined {
  if (payload == null) return undefined;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as MetisEvent : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof payload === 'object' ? payload as MetisEvent : undefined;
}

function sameTokenBreakdown(previous: TokenBreakdown | undefined, next: TokenBreakdown): TokenBreakdown {
  if (
    previous
    && previous.input === next.input
    && previous.output === next.output
    && previous.cacheRead === next.cacheRead
    && previous.cacheWrite === next.cacheWrite
    && previous.total === next.total
    && previous.contextWindow === next.contextWindow
    && previous.percent === next.percent
  ) {
    return previous;
  }
  return next;
}

/** Apply one rAF-coalesced stream batch, dropping it after a session switch. */
export function applyStreamBatch(
  messages: Message[],
  batch: PendingStreamBatch,
  activeSessionId: string,
): Message[] {
  if (batch.sessionId && activeSessionId && batch.sessionId !== activeSessionId) {
    return messages;
  }
  let next = messages;
  if (batch.message) {
    const message = toMessage(batch.message.raw, Date.now(), batch.message.streaming);
    if (message) next = upsertConversationMessage(next, message);
  }
  for (const [toolCallId, update] of batch.tools) {
    next = update.kind === 'end'
      ? applyToolExecutionEnd(next, toolCallId, update.result, Boolean(update.isError))
      : applyToolExecutionUpdate(next, toolCallId, update.partialResult);
  }
  return next;
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
  const subagentIndex = buildSubagentProgressIndex(items);
  return items.flatMap((item, index) => {
    const message = toMessage(item, index, false, toolResults);
    if (message?.role === 'assistant' && message.serverTimestamp !== undefined) {
      const completedAt = completionByTimestamp.get(String(message.serverTimestamp));
      if (Number.isFinite(completedAt)) message.completedAt = completedAt;
    }
    if (message?.parts) {
      message.parts = message.parts.map((part) => part.type === 'toolCall' && /^(subagent|spawn_agent)$/i.test(part.name)
        ? { ...part, progress: getSubagentProgress(part, items, subagentIndex) }
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
  const incomingHasText = incoming.some((part) => part.type === 'text');
  const merged: AssistantContentPart[] = [];
  const seen = new Set<string>();
  for (const part of previous) {
    const replacement = incomingById.get(part.id);
    if (replacement) {
      if (part.type === 'toolCall' && replacement.type === 'toolCall') {
        const keepResult = Boolean(part.result && !replacement.result);
        const sameResult = Boolean(
          part.result
          && replacement.result
          && part.result.content === replacement.result.content
          && part.result.isError === replacement.result.isError,
        );
        if (keepResult || sameResult) {
          const nextProgress = replacement.progress ?? part.progress;
          const argsChanged = JSON.stringify(part.arguments ?? null) !== JSON.stringify(replacement.arguments ?? null);
          if (!argsChanged && nextProgress === part.progress) {
            merged.push(part);
          } else {
            merged.push({
              ...part,
              ...(argsChanged ? { arguments: replacement.arguments } : {}),
              ...(nextProgress !== part.progress ? { progress: nextProgress } : {}),
            });
          }
        } else {
          merged.push(replacement.result || !part.result
            ? replacement
            : {
                ...replacement,
                result: part.result,
                progress: replacement.progress ?? part.progress,
              });
        }
      } else if (part.type === 'text' && replacement.type === 'text' && replacement.text === part.text) {
        merged.push(part);
      } else if (part.type === 'thinking' && replacement.type === 'thinking' && replacement.thinking === part.thinking) {
        merged.push(part);
      } else {
        merged.push(replacement);
      }
      seen.add(part.id);
    } else if (
      part.type === 'thinking'
      || part.type === 'toolCall'
      || (part.type === 'text' && !incomingHasText)
    ) {
      merged.push(part);
      seen.add(part.id);
    }
  }
  for (const part of incoming) {
    if (!seen.has(part.id)) merged.push(part);
  }
  if (
    merged.length === previous.length
    && merged.every((part, index) => part === previous[index])
  ) {
    return previous;
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
  const previous = messages[index];
  const merged = incoming.role === 'assistant'
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
    : {
        ...incoming,
        ...((!incoming.attachments || incoming.attachments.length === 0) && previous.attachments?.length
          ? { attachments: previous.attachments }
          : {}),
      };
  if (messagesContentEqual(previous, merged)) return messages;
  const next = [...messages];
  next[index] = merged;
  return next;
}

function responseError(response: MetisResponse<unknown>, fallback: string): Error {
  const data = response.data as { error?: { message?: string } } | undefined;
  return new Error(data?.error?.message || response.error || fallback);
}

export function useMetisServer(activeProject?: ProjectItem) {
  const [agents, setAgents] = useState<Agent[]>([]);
  // Per-project session lists so multiple sidebar folders can stay expanded independently.
  const [projectAgentsByPath, setProjectAgentsByPath] = useState<Record<string, Agent[]>>({});
  const [activeAgentId, setActiveAgentId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesSessionId, setMessagesSessionId] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingSessionIds, setWorkingSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isConnected, setIsConnected] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [workflowPlan, setWorkflowPlan] = useState<WorkflowPlanState>();
  const [workflowProposal, setWorkflowProposal] = useState<WorkflowProposalState>();
  const [pendingUserInput, setPendingUserInput] = useState<PendingUserInput>();
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>('build');
  const [isCompacting, setIsCompacting] = useState(false);
  const [isChangingCollaborationMode, setIsChangingCollaborationMode] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [activeModel, setActiveModel] = useState<ModelOption>();
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [thinkingOptions, setThinkingOptions] = useState<ThinkingOption[]>([]);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [isChangingThinking, setIsChangingThinking] = useState(false);
  const [memoryState, setMemoryState] = useState<MemoryState>();
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const [extensionUiRequests, setExtensionUiRequests] = useState<ExtensionUiRequest[]>([]);
  const [isRespondingToExtensionUi, setIsRespondingToExtensionUi] = useState(false);
  const prevMemoryPhaseRef = useRef<string>();
  const activeProjectRef = useRef(activeProject);
  const agentsRef = useRef<Agent[]>([]);
  const projectAgentsByPathRef = useRef<Record<string, Agent[]>>({});
  const messagesCacheRef = useRef(new Map<string, Message[]>());
  const sessionExtrasCacheRef = useRef(new Map<string, SessionViewExtras>());
  const messagesSessionIdRef = useRef('');
  const sessionExtrasLiveRef = useRef<SessionViewExtras>({});
  const loadVersionRef = useRef(0);
  const messageLoadVersionRef = useRef(0);
  const refreshTimerRef = useRef<number>();
  const activeSessionIdRef = useRef('');
  const serverInstanceIdRef = useRef('');
  const lastServerSequenceRef = useRef(0);
  const extensionUiResponsePendingRef = useRef(false);
  const switchVersionRef = useRef(0);
  const pendingSwitchAgentIdRef = useRef<string | null>(null);
  const lastSessionByProjectRef = useRef(new Map<string, string>());
  const lastActivatedProjectPathRef = useRef('');
  const sessionMutationRef = useRef(Promise.resolve());
  const creatingSessionRef = useRef<Promise<boolean> | null>(null);
  const suppressSessionChangedRef = useRef(false);
  const streamingRef = useRef(false);
  const pendingStreamRef = useRef<PendingStreamBatch | null>(null);
  const streamRafRef = useRef<number | null>(null);
  const streamTimeoutRef = useRef<number | null>(null);
  const flushPendingStreamRef = useRef<() => void>(() => {});

  const clearStreamTimers = () => {
    if (streamRafRef.current !== null) {
      window.cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    if (streamTimeoutRef.current !== null) {
      window.clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
  };

  const clearPendingStream = () => {
    clearStreamTimers();
    pendingStreamRef.current = null;
  };

  const assignStreaming = (value: boolean) => {
    if (streamingRef.current === value) return;
    streamingRef.current = value;
    setIsStreaming(value);
  };

  messagesSessionIdRef.current = messagesSessionId;
  sessionExtrasLiveRef.current = {
    workflowPlan,
    workflowProposal,
    pendingUserInput,
    collaborationMode,
    model: activeModel,
    thinkingLevel,
    thinkingLevels,
    thinkingOptions,
    supportsThinking,
    contextUsage,
    isStreaming,
    isCompacting,
  };

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    projectAgentsByPathRef.current = projectAgentsByPath;
  }, [projectAgentsByPath]);

  useEffect(() => {
    if (isLoadingMessages) return;
    rememberSessionMessages(messagesCacheRef.current, messagesSessionId, messages);
  }, [isLoadingMessages, messages, messagesSessionId]);

  const rememberProjectAgents = useCallback((projectPath: string, nextAgents: Agent[]) => {
    setProjectAgentsByPath((current) => {
      const previous = current[projectPath];
      if (
        previous
        && previous.length === nextAgents.length
        && previous.every((agent, index) => agent === nextAgents[index])
      ) {
        return current;
      }
      return { ...current, [projectPath]: nextAgents };
    });
  }, []);

  const findCachedAgent = useCallback((agentId: string) => {
    const fromActive = agentsRef.current.find((agent) => agent.id === agentId);
    if (fromActive) return fromActive;
    for (const list of Object.values(projectAgentsByPathRef.current)) {
      const found = list.find((agent) => agent.id === agentId);
      if (found) return found;
    }
    return undefined;
  }, []);

  const request = useCallback(async <T,>(path: string, method = 'GET', body?: unknown, timeoutMs?: number): Promise<T> => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.metis?.request) throw new Error('Metis Desktop bridge is unavailable');
    const response = await desktop.metis.request({ path, method, body, timeoutMs }) as MetisResponse<T>;
    if (!response.ok) throw responseError(response, `Request failed (${response.status})`);
    return response.data as T;
  }, []);

  const loadMessages = useCallback(async (expectedSessionId?: string, force = false, knownState?: SessionState) => {
    const version = ++messageLoadVersionRef.current;
    const [state, result, memoryRes] = await Promise.all([
      knownState ? Promise.resolve(knownState) : request<SessionState>('/session'),
      request<SessionMessagesResponse>('/session/messages'),
      request<MemoryState>('/memory').catch(() => undefined),
    ]);
    if (version !== messageLoadVersionRef.current) return;
    if (
      pendingSwitchAgentIdRef.current
      && pendingSwitchAgentIdRef.current !== state.sessionId
      && pendingSwitchAgentIdRef.current !== expectedSessionId
    ) return;
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
      const sameSession = Boolean(state.sessionId) && messagesSessionIdRef.current === state.sessionId;
      const live = sameSession ? current : [];
      const optimisticUser = live.find((msg) => msg.role === 'user' && msg.optimistic);
      const withOptimistic = optimisticUser && !nextMessages.some((msg) => msg.role === 'user')
        ? [optimisticUser, ...nextMessages]
        : nextMessages;
      const reused = sameSession
        ? adoptSnapshotWithoutRegressing(live, withOptimistic)
        : withOptimistic;
      rememberSessionMessages(messagesCacheRef.current, state.sessionId, reused);
      return reused;
    });
    setMessagesSessionId(state.sessionId || '');
    let latestUserPrompt: string | undefined;
    for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
      if (nextMessages[index].role === 'user' && typeof nextMessages[index].content === 'string') {
        const trimmed = revealPromptForDisplay(nextMessages[index].content.trim());
        if (trimmed) {
          latestUserPrompt = trimmed;
          break;
        }
      }
    }
    if (state.sessionId && latestUserPrompt) {
      setAgents((current) => current.map((agent) => (
        (agent.id === state.sessionId || (state.sessionFile && agent.sessionPath === state.sessionFile))
          ? { ...agent, subtitle: latestUserPrompt! }
          : agent
      )));
    }
    const nextStreaming = Boolean(state.isStreaming);
    const nextCompacting = Boolean(state.isCompacting);
    assignStreaming(nextStreaming);
    setIsCompacting(nextCompacting);
    const loadedSessionId = state.sessionId || expectedSessionId || '';
    if (loadedSessionId) {
      const workingIds = [loadedSessionId];
      if (state.sessionFile) {
        const agent = agentsRef.current.find((entry) => entry.sessionPath === state.sessionFile);
        if (agent && agent.id !== loadedSessionId) workingIds.push(agent.id);
      }
      setWorkingSessionIds((current) => applyWorkingSessionIds(current, workingIds, nextStreaming || nextCompacting));
    }
    setCollaborationMode(state.collaborationMode || 'build');
    setWorkflowPlan(state.workflowPlan);
    setWorkflowProposal(state.workflowProposal);
    setPendingUserInput(state.pendingUserInput);
    setActiveModel(state.model);
    setThinkingLevel(state.thinkingLevel || '');
    setThinkingLevels(Array.isArray(state.thinkingLevels) ? state.thinkingLevels : []);
    setThinkingOptions(Array.isArray(state.thinkingOptions) ? state.thinkingOptions : (state.thinkingLevels || []).map((id) => ({ id, label: id, value: id })));
    setSupportsThinking(Boolean(state.supportsThinking));
    if (state.sessionId) {
      setActiveAgentId(state.sessionId);
      sessionExtrasCacheRef.current.set(state.sessionId, {
        workflowPlan: state.workflowPlan,
        workflowProposal: state.workflowProposal,
        pendingUserInput: state.pendingUserInput,
        collaborationMode: state.collaborationMode || 'build',
        model: state.model,
        thinkingLevel: state.thinkingLevel || '',
        thinkingLevels: Array.isArray(state.thinkingLevels) ? state.thinkingLevels : [],
        thinkingOptions: Array.isArray(state.thinkingOptions) ? state.thinkingOptions : (state.thinkingLevels || []).map((id) => ({ id, label: id, value: id })),
        supportsThinking: Boolean(state.supportsThinking),
        contextUsage: state.contextUsage,
        isStreaming: nextStreaming,
        isCompacting: nextCompacting,
      });
    }
  }, [request]);

  const tokenBreakdownRef = useRef<TokenBreakdown>();
  const tokenBreakdown = useMemo<TokenBreakdown | undefined>(() => {
    const contextWindow = contextUsage?.contextWindow || 256_000;
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

    const next = {
      input,
      output,
      cacheRead,
      cacheWrite,
      total,
      contextWindow,
      percent,
    };
    const reused = sameTokenBreakdown(tokenBreakdownRef.current, next);
    tokenBreakdownRef.current = reused;
    return reused;
  }, [messages, contextUsage]);

  const loadProject = useCallback(async (
    project: ProjectItem,
    switchWhenNeeded = true,
    preferredSessionId?: string,
  ) => {
    const pending = pendingSwitchAgentIdRef.current;
    const ownsNavigation = Boolean(
      (preferredSessionId && pending === preferredSessionId)
      || pending === PROJECT_SWITCH_PENDING_ID,
    );
    if (pending && !ownsNavigation) switchWhenNeeded = false;
    const version = ++loadVersionRef.current;
    const hasCachedList = Boolean(projectAgentsByPathRef.current[project.path]?.length);
    if (!hasCachedList) setIsLoadingSessions(true);
    setSessionError('');
    try {
      const result = await request<SessionListResponse>(`/sessions?cwd=${encodeURIComponent(project.path)}`, 'GET', undefined, 60_000);
      if (!Array.isArray(result.sessions)) throw new Error('Invalid session list response');
      if (version !== loadVersionRef.current) return;

      let state = await request<SessionState>('/session');
      const preferredPath = preferredSessionId
        ? result.sessions.find((session) => session.id === preferredSessionId)?.path
        : undefined;
      const current = result.sessions.find((session) => session.path === state.sessionFile);
      const preferredMismatch = Boolean(preferredPath && state.sessionFile !== preferredPath);
      if (switchWhenNeeded && (!pathsEqual(state.cwd, project.path) || !current || preferredMismatch)) {
        const destination = preferredPath || result.sessions[0]?.path;
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
      rememberProjectAgents(project.path, nextAgents);

      if (pendingSwitchAgentIdRef.current && !ownsNavigation) return;

      const isCurrentProjectSession = Boolean(state.sessionId && nextAgents.some((agent) => agent.id === state.sessionId));
      const nextSessionId = preferredSessionId && nextAgents.some((agent) => agent.id === preferredSessionId)
        ? preferredSessionId
        : isCurrentProjectSession
          ? (state.sessionId || nextAgents[0]?.id || '')
          : (nextAgents.some((agent) => agent.id === activeSessionIdRef.current)
            ? activeSessionIdRef.current
            : (nextAgents[0]?.id || ''));
      const alreadyShowing = Boolean(
        nextSessionId
        && (nextSessionId === messagesSessionIdRef.current || nextSessionId === activeSessionIdRef.current)
      );
      const hadCachedView = Boolean(nextSessionId && messagesCacheRef.current.has(nextSessionId));
      activeSessionIdRef.current = nextSessionId;
      setActiveAgentId(nextSessionId);
      if (nextSessionId && !isTransientSessionId(nextSessionId)) {
        lastSessionByProjectRef.current.set(project.path, nextSessionId);
        messagesSessionIdRef.current = nextSessionId;
      }
      if (ownsNavigation && nextSessionId && pendingSwitchAgentIdRef.current === PROJECT_SWITCH_PENDING_ID) {
        pendingSwitchAgentIdRef.current = nextSessionId;
      }
      if (ownsNavigation) {
        const snapshot = loadMessages(nextSessionId || undefined, true, state);
        if (!hadCachedView) await snapshot;
        else void snapshot;
      } else if (!alreadyShowing) {
        await loadMessages(nextSessionId || undefined);
      }
    } catch (error) {
      if (version !== loadVersionRef.current) return;
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === loadVersionRef.current) setIsLoadingSessions(false);
    }
  }, [loadMessages, rememberProjectAgents, request]);

  const prefetchProjectSessions = useCallback(async (project: ProjectItem) => {
    if (!project?.path) return;
    try {
      const result = await request<SessionListResponse>(`/sessions?cwd=${encodeURIComponent(project.path)}`, 'GET', undefined, 60_000);
      if (!Array.isArray(result.sessions)) return;
      rememberProjectAgents(project.path, result.sessions.map(sessionToAgent));
    } catch {
      // Prefetch is best-effort; expanding still works with an empty/loading list.
    }
  }, [rememberProjectAgents, request]);

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
      if (options) {
        if (project) await loadProject(project, true);
        else await loadMessages(activeSessionIdRef.current || undefined);
      } else if (!project) {
        await loadMessages(activeSessionIdRef.current || undefined);
      }
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

    const flushPendingStream = () => {
      clearStreamTimers();
      const pending = pendingStreamRef.current;
      pendingStreamRef.current = null;
      if (!pending) return;
      setMessages((current) => applyStreamBatch(current, pending, activeSessionIdRef.current));
    };
    flushPendingStreamRef.current = flushPendingStream;

    const scheduleStreamBatch = (mutate: (pending: PendingStreamBatch) => void) => {
      const sessionId = activeSessionIdRef.current;
      if (!pendingStreamRef.current || pendingStreamRef.current.sessionId !== sessionId) {
        pendingStreamRef.current = { sessionId, tools: new Map() };
      }
      mutate(pendingStreamRef.current);
      if (streamRafRef.current === null) {
        streamRafRef.current = window.requestAnimationFrame(() => {
          streamRafRef.current = null;
          flushPendingStream();
        });
      }
      if (streamTimeoutRef.current === null) {
        streamTimeoutRef.current = window.setTimeout(() => {
          streamTimeoutRef.current = null;
          flushPendingStream();
        }, STREAM_FLUSH_FALLBACK_MS);
      }
    };

    const resolveWorkingSessionIds = (event: MetisEvent): string[] => {
      const sessionId = typeof event.serverSessionId === 'string' ? event.serverSessionId : '';
      if (!sessionId) return [];
      const ids = new Set<string>([sessionId]);
      const sessionFile = typeof (event as { sessionFile?: unknown }).sessionFile === 'string'
        ? (event as { sessionFile: string }).sessionFile
        : '';
      for (const agent of agentsRef.current) {
        if (agent.id === sessionId || (sessionFile && agent.sessionPath === sessionFile)) {
          ids.add(agent.id);
        }
      }
      return Array.from(ids);
    };

    const markSessionsWorking = (event: MetisEvent, working: boolean) => {
      const ids = resolveWorkingSessionIds(event);
      if (ids.length === 0) return;
      setWorkingSessionIds((current) => applyWorkingSessionIds(current, ids, working));
    };

    const unsubscribeEvent = desktop.metis.onEvent((payload: unknown) => {
      const event = parseMetisIpcEvent(payload);
      if (!event) return;
      const type = event?.type || '';
      // Track per-session working state before acceptsEvent filters other sessions.
      if (['message_start', 'message_update', 'agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end', 'tool_execution_update'].includes(type)) {
        markSessionsWorking(event, true);
      } else if (type === 'agent_end' && !event.willRetry) {
        markSessionsWorking(event, false);
      }
      if (!acceptsEvent(event)) return;
      if (type !== 'message_update' && type !== 'tool_execution_update'
        && ['server.connected', 'message_start', 'message_end', 'agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end', 'user_input_request', 'session_info_changed'].includes(type)) {
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
          const interactiveRequest = toExtensionUiRequest(event as Record<string, unknown>);
          if (!interactiveRequest) return;
          setExtensionUiRequests((current) => (
            current.some((queued) => queued.id === interactiveRequest.id)
              ? current
              : [...current, interactiveRequest]
          ));
        })().catch((error) => setSessionError(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (type === 'server.connected') {
        setIsConnected(true);
        return;
      }
      if (type === 'message_start' || type === 'message_update' || type === 'message_end') {
        const isEnd = type === 'message_end';
        if (isEnd) {
          flushPendingStream();
          const message = toMessage(event.message, Date.now(), false);
          if (message) setMessages((current) => upsertConversationMessage(current, message));
        } else {
          scheduleStreamBatch((pending) => {
            pending.message = { raw: event.message, streaming: true };
          });
        }
        if (!isEnd) assignStreaming(true);
        // Streaming updates stay incremental — full snapshot only on agent_end / switch / explicit refresh.
        return;
      }
      if (type === 'tool_execution_update') {
        assignStreaming(true);
        const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
        if (toolCallId) {
          scheduleStreamBatch((pending) => {
            queuePendingToolUpdate(pending, toolCallId, { kind: 'update', partialResult: event.partialResult });
          });
        }
        return;
      }
      if (type === 'tool_execution_end') {
        assignStreaming(true);
        const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
        if (toolCallId) {
          flushPendingStream();
          setMessages((current) => applyToolExecutionEnd(current, toolCallId, event.result, Boolean(event.isError)));
        }
        return;
      }
      if (['agent_start', 'turn_start', 'tool_execution_start'].includes(type)) {
        assignStreaming(true);
        return;
      }
      if (type === 'agent_end') {
        flushPendingStream();
        if (!event.willRetry) assignStreaming(false);
        reconcileCurrentSession();
        const project = activeProjectRef.current;
        if (project) void loadProject(project, false);
        return;
      }
      if (type === 'server.session_changed') {
        // Ignore the broadcast from our own /session/switch or /session/new — selectConversation
        // already loads messages; a second loadProject+loadMessages causes switch jank.
        if (suppressSessionChangedRef.current || pendingSwitchAgentIdRef.current) return;
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
        const nextPlan = workflowPlanFromCustomEntry(event.entry);
        if (nextPlan === null) setWorkflowPlan(undefined);
        else if (nextPlan) setWorkflowPlan(nextPlan);
        reconcileCurrentSession();
        return;
      }
      if (type === 'session_info_changed' || (type === 'session_name_generation' && event.status === 'completed')) {
        const generatedName = cleanPastedText(event.name?.trim() || '').trim();
        if (generatedName) {
          setAgents((current) => current.map((agent) => (
            agent.id === activeSessionIdRef.current ? { ...agent, name: generatedName } : agent
          )));
          const projectPath = activeProjectRef.current?.path;
          if (projectPath) {
            setProjectAgentsByPath((current) => {
              const list = current[projectPath];
              if (!list) return current;
              return {
                ...current,
                [projectPath]: list.map((agent) => (
                  agent.id === activeSessionIdRef.current ? { ...agent, name: generatedName } : agent
                )),
              };
            });
          }
        }
        if (type === 'session_info_changed' && event.session) void refreshModels();
        return;
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
      flushPendingStream();
      setIsConnected(false);
      assignStreaming(false);
      setWorkingSessionIds(new Set());
      lastActivatedProjectPathRef.current = '';
    });
    const unsubscribeServerReady = desktop.metis.onServerReady?.(() => {
      void connect();
    });

    return () => {
      disposed = true;
      clearPendingStream();
      window.clearTimeout(refreshTimerRef.current);
      unsubscribeEvent?.();
      unsubscribeDisconnect?.();
      unsubscribeServerReady?.();
    };
  }, [connectServer, loadProject, request]);

  const refreshModels = useCallback(async () => {
    try {
      const result = await request<ProviderModelsResponse>('/config/providers');
      const nextModels = Array.isArray(result.models) ? result.models : [];
      setModels(nextModels);
      setProviderCatalog(Array.isArray(result.providers) ? result.providers : []);
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
      setProviderCatalog([]);
      return;
    }
    void refreshModels();
  }, [isConnected, refreshModels]);

  const applySessionExtras = (extras: SessionViewExtras | undefined) => {
    setWorkflowPlan(extras?.workflowPlan);
    setWorkflowProposal(extras?.workflowProposal);
    setPendingUserInput(extras?.pendingUserInput);
    if (extras?.collaborationMode) setCollaborationMode(extras.collaborationMode);
    if (extras) setActiveModel(extras.model);
    if (extras?.thinkingLevel !== undefined) setThinkingLevel(extras.thinkingLevel);
    if (extras?.thinkingLevels) setThinkingLevels(extras.thinkingLevels);
    if (extras?.thinkingOptions) setThinkingOptions(extras.thinkingOptions);
    if (extras?.supportsThinking !== undefined) setSupportsThinking(extras.supportsThinking);
    if (extras) setContextUsage(extras.contextUsage);
    assignStreaming(Boolean(extras?.isStreaming));
    setIsCompacting(Boolean(extras?.isCompacting));
  };

  const enqueueSessionMutation = <T,>(task: () => Promise<T>) => {
    const run = sessionMutationRef.current.then(task, task);
    sessionMutationRef.current = run.then(() => undefined, () => undefined);
    return run;
  };

  const beginPendingSessionView = (agentId: string, mode: 'cached' | 'empty' | 'loading'): boolean => {
    const outgoingId = messagesSessionIdRef.current;
    if (outgoingId && !isTransientSessionId(outgoingId)) {
      sessionExtrasCacheRef.current.set(outgoingId, sessionExtrasLiveRef.current);
      const previousPath = activeProjectRef.current?.path;
      if (previousPath) lastSessionByProjectRef.current.set(previousPath, outgoingId);
    }
    pendingSwitchAgentIdRef.current = agentId;
    suppressSessionChangedRef.current = true;
    messageLoadVersionRef.current += 1;
    clearPendingStream();
    setActiveAgentId(agentId);
    activeSessionIdRef.current = agentId;
    const useCached = mode === 'cached' && messagesCacheRef.current.has(agentId);
    const cachedMessages = useCached ? messagesCacheRef.current.get(agentId) : undefined;
    const cachedExtras = useCached ? sessionExtrasCacheRef.current.get(agentId) : undefined;
    if (useCached && cachedMessages) {
      setMessages(cachedMessages);
      messagesSessionIdRef.current = agentId;
      setMessagesSessionId(agentId);
      applySessionExtras(cachedExtras);
      setIsLoadingMessages(false);
      return true;
    }
    setMessages([]);
    messagesSessionIdRef.current = agentId;
    setMessagesSessionId(agentId);
    applySessionExtras(undefined);
    setIsLoadingMessages(mode === 'loading');
    return false;
  };

  const selectConversation = useCallback(async (agentId: string) => {
    const agent = findCachedAgent(agentId);
    if (!agent?.sessionPath) return;
    if (agentId === activeSessionIdRef.current || agentId === pendingSwitchAgentIdRef.current) return;
    const previousAgentId = activeSessionIdRef.current;
    const hadCachedView = beginPendingSessionView(agentId, messagesCacheRef.current.has(agentId) ? 'cached' : 'loading');
    const cachedMessages = messagesCacheRef.current.get(agentId);
    const cachedExtras = sessionExtrasCacheRef.current.get(agentId);
    if (agent.projectPath) lastActivatedProjectPathRef.current = agent.projectPath;
    setSessionError('');
    const currentSwitchVersion = ++switchVersionRef.current;
    try {
      await enqueueSessionMutation(async () => {
        if (currentSwitchVersion !== switchVersionRef.current) return;
        const switchResult = await request<SessionState & { cancelled: boolean }>('/session/switch', 'POST', { sessionPath: agent.sessionPath });
        if (currentSwitchVersion !== switchVersionRef.current) return;
        pendingSwitchAgentIdRef.current = null;
        const targetSessionId = switchResult.sessionId || agentId;
        activeSessionIdRef.current = targetSessionId;
        messagesSessionIdRef.current = targetSessionId;
        setActiveAgentId(targetSessionId);
        if (targetSessionId !== agentId && cachedMessages) {
          rememberSessionMessages(messagesCacheRef.current, targetSessionId, cachedMessages);
          if (cachedExtras) sessionExtrasCacheRef.current.set(targetSessionId, cachedExtras);
        }
        setMessagesSessionId(targetSessionId);
        if (switchResult.pendingUserInput !== undefined) {
          setPendingUserInput(switchResult.pendingUserInput);
        } else if (!hadCachedView) {
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
        assignStreaming(Boolean(switchResult.isStreaming));
        setIsCompacting(Boolean(switchResult.isCompacting));
        const snapshot = loadMessages(targetSessionId, true, switchResult);
        if (!hadCachedView) await snapshot;
        else void snapshot;
      });
    } catch (error) {
      if (currentSwitchVersion === switchVersionRef.current) {
        pendingSwitchAgentIdRef.current = null;
        activeSessionIdRef.current = previousAgentId;
        setActiveAgentId(previousAgentId);
        setSessionError(error instanceof Error ? error.message : String(error));
        const previousCached = previousAgentId ? messagesCacheRef.current.get(previousAgentId) : undefined;
        if (previousCached) {
          setMessages(previousCached);
          messagesSessionIdRef.current = previousAgentId;
          setMessagesSessionId(previousAgentId);
          applySessionExtras(sessionExtrasCacheRef.current.get(previousAgentId));
        }
        if (previousAgentId) void loadMessages(previousAgentId, true);
      }
    } finally {
      if (currentSwitchVersion === switchVersionRef.current) {
        pendingSwitchAgentIdRef.current = null;
        suppressSessionChangedRef.current = false;
        setIsLoadingMessages(false);
      }
    }
  }, [findCachedAgent, loadMessages, request]);

  const newConversation = useCallback(async () => {
    const project = activeProjectRef.current;
    if (!project) return false;
    if (creatingSessionRef.current) return creatingSessionRef.current;

    const optimisticId = `${NEW_CONVERSATION_PENDING_PREFIX}${Date.now()}`;
    const currentSwitchVersion = ++switchVersionRef.current;
    setSessionError('');
    beginPendingSessionView(optimisticId, 'empty');
    const placeholder: Agent = {
      ...EMPTY_AGENT,
      id: optimisticId,
      name: 'New conversation',
      projectPath: project.path,
    };
    const withPlaceholder = [placeholder, ...agentsRef.current.filter((agent) => agent.id !== optimisticId)];
    setAgents(withPlaceholder);
    rememberProjectAgents(project.path, withPlaceholder);

    const created = (async () => {
      try {
        const ok = await enqueueSessionMutation(async () => {
          if (currentSwitchVersion !== switchVersionRef.current) return false;
          const state = await request<SessionState>('/session/new', 'POST', { cwd: project.path, collaborationMode: 'build' });
          if (currentSwitchVersion !== switchVersionRef.current) return false;
          const realId = state.sessionId || '';
          const realAgent: Agent = {
            ...EMPTY_AGENT,
            id: realId,
            name: state.sessionName?.trim() || 'New conversation',
            sessionPath: state.sessionFile,
            projectPath: project.path,
          };
          pendingSwitchAgentIdRef.current = realId;
          activeSessionIdRef.current = realId;
          messagesSessionIdRef.current = realId;
          setActiveAgentId(realId);
          setMessagesSessionId(realId);
          setMessages([]);
          rememberSessionMessages(messagesCacheRef.current, realId, []);
          if (realId) lastSessionByProjectRef.current.set(project.path, realId);
          const withReal = [realAgent, ...agentsRef.current.filter((agent) => (
            agent.id !== optimisticId && agent.id !== realId
          ))];
          setAgents(withReal);
          rememberProjectAgents(project.path, withReal);
          applySessionExtras({
            collaborationMode: state.collaborationMode || 'build',
            model: state.model,
            thinkingLevel: state.thinkingLevel || '',
            thinkingLevels: Array.isArray(state.thinkingLevels) ? state.thinkingLevels : [],
            thinkingOptions: Array.isArray(state.thinkingOptions)
              ? state.thinkingOptions
              : (state.thinkingLevels || []).map((id) => ({ id, label: id, value: id })),
            supportsThinking: Boolean(state.supportsThinking),
            workflowPlan: state.workflowPlan,
            workflowProposal: state.workflowProposal,
            pendingUserInput: state.pendingUserInput,
            contextUsage: state.contextUsage,
            isStreaming: Boolean(state.isStreaming),
            isCompacting: Boolean(state.isCompacting),
          });
          void loadProject(project, false);
          return true;
        });
        return ok === true;
      } catch (error) {
        if (currentSwitchVersion === switchVersionRef.current) {
          setSessionError(error instanceof Error ? error.message : String(error));
        }
        return false;
      } finally {
        if (creatingSessionRef.current === created) creatingSessionRef.current = null;
        if (currentSwitchVersion === switchVersionRef.current) {
          pendingSwitchAgentIdRef.current = null;
          suppressSessionChangedRef.current = false;
          setIsLoadingMessages(false);
        }
      }
    })();

    creatingSessionRef.current = created;
    return created;
  }, [loadProject, rememberProjectAgents, request]);

  const selectProject = useCallback(async (project: ProjectItem) => {
    if (!project?.path) return;
    const previousPath = activeProjectRef.current?.path;
    const previousSession = messagesSessionIdRef.current || activeSessionIdRef.current;
    if (
      previousPath
      && previousSession
      && previousPath !== project.path
      && !isTransientSessionId(previousSession)
    ) {
      lastSessionByProjectRef.current.set(previousPath, previousSession);
    }

    let cachedAgents = projectAgentsByPathRef.current[project.path] || [];
    if (cachedAgents.length === 0) {
      for (const [key, list] of Object.entries(projectAgentsByPathRef.current)) {
        if (pathsEqual(key, project.path) && list.length) {
          cachedAgents = list;
          break;
        }
      }
    }
    const lastId = lastSessionByProjectRef.current.get(project.path);
    const preferred = pickPreferredProjectSession(cachedAgents, lastId);

    if (
      lastActivatedProjectPathRef.current === project.path
      && preferred
      && (preferred.id === activeSessionIdRef.current || preferred.id === messagesSessionIdRef.current)
      && !pendingSwitchAgentIdRef.current
    ) {
      return;
    }

    lastActivatedProjectPathRef.current = project.path;
    const currentSwitchVersion = ++switchVersionRef.current;
    setSessionError('');

    if (preferred) {
      beginPendingSessionView(
        preferred.id,
        messagesCacheRef.current.has(preferred.id) ? 'cached' : 'loading',
      );
      if (cachedAgents.length) setAgents(cachedAgents);
      lastSessionByProjectRef.current.set(project.path, preferred.id);
      try {
        await loadProject(project, true, preferred.id);
        if (currentSwitchVersion !== switchVersionRef.current) return;
      } catch (error) {
        if (currentSwitchVersion === switchVersionRef.current) {
          setSessionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (currentSwitchVersion === switchVersionRef.current) {
          pendingSwitchAgentIdRef.current = null;
          suppressSessionChangedRef.current = false;
          setIsLoadingMessages(false);
        }
      }
      return;
    }

    beginPendingSessionView(PROJECT_SWITCH_PENDING_ID, 'loading');
    try {
      await loadProject(project, true);
      if (currentSwitchVersion !== switchVersionRef.current) return;
    } catch (error) {
      if (currentSwitchVersion === switchVersionRef.current) {
        setSessionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (currentSwitchVersion === switchVersionRef.current) {
        pendingSwitchAgentIdRef.current = null;
        suppressSessionChangedRef.current = false;
        setIsLoadingMessages(false);
      }
    }
  }, [loadProject]);

  const activeProjectPath = activeProject?.path;
  useEffect(() => {
    if (!isConnected || !activeProjectPath) return;
    if (pendingSwitchAgentIdRef.current) return;
    if (lastActivatedProjectPathRef.current === activeProjectPath) return;
    const project = activeProjectRef.current;
    if (!project) return;
    void selectProject(project);
  }, [activeProjectPath, isConnected, selectProject]);

  const sendMessage = useCallback(async (text: string, options: SendMessageOptions = {}) => {
    if (
      creatingSessionRef.current
      && pendingSwitchAgentIdRef.current?.startsWith(NEW_CONVERSATION_PENDING_PREFIX)
    ) {
      const created = await creatingSessionRef.current;
      if (!created) return false;
    }
    const wireMessage = rewritePromptForModel(cleanPastedText(text));
    const userText = revealPromptForDisplay(cleanPastedText(options.displayText ?? text));
    const optimistic: Message = {
      id: `optimistic-user-${Date.now()}`,
      role: 'user',
      content: userText,
      optimistic: true,
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    };
    setMessages((current) => [...current, optimistic]);
    assignStreaming(true);
    const activeId = activeSessionIdRef.current;
    if (activeId) {
      setWorkingSessionIds((current) => applyWorkingSessionIds(current, [activeId], true));
    }
    const promptText = userText.trim();
    if (promptText && activeId) {
      const previewName = sessionNameFromPrompt(promptText);
      const patchAgent = (agent: Agent): Agent => {
        if (agent.id !== activeId) return agent;
        const nextName = previewName && isPlaceholderSessionName(agent.name) ? previewName : agent.name;
        if (agent.subtitle === promptText && agent.name === nextName) return agent;
        return { ...agent, subtitle: promptText, name: nextName };
      };
      setAgents((current) => current.map(patchAgent));
      const projectPath = activeProjectRef.current?.path;
      if (projectPath) {
        setProjectAgentsByPath((current) => {
          const list = current[projectPath];
          if (!list) return current;
          const next = list.map(patchAgent);
          return next.every((item, index) => item === list[index]) ? current : { ...current, [projectPath]: next };
        });
      }
    }
    try {
      await request('/session/prompt', 'POST', {
        message: wireMessage,
        ...(options.images?.length ? { images: options.images } : {}),
        ...(options.workflowAction ? { workflowAction: options.workflowAction } : {}),
      }, 120_000);
      await loadMessages(activeSessionIdRef.current || undefined, true);
      return true;
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setSessionError(error instanceof Error ? error.message : String(error));
      assignStreaming(false);
      if (activeId) {
        setWorkingSessionIds((current) => applyWorkingSessionIds(current, [activeId], false));
      }
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

  const removeConversation = useCallback((sessionId: string) => {
    if (!sessionId) return;
    setAgents((current) => {
      const next = current.filter((agent) => agent.id !== sessionId);
      return next.length === current.length ? current : next;
    });
    setProjectAgentsByPath((current) => {
      let changed = false;
      const next: Record<string, Agent[]> = {};
      for (const [projectPath, list] of Object.entries(current)) {
        const filtered = list.filter((agent) => agent.id !== sessionId);
        next[projectPath] = filtered;
        if (filtered.length !== list.length) changed = true;
      }
      return changed ? next : current;
    });
  }, []);

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
    flushPendingStreamRef.current();
    assignStreaming(false);
    const activeId = activeSessionIdRef.current;
    if (activeId) {
      setWorkingSessionIds((current) => applyWorkingSessionIds(current, [activeId], false));
    }
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

  const respondToExtensionUi = useCallback(async (response: ExtensionUiResponse) => {
    const activeRequest = extensionUiRequests[0];
    if (!activeRequest || response.id !== activeRequest.id || extensionUiResponsePendingRef.current) return false;
    extensionUiResponsePendingRef.current = true;
    setIsRespondingToExtensionUi(true);
    setSessionError('');
    try {
      await request('/extension/ui-response', 'POST', response);
      setExtensionUiRequests((current) => (
        current[0]?.id === response.id
          ? current.slice(1)
          : current.filter((queued) => queued.id !== response.id)
      ));
      return true;
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      extensionUiResponsePendingRef.current = false;
      setIsRespondingToExtensionUi(false);
    }
  }, [extensionUiRequests, request]);

  return {
    agents,
    projectAgentsByPath,
    prefetchProjectSessions,
    activeAgent,
    activeAgentId,
    messagesSessionId,
    messages,
    sendMessage,
    abortTurn,
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
    memoryState,
    runMemory,
    abortMemory,
    refreshMemory,
    request,
    refresh,
    removeConversation,
    connectServer,
    selectConversation,
    selectProject,
    newConversation,
    processProposal,
    refineProposal,
    respondToUserInput,
    extensionUiRequest: extensionUiRequests[0],
    isRespondingToExtensionUi,
    respondToExtensionUi,
    contextUsage,
    tokenBreakdown,
  };
}
