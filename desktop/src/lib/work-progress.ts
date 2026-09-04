import { AssistantContentPart, Message } from '../types';

export type WorkProgressPhase =
  | 'thinking'
  | 'waiting'
  | 'reading'
  | 'searching'
  | 'executing'
  | 'issue'
  | 'drafting'
  | 'coordinating'
  | 'checking'
  | 'finalizing';

export interface WorkProgressState {
  phase: WorkProgressPhase;
  label: string;
  status: 'active' | 'waiting' | 'completed' | 'error';
  actor?: string;
}

export type WorkProgressExpression =
  | 'neutral'
  | 'attentive'
  | 'surprised'
  | 'excited'
  | 'happy'
  | 'laughing'
  | 'angry'
  | 'sad'
  | 'scared'
  | 'suspicious'
  | 'confused'
  | 'curious'
  | 'proud'
  | 'shy'
  | 'bored'
  | 'sleepy';

export const WORK_PROGRESS_EXPRESSION_ASSETS: Record<WorkProgressExpression, string> = {
  neutral: './assets/bloub-expression-neutral.svg',
  attentive: './assets/bloub-expression-attentive.svg',
  surprised: './assets/bloub-expression-surprised.svg',
  excited: './assets/bloub-expression-excited.svg',
  happy: './assets/bloub-expression-happy.svg',
  laughing: './assets/bloub-expression-laughing.svg',
  angry: './assets/bloub-expression-angry.svg',
  sad: './assets/bloub-expression-sad.svg',
  scared: './assets/bloub-expression-scared.svg',
  suspicious: './assets/bloub-expression-suspicious.svg',
  confused: './assets/bloub-expression-confused.svg',
  curious: './assets/bloub-expression-curious.svg',
  proud: './assets/bloub-expression-proud.svg',
  shy: './assets/bloub-expression-shy.svg',
  bored: './assets/bloub-expression-bored.svg',
  sleepy: './assets/bloub-expression-sleepy.svg',
};

const WORK_PROGRESS_PHASE_EXPRESSIONS: Record<WorkProgressPhase, WorkProgressExpression> = {
  thinking: 'attentive',
  waiting: 'neutral',
  reading: 'attentive',
  searching: 'curious',
  executing: 'excited',
  issue: 'confused',
  drafting: 'shy',
  coordinating: 'happy',
  checking: 'suspicious',
  finalizing: 'proud',
};

export function resolveWorkProgressExpression(progress: WorkProgressState): WorkProgressExpression {
  return WORK_PROGRESS_PHASE_EXPRESSIONS[progress.phase];
}

export interface WorkProgressExpressionUpdate {
  expression: WorkProgressExpression;
  delayMs: number | null;
}

export function planWorkProgressExpressionUpdate(
  displayed: WorkProgressExpression,
  target: WorkProgressExpression,
  displayedAtMs: number,
  targetSinceMs: number,
  nowMs: number,
  minimumDisplayMs: number,
  settleMs: number,
): WorkProgressExpressionUpdate {
  if (displayed === target) return { expression: displayed, delayMs: null };
  const remainingDisplayMs = Math.max(0, minimumDisplayMs - Math.max(0, nowMs - displayedAtMs));
  const remainingSettleMs = Math.max(0, settleMs - Math.max(0, nowMs - targetSinceMs));
  const remainingMs = Math.max(remainingDisplayMs, remainingSettleMs);
  return remainingMs === 0
    ? { expression: target, delayMs: null }
    : { expression: displayed, delayMs: remainingMs };
}

export function resolveOutputTailProgress(
  items: AssistantContentPart[],
  streaming: boolean,
): WorkProgressState {
  if (!streaming) {
    return {
      phase: 'finalizing',
      label: 'Response complete',
      status: 'completed',
    };
  }
  return resolveWorkProgress(items);
}

function taskSummary(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return 'assigned task';
  return text.length > 72 ? text.slice(0, 69).trimEnd() : text;
}

