import { AssistantContentPart, Message } from '../types';
import { extractToolResultText } from './tool-execution-update';

export interface SubagentItem {
  id: string;
  agentId?: string;
  role: string;
  task: string;
  context?: string;
  mode?: 'sync' | 'async';
  worktree?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  rawOutput?: string;
  result?: string;
  error?: string;
  exitCode?: number | null;
  parts: AssistantContentPart[];
}

export type SubagentHistory = Record<string, SubagentItem[]>;

export const SUBAGENT_HISTORY_STORAGE_KEY = 'metis.desktop.subagentHistory.v1';

function isSubagentStatus(value: unknown): value is SubagentItem['status'] {
  return value === 'running' || value === 'completed' || value === 'failed';
}

function hasRawLifecycleTranscript(parts: AssistantContentPart[]): boolean {
  return parts.some((part) => part.type === 'text' && (
    part.text.includes('{"type":"message_start"')
    || part.text.includes('{"type":"message_update"')
    || part.text.includes('{"type":"message_end"')
  ));
}

function normalizePersistedSubagentItem(item: SubagentItem): SubagentItem {
  if (!item.rawOutput || !hasRawLifecycleTranscript(item.parts)) return item;
  const parts = parseSubagentOutputToParts(item.id, item.rawOutput);
  return parts.length > 0 && !hasRawLifecycleTranscript(parts) ? { ...item, parts } : item;
}

export function parseSubagentHistory(raw: string | null | undefined): SubagentHistory {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const history: SubagentHistory = {};
    for (const [sessionId, value] of Object.entries(parsed)) {
      if (!sessionId || !Array.isArray(value)) continue;
      const items = value.filter((item): item is SubagentItem => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as SubagentItem).id === 'string'
        && typeof (item as SubagentItem).role === 'string'
        && typeof (item as SubagentItem).task === 'string'
        && isSubagentStatus((item as SubagentItem).status)
        && Array.isArray((item as SubagentItem).parts)
      )).map(normalizePersistedSubagentItem);
      if (items.length > 0) history[sessionId] = items;
    }
    return history;
  } catch {
    return {};
  }
}

function serializedWeight(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function richerText(current: string | undefined, cached: string | undefined): string | undefined {
  if (!current) return cached;
  if (!cached) return current;
  return current.length >= cached.length ? current : cached;
}

function mergeSubagentItem(cached: SubagentItem, current: SubagentItem): SubagentItem {
  const normalizedCached = normalizePersistedSubagentItem(cached);
  const currentTerminal = current.status !== 'running';
  const cachedTerminal = normalizedCached.status !== 'running';
  const status = currentTerminal ? current.status : cachedTerminal ? normalizedCached.status : current.status;
  const currentPartsWeight = serializedWeight(current.parts);
  const cachedPartsWeight = serializedWeight(normalizedCached.parts);
  const durationCandidates = [normalizedCached.durationMs, current.durationMs]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return {
    ...normalizedCached,
    ...current,
    status,
    startedAt: current.startedAt ?? normalizedCached.startedAt,
    completedAt: current.completedAt ?? normalizedCached.completedAt,
    durationMs: durationCandidates.length > 0 ? Math.max(...durationCandidates) : undefined,
    rawOutput: richerText(current.rawOutput, normalizedCached.rawOutput),
    result: currentTerminal && current.result ? current.result : richerText(current.result, normalizedCached.result),
    error: current.error ?? normalizedCached.error,
    parts: currentPartsWeight >= cachedPartsWeight ? current.parts : normalizedCached.parts,
  };
}

export function mergeSubagentHistoryItems(
  cachedItems: SubagentItem[],
  currentItems: SubagentItem[],
): SubagentItem[] {
  const cachedById = new Map(cachedItems.map((item) => [item.id, item]));
  const currentIds = new Set(currentItems.map((item) => item.id));
  return [
    ...currentItems.map((item) => {
      const cached = cachedById.get(item.id);
      return cached ? mergeSubagentItem(cached, item) : item;
    }),
    ...cachedItems.filter((item) => !currentIds.has(item.id)),
  ];
}

function parsePayload(content: string): {
  status?: string;
  agent?: string;
  agentId?: string;
  result?: string;
  error?: string;
  exitCode?: number | null;
  worktree?: string;
  provider?: string;
  model?: string;
  elapsedSec?: number;
  parts?: unknown[];
} | undefined {
  if (!content || typeof content !== 'string') return undefined;
  try {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    }
    if (trimmed.includes('\n')) {
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === 'object' && (parsed.status || parsed.result || parsed.parts)) {
              return parsed;
            }
          } catch {}
        }
      }
    }
  } catch {}
  return undefined;
}

