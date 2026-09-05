import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';

interface ThinkingBlockProps {
  thinking: string;
  streaming?: boolean;
}

export function thinkingSummary(thinking: string): string {
  const heading = thinking.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  const firstLine = thinking.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const summary = (heading || firstLine)
    .replace(/^[-*+>\s#]+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
  if (!summary) return 'Thinking';
  return summary.length > 88 ? `${summary.slice(0, 87).trimEnd()}…` : summary;
}

export function thinkingBody(thinking: string): string {
  const withoutLeadingHeading = thinking.replace(/^\s{0,3}#{1,6}\s+.+?\s*#*\s*(?:\r?\n)+/, '');
  if (withoutLeadingHeading !== thinking) {
    return withoutLeadingHeading.trim() || thinking.trim();
  }
  const trimmed = thinking.trim();
  const newlineIndex = trimmed.search(/\r?\n/);
  if (newlineIndex !== -1) {
    const remainder = trimmed.slice(newlineIndex).trim();
    if (remainder) return remainder;
  }
  return trimmed;
}

export const ThinkingBlock = React.memo<ThinkingBlockProps>(({ thinking, streaming = false }) => {
  const contentId = useId();
  const [expanded, setExpanded] = useState(streaming);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasStreaming = useRef(streaming);
  const userOverrideRef = useRef(false);
  const summary = useMemo(() => thinkingSummary(thinking), [thinking]);
  const body = useMemo(() => thinkingBody(thinking), [thinking]);

  useEffect(() => {
    if (!userOverrideRef.current) {
      if (streaming) setExpanded(true);
      else if (wasStreaming.current) setExpanded(false);
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  useLayoutEffect(() => {
    if (!expanded || !scrollRef.current) return;
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (scroll) {
        scroll.scrollTop = scroll.scrollHeight;
        setHasOverflow(scroll.scrollHeight > scroll.clientHeight + 1);
        setScrolledFromTop(scroll.scrollTop > 1);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [body, expanded]);

  return (
    <section
      className={`cot-thinking ${expanded ? '' : 'collapsed'} ${hasOverflow ? 'has-overflow' : ''} ${scrolledFromTop ? 'scrolled-from-top' : ''}`}
      data-thinking-block=""
      data-thinking-content=""
      data-direct-thinking="true"
      data-part-type="thinking"
      data-thinking-overflow={hasOverflow ? 'true' : 'false'}
      data-thinking-scrolled-from-top={scrolledFromTop ? 'true' : 'false'}
    >
      <button
        type="button"
        className="tool-group-header thinking-header"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => {
          userOverrideRef.current = true;
          setExpanded((value) => !value);
        }}
      >
        <span className="tool-group-summary thinking-summary">{summary}</span>
        <ChevronRight aria-hidden="true" className="tool-group-chevron thinking-chevron" strokeWidth={1.7} />
      </button>
      <div className="tool-group-body thinking-body" aria-hidden={!expanded}>
        <div className="thinking-collapse-wrapper">
          <div
            ref={scrollRef}
            id={contentId}
            className="tool-group-list thinking-scroll min-h-0"
            data-thinking-scroll=""
            onScroll={(event) => setScrolledFromTop(event.currentTarget.scrollTop > 1)}
          >
            <MarkdownContent markdown={body} className="cot-thinking-markdown" />
          </div>
        </div>
      </div>
    </section>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';

