import React, { useEffect, useMemo } from 'react';
import { AssistantContentPart } from '../../types';
import { formatThinkingDuration } from '../../lib/thinking';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard, ToolPart, isToolCallFinished } from './ToolCard';
import { ContextToolGroup, isContextGroupTool } from './ContextToolGroup';
import { CommandToolGroup, isCommandGroupTool } from './CommandToolGroup';

interface AssistantWorkProps {
  items: AssistantContentPart[];
  streaming?: boolean;
  durationMs?: number;
  preserveExistingItems?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onOpenSubagent?: (partId: string) => void;
}

export function assistantWorkTitle(streaming: boolean, elapsedMs: number, durationMs?: number): string {
  if (streaming) return elapsedMs >= 1000 ? `Working for ${formatThinkingDuration(elapsedMs)}` : 'Working…';
  return durationMs !== undefined ? `Worked for ${formatThinkingDuration(durationMs)}` : 'Worked';
}

export type AssistantWorkRenderItem = AssistantContentPart | {
  type: 'contextGroup' | 'commandGroup';
  id: string;
  parts: ToolPart[];
};

function groupedToolKind(item: AssistantContentPart): 'contextGroup' | 'commandGroup' | null {
  if (item.type !== 'toolCall') return null;
  if (isContextGroupTool(item)) return 'contextGroup';
  if (isCommandGroupTool(item)) return 'commandGroup';
  return null;
}

export function areVisibleAssistantWorkItemsEqual(
  prev: AssistantContentPart[],
  next: AssistantContentPart[],
): boolean {
  if (prev === next) return true;
  let prevIndex = 0;
  let nextIndex = 0;
  while (prevIndex < prev.length || nextIndex < next.length) {
    while (prevIndex < prev.length && prev[prevIndex].type === 'thinking') prevIndex += 1;
    while (nextIndex < next.length && next[nextIndex].type === 'thinking') nextIndex += 1;
    if (prevIndex >= prev.length || nextIndex >= next.length) {
      return prevIndex >= prev.length && nextIndex >= next.length;
    }
    if (prev[prevIndex] !== next[nextIndex]) return false;
    prevIndex += 1;
    nextIndex += 1;
  }
  return true;
}

function lastGroupedTool(renderItems: AssistantWorkRenderItem[]): ToolPart | undefined {
  for (let index = renderItems.length - 1; index >= 0; index -= 1) {
    const item = renderItems[index];
    if (item.type === 'contextGroup' || item.type === 'commandGroup') {
      const part = item.parts[item.parts.length - 1];
      if (part) return part;
      continue;
    }
    if (item.type === 'toolCall') return item;
  }
  return undefined;
}

function lastGroupOfType(
  renderItems: AssistantWorkRenderItem[],
  type: 'contextGroup' | 'commandGroup',
): Extract<AssistantWorkRenderItem, { type: 'contextGroup' | 'commandGroup' }> | undefined {
  for (let index = renderItems.length - 1; index >= 0; index -= 1) {
    const item = renderItems[index];
    if (item.type === type) return item;
  }
  return undefined;
}

export function groupAssistantWorkItems(items: AssistantContentPart[]): AssistantWorkRenderItem[] {
  // Skip thinking parts: only the live "思考中" shimmer is shown while streaming.
  const visible = items.filter((item) => (
    item.type !== 'thinking'
    && (item.type !== 'text' || Boolean(item.text.trim()))
    && (item.type !== 'toolCall' || item.name !== 'update_plan')
  ));
  const grouped: AssistantWorkRenderItem[] = [];
  let run: { type: 'contextGroup' | 'commandGroup'; parts: ToolPart[] } | null = null;

  const flushRun = () => {
    if (!run || run.parts.length === 0) return;
    grouped.push({
      type: run.type,
      id: `${run.type === 'contextGroup' ? 'context' : 'command'}:${run.parts[0].id}`,
      parts: run.parts,
    });
    run = null;
  };

  for (const item of visible) {
    if (item.type === 'toolCall') {
      const kind = groupedToolKind(item);
      if (kind) {
        if (run && run.type !== kind) flushRun();
        if (!run) run = { type: kind, parts: [] };
        run.parts.push(item);
        continue;
      }
    }
    flushRun();
    grouped.push(item);
  }
  flushRun();
  return grouped;
}