function parseToolResultPayload(content: string): Record<string, unknown> | undefined {
  if (!content.trim()) return undefined;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function isToolResultError(content: string, explicitError: unknown): boolean {
  if (explicitError === true) return true;
  const payload = parseToolResultPayload(content);
  return payload?.isError === true || payload?.status === 'error' || payload?.status === 'timed_out';
}

function inferToolArguments(content: string): Record<string, unknown> {
  const payload = parseToolResultPayload(content);
  if (!payload) return {};
  const args: Record<string, unknown> = {};
  if (typeof payload.agent === 'string') args.agent = payload.agent;
  if (typeof payload.task === 'string') args.task = payload.task;
  if (payload.mode === 'sync' || payload.mode === 'async') args.mode = payload.mode;
  if (typeof payload.worktree === 'string') args.worktree = payload.worktree;
  return args;
}

export function sanitizeSubagentParts(subagentId: string, rawParts: unknown[]): AssistantContentPart[] {
  if (!Array.isArray(rawParts) || rawParts.length === 0) return [];
  const parts: AssistantContentPart[] = [];
  let partIndex = 0;

  for (const raw of rawParts) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, any>;
    const type = String(item.type || '');

    if (type === 'thinking') {
      parts.push({
        type: 'thinking',
        id: item.id || `${subagentId}-thinking-${partIndex++}`,
        thinking: String(item.thinking || item.text || ''),
        durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
      });
    } else if (type === 'toolCall' || type === 'tool_use') {
      const toolId = String(item.id || item.toolCallId || `${subagentId}-tool-${partIndex++}`);
      const toolResult = item.result
        ? {
            content: typeof item.result === 'string' ? item.result : String(item.result.content || ''),
            isError: isToolResultError(
              typeof item.result === 'string' ? item.result : String(item.result.content || ''),
              typeof item.result === 'string' ? false : item.result.isError,
            ),
            timestamp: item.result.timestamp,
          }
        : undefined;
      const progress = item.progress || {
        jobId: toolId.slice(-6),
        state: toolResult ? (toolResult.isError ? 'failed' : 'completed') : 'running',
        durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
      };
      parts.push({
        type: 'toolCall',
        id: toolId,
        name: String(item.name || item.toolName || 'tool'),
        arguments: item.arguments || item.input || item.args || {},
        result: toolResult,
        progress,
      });
    } else if (type === 'text') {
      parts.push({
        type: 'text',
        id: item.id || `${subagentId}-text-${partIndex++}`,
        text: String(item.text || ''),
      });
    }
  }

  return parts;
}

