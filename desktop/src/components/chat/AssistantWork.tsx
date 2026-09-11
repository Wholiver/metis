import React, { useEffect, useMemo } from 'react';
import { AssistantContentPart } from '../../types';
import { formatThinkingDuration } from '../../lib/thinking';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard, ToolPart } from './ToolCard';
import { ContextToolGroup, isContextGroupTool } from './ContextToolGroup';

interface AssistantWorkProps {
  items: AssistantContentPart[];
  streaming?: boolean;
  durationMs?: number;
  preserveExistingItems?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function assistantWorkTitle(streaming: boolean, elapsedMs: number, durationMs?: number): string {
  if (streaming) return elapsedMs >= 1000 ? `Working for ${formatThinkingDuration(elapsedMs)}` : 'Working…';
  return durationMs !== undefined ? `Worked for ${formatThinkingDuration(durationMs)}` : 'Worked';
}

export type AssistantWorkRenderItem = AssistantContentPart | {
  type: 'contextGroup';
  id: string;
  parts: ToolPart[];
};

export function groupAssistantWorkItems(items: AssistantContentPart[]): AssistantWorkRenderItem[] {
  // Skip thinking parts: only the live "思考中" shimmer is shown while streaming.
  const visible = items.filter((item) => (
    item.type !== 'thinking'
    && (item.type !== 'toolCall' || item.name !== 'update_plan')
  ));
  const grouped: AssistantWorkRenderItem[] = [];
  let contextRun: ToolPart[] = [];

  const flushContext = () => {
    if (contextRun.length === 0) return;
    grouped.push({
      type: 'contextGroup',
      id: `context:${contextRun[0].id}`,
      parts: contextRun,
    });
    contextRun = [];
  };

  for (const item of visible) {
    if (item.type === 'toolCall' && isContextGroupTool(item)) {
      contextRun.push(item);
      continue;
    }
    flushContext();
    grouped.push(item);
  }
  flushContext();
  return grouped;
}

export const AssistantWork = React.memo<AssistantWorkProps>(({
  items,
  streaming = false,
  durationMs,
  preserveExistingItems: _preserveExistingItems = false,
  onExpandedChange,
}) => {
  useEffect(() => {
    onExpandedChange?.(true);
  }, [onExpandedChange, streaming, items.length]);

  const renderItems = useMemo(() => groupAssistantWorkItems(items), [items]);
  const lastToolId = [...renderItems]
    .reverse()
    .flatMap((item) => (
      item.type === 'contextGroup'
        ? [...item.parts].reverse()
        : item.type === 'toolCall' ? [item] : []
    ))[0]?.id;
  // OpenCode: busy only on the last assistant context group while the turn is working.
  const lastContextGroupId = [...renderItems]
    .reverse()
    .find((item) => item.type === 'contextGroup')?.id;

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
                    streaming={streaming && item.parts.some((part) => part.id === lastToolId)}
                    busy={streaming && item.id === lastContextGroupId}
                  />
                );
              } else if (item.type === 'toolCall') {
                contentNode = (
                  <ToolCard
                    part={item as ToolPart}
                    streaming={streaming && item.id === lastToolId}
                  />
                );
              } else {
                contentNode = (
                  <MarkdownContent markdown={item.text} className="cot-text" />
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
});

AssistantWork.displayName = 'AssistantWork';
