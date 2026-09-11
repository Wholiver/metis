import React, { useMemo } from 'react';
import { AssistantContentPart, Message, WorkflowProposalState } from '../../types';
import { extractProposedPlan } from '../../lib/plan-preview';
import { computeToolDiffStats } from '../../lib/turn-files';
import { useI18n } from '../../i18n';
import { formatToolDisplayName, toolStatus, type ToolPart } from './ToolCard';
import { MarkdownContent } from './MarkdownContent';
import { PlanPreview } from './PlanPreview';
import MetisStreamingText from '../primitives/StreamingText';
import {
  AgentWorkflow,
  type AgentPhase,
  type DetailLine,
  type TraceNode,
} from '../ui/ai-agent-response';

interface AgentResponseProps {
  items: AssistantContentPart[];
  outputMessages?: Message[];
  streaming?: boolean;
  durationMs?: number;
  workflowProposal?: WorkflowProposalState;
  onOpenPlan?: (markdown: string) => void;
}

function argumentRecord(part: ToolPart): Record<string, unknown> {
  return part.arguments && typeof part.arguments === 'object'
    ? part.arguments as Record<string, unknown>
    : {};
}

function displayTarget(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text;
}

function detailLines(value: unknown, tone?: DetailLine['tone']): DetailLine[] {
  if (value === undefined || value === null || value === '') return [];
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return String(text).split(/\r?\n/).filter((line) => line.trim()).map((line) => ({ text: line, tone }));
}

function reasoningSentences(value: string): string[] {
  const clean = value
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .trim();
  const paragraphs = clean.split(/\n{2,}/).map((part) => part.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  return (paragraphs[0] || clean).split(/(?<=[.!?。！？])\s+/).map((part) => part.trim()).filter(Boolean);
}

function toolNode(part: ToolPart, streaming: boolean): TraceNode {
  const status = toolStatus(part, streaming);
  const args = argumentRecord(part);
  const command = args.command ?? args.cmd;
  const target = args.path ?? args.file_path ?? args.filePath ?? args.target ?? args.query ?? args.task ?? args.agent;
  const diff = computeToolDiffStats(part, status);
  const normalized = part.name.toLowerCase();
  const isCommand = Boolean(command) || /bash|exec|run_command|exec_command/.test(normalized);
  const type = isCommand
    ? 'terminal'
    : /search|find|grep|query_memory/.test(normalized)
      ? 'search'
      : 'tool';
  const details = isCommand
    ? undefined
    : [...detailLines(part.arguments, 'ctx'), ...detailLines(part.result?.content, part.result?.isError ? 'error' : 'muted')];

  return {
    id: part.id,
    type,
    toolName: part.name,
    primary: formatToolDisplayName(part.name, status, part.arguments),
    secondary: target ? displayTarget(target) : command ? String(command) : undefined,
    mono: Boolean(target || command),
    status: status === 'Running' || status === 'Pending'
      ? 'running'
      : status === 'Error' || status === 'Denied' ? 'failed' : 'completed',
    args: part.arguments,
    result: part.result,
    command: command ? String(command) : undefined,
    output: isCommand ? part.result?.content : undefined,
    exitCode: part.result?.isError ? 1 : part.result ? 0 : undefined,
    durationMs: part.progress?.durationMs,
    add: diff?.added,
    del: diff?.removed,
    details,
  };
}

type ResponsePhase = AgentPhase & { id: string; messageMeta?: Message };

export function buildAgentResponsePhases(
  items: AssistantContentPart[],
  outputMessages: Message[],
  streaming: boolean,
): ResponsePhase[] {
  const phases: ResponsePhase[] = [];
  let trace: TraceNode[] = [];

  const flushMessage = (id: string, text: string, messageMeta?: Message) => {
    phases.push({ id, trace, message: text, messageMeta });
    trace = [];
  };

  items.forEach((part, index) => {
    if (part.type === 'thinking') {
      trace.push({
        id: part.id,
        type: 'reasoning',
        sentences: reasoningSentences(part.thinking),
        durationSeconds: Number(((part.durationMs ?? 0) / 1000).toFixed(1)) || undefined,
        status: streaming && index === items.length - 1 ? 'running' : 'completed',
      });
    } else if (part.type === 'toolCall') {
      trace.push(toolNode(part, streaming && index === items.length - 1));
    } else if (part.text.trim()) {
      flushMessage(part.id, part.text, {
        id: part.id,
        role: 'assistant',
        content: part.text,
        streaming: streaming && index === items.length - 1,
      });
    }
  });

  outputMessages.forEach((message) => flushMessage(message.id, message.content, message));
  if (trace.length > 0) phases.push({ id: trace[0]?.id || 'trace', trace });
  if (phases.length === 0 && streaming) {
    phases.push({
      id: 'active-response',
      trace: [{ id: 'active-response-step', type: 'step', primary: 'Preparing response', status: 'running' }],
    });
  }
  return phases;
}

export const AgentResponse = React.memo<AgentResponseProps>(({
  items,
  outputMessages = [],
  streaming = false,
  durationMs,
  workflowProposal,
  onOpenPlan,
}) => {
  const { t } = useI18n();
  const phases = useMemo(
    () => buildAgentResponsePhases(items, outputMessages, streaming),
    [items, outputMessages, streaming],
  );

  return (
    <AgentWorkflow
      phases={phases}
      active={streaming}
      elapsedSeconds={durationMs === undefined ? undefined : Math.max(1, Math.round(durationMs / 1000))}
      defaultExpanded={streaming}
      workingLabel={t('working')}
      className="agent-response antialiased [font-synthesis:none]"
      data-agent-response=""
      data-assistant-work={items.length > 0 || streaming ? '' : undefined}
      renderMessage={(_text, phaseIndex, phaseStreaming) => {
        const phase = phases[phaseIndex];
        const message = phase.messageMeta || {
          id: phase.id,
          role: 'assistant' as const,
          content: phase.message || '',
          streaming: phaseStreaming,
        };
        const messageStreaming = phase.messageMeta ? Boolean(message.streaming) : phaseStreaming;
        const proposedPlan = extractProposedPlan(message.content, messageStreaming);
        const current = Boolean(
          proposedPlan
          && !proposedPlan.partial
          && workflowProposal
          && workflowProposal.markdown.trim() === proposedPlan.plan.trim()
        );
        return (
          <div
            className="agent-response-message w-full min-w-0 max-w-full font-sans text-[14px] leading-[1.6] text-foreground/90 select-text text-pretty"
            data-message-id={message.id}
            data-message-role="assistant"
            data-streaming={messageStreaming ? 'true' : undefined}
          >
            <MetisStreamingText streaming={messageStreaming} fill>
              {proposedPlan ? (
                <>
                  {proposedPlan.before && <MarkdownContent markdown={proposedPlan.before} className="mb-2" />}
                  <PlanPreview markdown={proposedPlan.plan} partial={proposedPlan.partial} current={current} onOpenPlan={onOpenPlan} />
                  {proposedPlan.after && <MarkdownContent markdown={proposedPlan.after} className="mt-2" />}
                </>
              ) : (
                <MarkdownContent markdown={message.content} />
              )}
            </MetisStreamingText>
          </div>
        );
      }}
    />
  );
});

AgentResponse.displayName = 'AgentResponse';