export function extractPartsFromJsonLines(subagentId: string, text: string): AssistantContentPart[] | undefined {
  if (!text || (!text.includes('\n') && !text.trim().startsWith('{'))) return undefined;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const jsonObjects: any[] = [];
  let jsonCount = 0;
  for (const line of lines) {
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object') {
          jsonObjects.push(obj);
          jsonCount++;
        }
      } catch {}
    }
  }
  if (jsonCount === 0) return undefined;

  const parts: AssistantContentPart[] = [];
  let partIndex = 0;
  const seenAssistantMessages = new Set<string>();

  for (const obj of jsonObjects) {
    if (Array.isArray(obj.parts) && obj.parts.length > 0) {
      const sanitized = sanitizeSubagentParts(subagentId, obj.parts);
      if (sanitized.length > 0) {
        parts.push(...sanitized);
        continue;
      }
    }

    const msg = (obj.type === 'message' && obj.message && typeof obj.message === 'object')
      ? obj.message
      : (obj.message || (obj.role ? obj : undefined));

    if (msg && msg.role === 'assistant') {
      const messageKey = JSON.stringify([
        msg.id || '',
        msg.timestamp || obj.timestamp || '',
        msg.content || '',
      ]);
      if (seenAssistantMessages.has(messageKey)) continue;
      seenAssistantMessages.add(messageKey);
      if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (!item || typeof item !== 'object') continue;
          if (item.type === 'thinking') {
            parts.push({
              type: 'thinking',
              id: item.id || `${subagentId}-thinking-${partIndex++}`,
              thinking: String(item.thinking || item.text || ''),
              durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
            });
          } else if (item.type === 'toolCall' || item.type === 'tool_use') {
            const toolId = String(item.id || item.toolCallId || `${subagentId}-tool-${partIndex++}`);
            parts.push({
              type: 'toolCall',
              id: toolId,
              name: String(item.name || item.toolName || 'tool'),
              arguments: item.arguments || item.input || {},
              result: item.result ? {
                content: typeof item.result === 'string' ? item.result : String(item.result.content || ''),
                isError: isToolResultError(
                  typeof item.result === 'string' ? item.result : String(item.result.content || ''),
                  typeof item.result === 'string' ? false : item.result.isError,
                ),
                timestamp: item.result.timestamp,
              } : undefined,
            });
          } else if (item.type === 'text') {
            const t = String(item.text || '');
            if (t.trim()) {
              parts.push({
                type: 'text',
                id: item.id || `${subagentId}-text-${partIndex++}`,
                text: t,
              });
            }
          }
        }
      } else if (typeof msg.content === 'string' && msg.content.trim()) {
        parts.push({
          type: 'text',
          id: `${subagentId}-text-${partIndex++}`,
          text: msg.content,
        });
      }
      continue;
    }

    if (msg && msg.role === 'toolResult') {
      const toolId = String(msg.toolCallId || `${subagentId}-tool-${partIndex++}`);
      const resultContent = extractToolResultText(msg.content);
      const resultIsError = isToolResultError(resultContent, msg.isError);
      const existing = parts.find((part) => part.type === 'toolCall' && part.id === toolId);
      const result = {
        content: resultContent,
        isError: resultIsError,
        timestamp: msg.timestamp || obj.timestamp,
      };
      if (existing && existing.type === 'toolCall') {
        existing.name = String(msg.toolName || existing.name || 'tool');
        const existingArguments = existing.arguments && typeof existing.arguments === 'object'
          ? existing.arguments as Record<string, unknown>
          : {};
        if (Object.keys(existingArguments).length === 0) {
          existing.arguments = inferToolArguments(resultContent);
        }
        existing.result = result;
        existing.progress = {
          jobId: existing.progress?.jobId || toolId.slice(-6),
          state: resultIsError ? 'failed' : 'completed',
          ...(existing.progress?.durationMs !== undefined ? { durationMs: existing.progress.durationMs } : {}),
        };
      } else {
        parts.push({
          type: 'toolCall',
          id: toolId,
          name: String(msg.toolName || 'tool'),
          arguments: inferToolArguments(resultContent),
          result,
          progress: {
            jobId: toolId.slice(-6),
            state: resultIsError ? 'failed' : 'completed',
          },
        });
      }
      continue;
    }

    if (obj.type === 'tool_execution_start' || obj.type === 'tool_execution_end') {
      const toolId = String(obj.toolCallId || `${subagentId}-tool-${partIndex++}`);
      const existing = parts.find((p) => p.type === 'toolCall' && p.id === toolId);
      const resultContent = obj.result !== undefined
        ? (typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result))
        : undefined;
      if (existing && existing.type === 'toolCall') {
        if (obj.toolName) existing.name = String(obj.toolName);
        if (obj.args) existing.arguments = obj.args;
        if (resultContent !== undefined) {
          existing.result = { content: resultContent, isError: isToolResultError(resultContent, obj.isError) };
        }
      } else {
        parts.push({
          type: 'toolCall',
          id: toolId,
          name: String(obj.toolName || 'tool'),
          arguments: obj.args || {},
          result: resultContent !== undefined
            ? { content: resultContent, isError: isToolResultError(resultContent, obj.isError) }
            : undefined,
        });
      }
      continue;
    }

    // Skip internal scaffolding
    if (['session', 'workflow_state', 'session_info', 'model_change', 'thinking_level_change', 'collaboration_mode_change', 'label', 'message_start', 'message_update', 'message_end'].includes(obj.type)) {
      continue;
    }

    if (typeof obj.result === 'string' && obj.result.trim()) {
      parts.push({
        type: 'text',
        id: `${subagentId}-text-${partIndex++}`,
        text: obj.result.trim(),
      });
    } else if (typeof obj.message === 'string' && obj.message.trim() && obj.status !== 'running') {
      parts.push({
        type: 'text',
        id: `${subagentId}-text-${partIndex++}`,
        text: obj.message.trim(),
      });
    }
  }

  return parts.length > 0 ? parts : undefined;
}

