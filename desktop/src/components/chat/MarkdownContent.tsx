import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

interface MarkdownContentProps {
  markdown: string;
  className?: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ markdown, className = '' }) => {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string), [markdown]);

  return (
    <div
      className={`markdown-content w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

