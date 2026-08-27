import { Message } from '../types';

export function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const value = part as { type?: unknown; text?: unknown; content?: unknown; output?: unknown };
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    return typeof value.output === 'string' ? value.output : '';
  }).filter(Boolean).join('\n');
}

/** Apply live tool_execution_update partials into assistant toolCall parts (esp. spawn_agent). */
export function applyToolExecutionUpdate(
  messages: Message[],
  toolCallId: string,
  partialResult: unknown,
): Message[] {
  if (!toolCallId) return messages;
  const content = extractToolResultText(
    partialResult && typeof partialResult === 'object'
      ? (partialResult as { content?: unknown }).content
      : undefined,
  );
  if (!content) return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (!message.parts?.length) return message;
    let partChanged = false;
    const parts = message.parts.map((part) => {
      if (part.type !== 'toolCall' || part.id !== toolCallId) return part;
      partChanged = true;
      return {
        ...part,
        result: {
          content,
          ...(part.result?.isError ? { isError: part.result.isError } : {}),
          ...(part.result?.timestamp !== undefined ? { timestamp: part.result.timestamp } : {}),
        },
        progress: {
          jobId: part.progress?.jobId || toolCallId,
          state: 'running' as const,
          ...(part.progress?.durationMs !== undefined ? { durationMs: part.progress.durationMs } : {}),
        },
      };
    });
    if (!partChanged) return message;
    changed = true;
    return { ...message, parts };
  });
  return changed ? next : messages;
}

