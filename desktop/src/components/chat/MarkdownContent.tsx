import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import CodeBlock from '../primitives/CodeBlock';

interface MarkdownContentProps {
  markdown: string;
  className?: string;
}

type MarkdownSegment =
  | { type: 'html'; html: string }
  | { type: 'code'; language: string; code: string; key: string };

const FENCED_CODE = /```([\w+-]*)\n([\s\S]*?)```/g;
const HTML_CACHE_LIMIT = 200;
const htmlCache = new Map<string, string>();

export function clearMarkdownHtmlCache(): void {
  htmlCache.clear();
}

export function splitMarkdown(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let codeIndex = 0;
  const pattern = new RegExp(FENCED_CODE.source, 'g');
  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'html', html: markdown.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1] || 'text',
      code: match[2].replace(/\n$/, ''),
      key: `code-${codeIndex++}-${match.index}`,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < markdown.length) {
    segments.push({ type: 'html', html: markdown.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ type: 'html', html: markdown });
  }
  return segments;
}

export function renderHtml(markdown: string): string {
  const cached = htmlCache.get(markdown);
  if (cached !== undefined) {
    // Refresh LRU order.
    htmlCache.delete(markdown);
    htmlCache.set(markdown, cached);
    return cached;
  }
  const html = DOMPurify.sanitize(marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string);
  htmlCache.set(markdown, html);
  if (htmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
  return html;
}

function MarkdownContentInner({ markdown, className = '' }: MarkdownContentProps) {
  const segments = useMemo(() => splitMarkdown(markdown), [markdown]);
  const renderedSegments = useMemo(() => segments.map((segment) => (
    segment.type === 'code'
      ? segment
      : { type: 'html' as const, html: renderHtml(segment.html) }
  )), [segments]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (target && target.href && (target.href.startsWith('http://') || target.href.startsWith('https://'))) {
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('metis:open-browser', {
          detail: { url: target.href, newTab: true },
        }));
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`markdown-content w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}
    >
      {renderedSegments.map((segment, index) => {
        if (segment.type === 'code') {
          return (
            <div key={segment.key} className="my-2">
              <CodeBlock
                flush
                filename={segment.language}
                lines={segment.code.split('\n')}
                code={segment.code}
              />
            </div>
          );
        }
        if (!segment.html.trim()) return null;
        return (
          <div
            key={`html-${index}`}
            dangerouslySetInnerHTML={{ __html: segment.html }}
          />
        );
      })}
    </div>
  );
}

export const MarkdownContent = React.memo(MarkdownContentInner);
MarkdownContent.displayName = 'MarkdownContent';
