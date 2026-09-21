import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import CodeBlock from '../primitives/CodeBlock';

interface MarkdownContentProps {
  markdown: string;
  className?: string;
  /** When true, skip LRU cache on the still-growing tail segment. */
  streaming?: boolean;
}

type MarkdownSegment =
  | { type: 'html'; html: string; key: string }
  | { type: 'code'; language: string; code: string; key: string };

const FENCED_CODE = /```([\w+-]*)\n([\s\S]*?)```/g;
const HTML_CACHE_LIMIT = 200;
/** Short runs are cheap to re-parse; splitting them changes wrapper height for little gain. */
const PARAGRAPH_SPLIT_MIN = 1024;
const MARKED_OPTIONS = { async: false as const, breaks: true, gfm: true };
const htmlCache = new Map<string, string>();

export function clearMarkdownHtmlCache(): void {
  htmlCache.clear();
}

function paragraphBreakAt(text: string, from: number): { index: number; width: number } | undefined {
  const crlf = text.indexOf('\r\n\r\n', from);
  const lf = text.indexOf('\n\n', from);
  if (crlf < 0 && lf < 0) return undefined;
  if (crlf < 0) return { index: lf, width: 2 };
  if (lf < 0) return { index: crlf, width: 4 };
  return crlf <= lf ? { index: crlf, width: 4 } : { index: lf, width: 2 };
}

function openFenceIndex(html: string): number {
  if (html.startsWith('```')) return 0;
  const nested = html.search(/\n```/);
  return nested < 0 ? -1 : nested + 1;
}

/** Split a markdown run into committed paragraphs plus an unparsed tail / open fence. */
export function splitHtmlBlocks(html: string, offset = 0): MarkdownSegment[] {
  if (!html) return [];
  if (html.length < PARAGRAPH_SPLIT_MIN) {
    return [{ type: 'html', html, key: `html-${offset}` }];
  }
  const fenceAt = openFenceIndex(html);
  const committedRegion = fenceAt >= 0 ? html.slice(0, fenceAt) : html;
  const openFenceRegion = fenceAt >= 0 ? html.slice(fenceAt) : '';
  const segments: MarkdownSegment[] = [];
  let local = 0;
  while (local < committedRegion.length) {
    const brk = paragraphBreakAt(committedRegion, local);
    if (!brk) break;
    const end = brk.index + brk.width;
    const chunk = committedRegion.slice(local, end);
    if (chunk.trim()) {
      segments.push({ type: 'html', html: chunk, key: `html-${offset + local}` });
    }
    local = end;
  }
  const tail = committedRegion.slice(local) + openFenceRegion;
  if (tail) {
    segments.push({ type: 'html', html: tail, key: `html-${offset + local}` });
  }
  return segments;
}

export function splitMarkdown(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(FENCED_CODE.source, 'g');
  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push(...splitHtmlBlocks(markdown.slice(lastIndex, match.index), lastIndex));
    }
    segments.push({
      type: 'code',
      language: match[1] || 'text',
      code: match[2].replace(/\n$/, ''),
      key: `code-${match.index}`,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < markdown.length) {
    segments.push(...splitHtmlBlocks(markdown.slice(lastIndex), lastIndex));
  }
  if (segments.length === 0) {
    segments.push({ type: 'html', html: markdown, key: 'html-0' });
  }
  return segments;
}

export function renderHtml(markdown: string, options?: { cache?: boolean }): string {
  const useCache = options?.cache !== false;
  if (useCache) {
    const cached = htmlCache.get(markdown);
    if (cached !== undefined) {
      htmlCache.delete(markdown);
      htmlCache.set(markdown, cached);
      return cached;
    }
  }
  const html = DOMPurify.sanitize(marked.parse(markdown, MARKED_OPTIONS) as string);
  if (useCache) {
    htmlCache.set(markdown, html);
    if (htmlCache.size > HTML_CACHE_LIMIT) {
      const oldest = htmlCache.keys().next().value;
      if (oldest !== undefined) htmlCache.delete(oldest);
    }
  }
  return html;
}

const MarkdownCodeSegment = React.memo(function MarkdownCodeSegment({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const lines = useMemo(() => code.split('\n'), [code]);
  return (
    <div className="my-2">
      <CodeBlock
        flush
        filename={language}
        lines={lines}
        code={code}
      />
    </div>
  );
});
MarkdownCodeSegment.displayName = 'MarkdownCodeSegment';

const MarkdownHtmlSegment = React.memo(function MarkdownHtmlSegment({ html }: { html: string }) {
  if (!html.trim()) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});
MarkdownHtmlSegment.displayName = 'MarkdownHtmlSegment';

function MarkdownContentInner({ markdown, className = '', streaming = false }: MarkdownContentProps) {
  const segments = useMemo(() => splitMarkdown(markdown), [markdown]);
  const lastHtmlIndex = (() => {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (segments[index].type === 'html') return index;
    }
    return -1;
  })();
  const renderedSegments = useMemo(() => segments.map((segment, index) => (
    segment.type === 'code'
      ? segment
      : {
        type: 'html' as const,
        html: renderHtml(segment.html, { cache: !streaming || index !== lastHtmlIndex }),
        key: segment.key,
      }
  )), [segments, lastHtmlIndex, streaming]);

  return (
    <div
      onClick={handleMarkdownLinkClick}
      className={`markdown-content w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}
    >
      {renderedSegments.map((segment) => {
        if (segment.type === 'code') {
          return <MarkdownCodeSegment key={segment.key} language={segment.language} code={segment.code} />;
        }
        if (!segment.html.trim()) return null;
        return <MarkdownHtmlSegment key={segment.key} html={segment.html} />;
      })}
    </div>
  );
}

export function handleMarkdownLinkClick(e: React.MouseEvent<HTMLDivElement>) {
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
}

export const MarkdownContent = React.memo(MarkdownContentInner);
MarkdownContent.displayName = 'MarkdownContent';
