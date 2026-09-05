import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AssistantContentPart } from '../../types';
import { formatThinkingDuration } from '../../lib/thinking';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard, ToolPart } from './ToolCard';
import { ToolGroup } from './ToolGroup';

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
  type: 'toolGroup';
  id: string;
  parts: ToolPart[];
};

export function groupAssistantWorkItems(items: AssistantContentPart[]): AssistantWorkRenderItem[] {
  const visibleItems = items.filter((item) => item.type !== 'toolCall' || item.name !== 'update_plan');
  const grouped: AssistantWorkRenderItem[] = [];
  for (let index = 0; index < visibleItems.length;) {
    const item = visibleItems[index];
    if (item.type !== 'toolCall') {
      grouped.push(item);
      index += 1;
      continue;
    }
    const run: ToolPart[] = [];
    while (index < visibleItems.length && visibleItems[index].type === 'toolCall') {
      run.push(visibleItems[index] as ToolPart);
      index += 1;
    }
    if (run.length === 1) grouped.push(run[0]);
    else grouped.push({ type: 'toolGroup', id: `tool-group-${run[0].id}`, parts: run });
  }
  return grouped;
}

export const AssistantWork = React.memo<AssistantWorkProps>(({
  items,
  streaming = false,
  durationMs,
  preserveExistingItems = false,
  onExpandedChange,
}) => {
  const contentId = useId();
  const [expanded, setExpanded] = useState(streaming);
  const initialElapsedMs = streaming ? Math.max(0, durationMs ?? 0) : 0;
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);
  const startedAt = useRef(Date.now() - initialElapsedMs);
  const wasStreaming = useRef(streaming);
  const userOverrideRef = useRef(false);

  useEffect(() => {
    if (!userOverrideRef.current) {
      if (streaming) {
        setExpanded(true);
        onExpandedChange?.(true);
      } else if (wasStreaming.current) {
        setExpanded(false);
        onExpandedChange?.(false);
      }
    }
    wasStreaming.current = streaming;
  }, [streaming, onExpandedChange]);

  useEffect(() => {
    if (!streaming) return;
    if (durationMs !== undefined && durationMs > Date.now() - startedAt.current) {
      startedAt.current = Date.now() - durationMs;
    }
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt.current);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [durationMs, streaming]);

  const title = assistantWorkTitle(streaming, elapsedMs, durationMs);
  const renderItems = useMemo(() => groupAssistantWorkItems(items), [items]);
  const [revealedCount, setRevealedCount] = useState(() => (
    streaming && !preserveExistingItems ? Math.min(1, renderItems.length) : renderItems.length
  ));

  useEffect(() => {
    if (!streaming || preserveExistingItems) {
      setRevealedCount(renderItems.length);
      return;
    }
    if (revealedCount < renderItems.length) {
      const timer = window.setTimeout(() => {
        setRevealedCount((prev) => Math.min(prev + 1, renderItems.length));
      }, 90);
      return () => window.clearTimeout(timer);
    }
  }, [preserveExistingItems, streaming, renderItems.length, revealedCount]);

  const visibleRenderItems = streaming ? renderItems.slice(0, revealedCount) : renderItems;
  const lastRenderItemId = visibleRenderItems.at(-1)?.id;
  const lastVisibleToolId = [...visibleRenderItems].reverse().flatMap((item) => (
    item.type === 'toolGroup' ? [...item.parts].reverse() : item.type === 'toolCall' ? [item] : []
  ))[0]?.id;

  return (
    <section className={`cot-container ${expanded ? '' : 'collapsed'}`} data-assistant-work>
      <button
        type="button"
        className="cot-header-bar"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => {
          userOverrideRef.current = true;
          onExpandedChange?.(!value);
          return !value;
        })}
      >
        <span className={`cot-title ${streaming ? 'working-shimmer' : ''}`}>{title}</span>
        <ChevronRight aria-hidden="true" className="cot-chevron" strokeWidth={1.7} />
      </button>
      <div className="cot-content-body" aria-hidden={!expanded}>
        <div className="cot-collapse-wrapper">
          <div id={contentId} className="cot-content-inner">
            {visibleRenderItems.length === 0 && streaming ? (
              <div className="thinking-skeleton-container" data-thinking-skeleton>
                <div className="thinking-skeleton-line" style={{ width: '78%' }} />
                <div className="thinking-skeleton-line" style={{ width: '56%' }} />
                <div className="thinking-skeleton-line" style={{ width: '68%' }} />
              </div>
            ) : (
              visibleRenderItems.map((item) => {
                let contentNode: React.ReactNode = null;
                if (item.type === 'toolGroup') {
                  contentNode = (
                    <ToolGroup
                      parts={item.parts}
                      streaming={streaming && item.parts.some((part) => part.id === lastVisibleToolId)}
                      preserveExistingItems={preserveExistingItems}
                    />
                  );
                } else if (item.type === 'thinking') {
                  contentNode = (
                    <ThinkingBlock
                      thinking={item.thinking}
                      streaming={streaming && item.id === lastRenderItemId}
                    />
                  );
                } else if (item.type === 'toolCall') {
                  contentNode = <ToolCard part={item} streaming={streaming && item.id === lastVisibleToolId} />;
                } else {
                  contentNode = (
                    <MarkdownContent markdown={item.text} className="cot-text" />
                  );
                }
                return (
                  <div key={item.id} className={`w-full min-w-0 ${streaming && !preserveExistingItems ? 'cot-work-item-enter' : ''}`}>
                    {contentNode}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
});

AssistantWork.displayName = 'AssistantWork';

