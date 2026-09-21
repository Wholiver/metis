import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('streamed assistant markdown (Streamdown)', () => {
  it('reveals live answers with Vercel Streamdown and keeps settled replies on static markdown', () => {
    const paced = source('desktop/src/components/chat/PacedMarkdown.tsx');
    const markdown = source('desktop/src/components/chat/MarkdownContent.tsx');
    const bubble = source('desktop/src/components/chat/AgentBubble.tsx');
    const css = source('desktop/src/index.css');

    expect(paced).toContain("import('streamdown')");
    expect(paced).toContain("import('@streamdown/cjk')");
    expect(paced).toContain('React.lazy');
    expect(paced).toContain('StreamdownBoundary');
    expect(paced).toContain('<MarkdownContent markdown={text}');
    expect(paced).toContain('isAnimating');
    expect(paced).toContain("animation: 'blurIn'");
    expect(paced).toContain("sep: 'word'");
    expect(paced).toContain('prefers-reduced-motion');
    expect(paced).not.toContain('createPacedTextController');
    expect(paced).not.toMatch(/^import .* from 'streamdown'/m);

    expect(markdown).not.toContain('createPacedTextController');
    expect(markdown).not.toContain('../../lib/paced-text');

    expect(bubble).toContain('<PacedMarkdown text={message.content} streaming={streaming} />');
    expect(css).toContain('@import "streamdown/styles.css"');
    expect(css).toContain('@source "../node_modules/streamdown/dist/*.js"');
    expect(css).toContain('[data-sd-animate]');
  });
});