function areAssistantWorkPropsEqual(prev: AssistantWorkProps, next: AssistantWorkProps): boolean {
  if (prev.streaming !== next.streaming) return false;
  if (prev.onExpandedChange !== next.onExpandedChange) return false;
  if (prev.onOpenSubagent !== next.onOpenSubagent) return false;
  // durationMs is unused in the live work tree; ignore Date.now() ticks.
  return areVisibleAssistantWorkItemsEqual(prev.items, next.items);
}

const AssistantWorkComponent: React.FC<AssistantWorkProps> = ({
  items,
  streaming = false,
  preserveExistingItems: _preserveExistingItems = false,
  onExpandedChange,
  onOpenSubagent,
}) => {
  useEffect(() => {
    onExpandedChange?.(true);
  }, [onExpandedChange, streaming, items.length]);

  const renderItems = useMemo(() => groupAssistantWorkItems(items), [items]);
  const lastTool = lastGroupedTool(renderItems);
  const lastToolId = lastTool?.id;
  const lastToolLive = Boolean(streaming && lastTool && !isToolCallFinished(lastTool));
  // OpenCode: busy only on the last assistant context group while that group still has in-flight tools.
  const lastContextGroup = lastGroupOfType(renderItems, 'contextGroup');
  const lastContextGroupId = lastContextGroup?.id;
  const lastContextGroupLive = Boolean(
    streaming
    && lastContextGroup
    && lastContextGroup.parts.some((part) => !isToolCallFinished(part)),
  );
  const lastCommandGroup = lastGroupOfType(renderItems, 'commandGroup');
  const lastCommandGroupId = lastCommandGroup?.id;
  const lastCommandGroupLive = Boolean(
    streaming
    && lastCommandGroup
    && lastCommandGroup.parts.some((part) => !isToolCallFinished(part)),
  );
  // Only the trailing narration segment is still growing; settled text keeps LRU cache.
  const lastRenderItem = renderItems[renderItems.length - 1];
  const liveTextId = streaming && lastRenderItem?.type === 'text' ? lastRenderItem.id : null;

  return (
    <section className="cot-container" data-assistant-work>
      <div className="cot-content-body">
        <div className="cot-content-inner" data-slot="session-turn-assistant-content">
          {renderItems.map((item) => {
              let contentNode: React.ReactNode = null;
              if (item.type === 'contextGroup') {
                contentNode = (
                  <ContextToolGroup
                    parts={item.parts}
                    streaming={lastToolLive && item.parts[item.parts.length - 1]?.id === lastToolId}
                    busy={lastContextGroupLive && item.id === lastContextGroupId}
                  />
                );
              } else if (item.type === 'commandGroup') {
                contentNode = (
                  <CommandToolGroup
                    parts={item.parts}
                    streaming={lastToolLive && item.parts[item.parts.length - 1]?.id === lastToolId}
                    busy={lastCommandGroupLive && item.id === lastCommandGroupId}
                  />
                );
              } else if (item.type === 'toolCall') {
                contentNode = (
                  <ToolCard
                    part={item as ToolPart}
                    streaming={lastToolLive && item.id === lastToolId}
                    onOpenSubagent={onOpenSubagent}
                  />
                );
              } else {
                contentNode = (
                  <MarkdownContent
                    markdown={item.text}
                    streaming={liveTextId === item.id}
                    className="cot-text"
                  />
                );
              }
              return (
                <div key={item.id} className="w-full min-w-0">
                  {contentNode}
                </div>
              );
            })}
          {streaming && <ThinkingBlock streaming active />}
        </div>
      </div>
    </section>
  );
};

export const AssistantWork = React.memo(AssistantWorkComponent, areAssistantWorkPropsEqual);

AssistantWork.displayName = 'AssistantWork';