export function resolveWorkProgress(items: AssistantContentPart[]): WorkProgressState {
  const current = items.at(-1);
  if (!current) return { phase: 'waiting', label: 'Preparing the next step…', status: 'waiting' };
  if (current.type === 'thinking') return { phase: 'thinking', label: 'Analyzing the request…', status: 'active' };
  if (current.type === 'text') {
    return current.text.length > 400
      ? { phase: 'finalizing', label: 'Finalizing the response…', status: 'active' }
      : { phase: 'drafting', label: 'Drafting the response…', status: 'active' };
  }

  const name = current.name.toLowerCase();
  const args = current.arguments && typeof current.arguments === 'object'
    ? current.arguments as Record<string, unknown>
    : {};
  const actor = typeof args.agent === 'string' && args.agent.trim() ? args.agent.trim() : undefined;
  const subagent = /spawn_agent|subagent/.test(name);
  if (current.result?.isError || current.progress?.state === 'failed') {
    return subagent && actor
      ? { phase: 'issue', label: `${actor} failed; recovering…`, status: 'error', actor }
      : { phase: 'issue', label: 'Recovering from a failed tool call…', status: 'error' };
  }
  if (subagent && current.progress?.state === 'running') {
    return {
      phase: 'coordinating',
      label: `${actor || 'Subagent'} is working: ${taskSummary(args.task || args.title)}…`,
      status: 'active',
      ...(actor ? { actor } : {}),
    };
  }
  if (current.result || current.progress?.state === 'completed') {
    return subagent && actor
      ? { phase: 'checking', label: `Reviewing ${actor}’s result…`, status: 'completed', actor }
      : { phase: 'checking', label: 'Checking the latest tool result…', status: 'completed' };
  }
  if (subagent) {
    return {
      phase: 'coordinating',
      label: `${actor || 'Subagent'} is starting: ${taskSummary(args.task || args.title)}…`,
      status: 'active',
      ...(actor ? { actor } : {}),
    };
  }
  if (/wait_agent/.test(name)) {
    return { phase: 'waiting', label: actor ? `Waiting for ${actor}…` : 'Waiting for an agent…', status: 'waiting', ...(actor ? { actor } : {}) };
  }
  if (/message_agent/.test(name)) {
    return { phase: 'coordinating', label: actor ? `Sending context to ${actor}…` : 'Sending context to an agent…', status: 'active', ...(actor ? { actor } : {}) };
  }
  if (/list_agents/.test(name)) {
    return { phase: 'coordinating', label: 'Checking agent status…', status: 'active' };
  }
  if (/ask_user|request_user_input/.test(name)) {
    return { phase: 'waiting', label: 'Waiting for your input…', status: 'waiting' };
  }
  if (/websearch|search_web/.test(name)) {
    return { phase: 'searching', label: 'Searching the web…', status: 'active' };
  }
  if (/search_code|grep|find/.test(name)) {
    return { phase: 'searching', label: 'Searching the codebase…', status: 'active' };
  }
  if (/read_plan/.test(name)) {
    return { phase: 'reading', label: 'Reading the current plan…', status: 'active' };
  }
  if (/query_memory|memory_db/.test(name)) {
    return { phase: 'reading', label: 'Checking memory…', status: 'active' };
  }
  if (/webfetch|fetch/.test(name)) {
    return { phase: 'reading', label: 'Fetching a source…', status: 'active' };
  }
  if (/read|list_dir/.test(name)) {
    return { phase: 'reading', label: 'Reading project files…', status: 'active' };
  }
  if (/write|edit|replace/.test(name)) {
    return { phase: 'executing', label: 'Editing files…', status: 'active' };
  }
  if (/bash|exec|run_command/.test(name)) {
    return { phase: 'executing', label: 'Running a command…', status: 'active' };
  }
  return {
    phase: 'executing',
    label: name === 'update_plan' ? 'Updating the plan…' : 'Running a tool…',
    status: 'active',
  };
}

export function resolveConversationProgress(
  messages: Message[],
  streaming: boolean,
  isWaitingUserInput = false,
): { progress: WorkProgressState; idle: boolean } {
  if (isWaitingUserInput) {
    return {
      progress: { phase: 'waiting', label: 'Waiting for your input…', status: 'waiting' },
      idle: false,
    };
  }
  const lastAssistantMessages: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      lastAssistantMessages.unshift(msg);
    } else if (lastAssistantMessages.length > 0) {
      break;
    }
  }
  const parts: AssistantContentPart[] = lastAssistantMessages.flatMap((message) =>
    message.parts && message.parts.length > 0
      ? message.parts
      : [
          ...(message.thinking
            ? [{ type: 'thinking' as const, id: `${message.id}-thinking`, thinking: message.thinking, durationMs: message.thinkingDurationMs }]
            : []),
          ...(message.content
            ? [{ type: 'text' as const, id: `${message.id}-text`, text: message.content }]
            : []),
        ]
  );
  const progress = resolveOutputTailProgress(parts, streaming);
  return {
    progress,
    idle: !streaming,
  };
}

