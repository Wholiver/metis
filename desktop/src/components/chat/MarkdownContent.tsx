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

function splitMarkdown(markdown: string): MarkdownSegment[] {
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

function renderHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string);
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ markdown, className = '' }) => {
  const segments = useMemo(() => splitMarkdown(markdown), [markdown]);

  return (
    <div className={`markdown-content w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}>
      {segments.map((segment, index) => {
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
        const html = renderHtml(segment.html);
        if (!html.trim()) return null;
        return (
          <div
            key={`html-${index}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
};