/**
 * Splits output text into parts (thinking tags, text chunks, and structured logs)
 */
export function parseSubagentOutputToParts(
  subagentId: string,
  outputText: string,
  payloadParts?: unknown[],
): AssistantContentPart[] {
  if (Array.isArray(payloadParts) && payloadParts.length > 0) {
    const sanitized = sanitizeSubagentParts(subagentId, payloadParts);
    if (sanitized.length > 0) return sanitized;
  }

  if (!outputText || !outputText.trim()) return [];

  const fromJsonLines = extractPartsFromJsonLines(subagentId, outputText);
  if (fromJsonLines && fromJsonLines.length > 0) {
    return fromJsonLines;
  }

  // If outputText is a JSON payload with structured parts, extract them.
  try {
    const trimmed = outputText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.parts) && parsed.parts.length > 0) {
        const sanitized = sanitizeSubagentParts(subagentId, parsed.parts);
        if (sanitized.length > 0) return sanitized;
      }
    }
  } catch {}

  const parts: AssistantContentPart[] = [];
  let currentText = outputText;
  let partIndex = 0;

  // Extract <thinking>...</thinking> blocks if present
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = thinkingRegex.exec(currentText)) !== null) {
    const beforeText = currentText.slice(lastIndex, match.index).trim();
    if (beforeText) {
      parts.push({
        type: 'text',
        id: `${subagentId}-part-${partIndex++}`,
        text: beforeText,
      });
    }

    const thinkingContent = match[1].trim();
    if (thinkingContent) {
      parts.push({
        type: 'thinking',
        id: `${subagentId}-thinking-${partIndex++}`,
        thinking: thinkingContent,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  const remainingText = currentText.slice(lastIndex).trim();
  if (remainingText) {
    // Prefer human-readable progress from structured spawn heartbeats.
    try {
      const parsed = JSON.parse(remainingText);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.parts) && parsed.parts.length > 0) {
          const sanitized = sanitizeSubagentParts(subagentId, parsed.parts);
          if (sanitized.length > 0) {
            parts.push(...sanitized);
            return parts;
          }
        }
        const message = typeof (parsed as { message?: unknown }).message === 'string'
          ? (parsed as { message: string }).message.trim()
          : '';
        const result = typeof (parsed as { result?: unknown }).result === 'string'
          ? (parsed as { result: string }).result.trim()
          : '';
        const display = result || message;
        if (display) {
          parts.push({
            type: 'text',
            id: `${subagentId}-part-${partIndex++}`,
            text: display,
          });
          return parts;
        }
      }
    } catch {
      // Fall through to raw text.
    }
    // Only push if it is not an internal scaffolding JSON line
    if (!remainingText.startsWith('{"type":"session"') && !remainingText.startsWith('{"type":"workflow_state"')) {
      parts.push({
        type: 'text',
        id: `${subagentId}-part-${partIndex++}`,
        text: remainingText,
      });
    }
  }

  return parts;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function collectSubagentItems(messages: Message[]): SubagentItem[] {
  const items: SubagentItem[] = [];

  for (const message of messages) {
    const parts = message.parts || [];
    for (const part of parts) {
      if (part.type !== 'toolCall') continue;
      if (!/^(spawn_agent|subagent)$/i.test(part.name)) continue;

      const args = (part.arguments && typeof part.arguments === 'object')
        ? (part.arguments as Record<string, any>)
        : {};

      const role = String(args.agent || args.role || 'subagent');
      const task = String(args.task || args.title || args.prompt || '');
      const context = args.context ? String(args.context) : undefined;
      const mode = (args.mode === 'async' || args.mode === 'sync') ? args.mode : 'sync';
      const worktree = args.worktree ? String(args.worktree) : undefined;

      const result = part.result;
      const rawOutput = result?.content || '';
      const payload = parsePayload(rawOutput);

      let status: 'running' | 'completed' | 'failed' = 'running';
      const payloadDurationMs = typeof payload?.elapsedSec === 'number' && Number.isFinite(payload.elapsedSec)
        ? Math.max(0, payload.elapsedSec * 1000)
        : undefined;
      let durationMs = payloadDurationMs ?? part.progress?.durationMs;
      const startedAt = part.progress?.startedAt ?? toTimestamp(message.serverTimestamp);
      const completedAt = part.progress?.completedAt ?? toTimestamp(result?.timestamp);

      if (durationMs === undefined && startedAt !== undefined && completedAt !== undefined && completedAt >= startedAt) {
        durationMs = completedAt - startedAt;
      }

      const progressState = part.progress?.state;
      if (progressState === 'failed' || result?.isError) {
        status = 'failed';
      } else if (progressState === 'running') {
        status = 'running';
      } else if (payload) {
        if (payload.status === 'success' || payload.status === 'completed') {
          status = 'completed';
        } else if (payload.status === 'error' || payload.status === 'timed_out') {
          status = 'failed';
        } else if (payload.status === 'started' || payload.status === 'running' || mode === 'async') {
          status = progressState === 'completed' ? 'completed' : 'running';
        }
      } else if (result && result.content && !result.isError) {
        // Snapshot/final tool results lack progress; live partials always carry progress.state.
        status = progressState === 'completed' || progressState === undefined ? 'completed' : 'running';
      }

      const displayResult = payload?.result
        || (payload?.status === 'started' || payload?.status === 'running'
          ? (typeof (payload as { message?: unknown }).message === 'string'
            ? String((payload as { message: string }).message)
            : rawOutput)
          : undefined)
        || (payload ? undefined : rawOutput)
        || undefined;
      const errorText = payload?.error || (result?.isError ? rawOutput : undefined);
      const subagentParts = parseSubagentOutputToParts(part.id, displayResult || rawOutput, payload?.parts);

      items.push({
        id: part.id,
        agentId: payload?.agentId || args.agentId,
        role,
        task,
        context,
        mode,
        worktree: payload?.worktree || worktree,
        status,
        startedAt,
        completedAt,
        durationMs,
        rawOutput,
        result: displayResult,
        error: errorText,
        exitCode: payload?.exitCode,
        parts: subagentParts,
      });
    }
  }

  // Return in reverse chronological order (newest first)
  return items.reverse();
}

export function formatSubagentDuration(durationMs?: number): string {
  if (durationMs === undefined || durationMs === null || Number.isNaN(durationMs)) return '';
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
