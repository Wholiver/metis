import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { thinkingBody, thinkingSummary } from '../desktop/src/components/chat/ThinkingBlock';
import { toMessage } from '../desktop/src/hooks/useMetisServer';

describe('desktop React thinking block', () => {
  it('uses the first Markdown heading as its folded summary', () => {
    const thinking = '# Investigating File Permissions\n\nChecking paths and access controls.';
    expect(thinkingSummary(thinking)).toBe('Investigating File Permissions');
    expect(thinkingBody(thinking)).toBe('Checking paths and access controls.');
  });

  it('strips plain leading title when followed by body content and keeps single-line thinking', () => {
    const plainWithBody = 'Verifying Primitives\n\nI am now meticulously verifying the primitives in interp.py.';
    expect(thinkingSummary(plainWithBody)).toBe('Verifying Primitives');
    expect(thinkingBody(plainWithBody)).toBe('I am now meticulously verifying the primitives in interp.py.');

    const singleLine = 'Verifying Primitives';
    expect(thinkingSummary(singleLine)).toBe('Verifying Primitives');
    expect(thinkingBody(singleLine)).toBe('Verifying Primitives');
  });

  it('caps expanded content, fades overflow, and follows streaming updates', () => {
    const component = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ThinkingBlock.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    expect(component).toContain('aria-expanded={expanded}');
    expect(component).not.toContain('Brain');
    expect(component).toContain('scroll.scrollTop = scroll.scrollHeight');
    expect(component).toContain("data-thinking-overflow={hasOverflow ? 'true' : 'false'}");
    expect(component).toContain('[body, expanded]');
    expect(css).toMatch(/\.tool-group-list\s*\{[\s\S]*?max-height:\s*168px;[\s\S]*?overflow-y:\s*auto/);
    expect(css).toContain('--work-overflow-fade-height: 24px');
    expect(css).toContain('--work-overflow-fade: linear-gradient');
    expect(css).toContain('--work-overflow-fade-top: linear-gradient');
    expect(css).toMatch(/\.cot-thinking\.has-overflow \.thinking-body::after\s*\{[\s\S]*?height:\s*var\(--work-overflow-fade-height\);[\s\S]*?background:\s*var\(--work-overflow-fade\)/);
    expect(css).toMatch(/\.cot-thinking\.has-overflow\.scrolled-from-top \.thinking-body::before\s*\{[\s\S]*?background:\s*var\(--work-overflow-fade-top\)/);
    expect(css).not.toMatch(/\.cot-thinking\.has-overflow \.thinking-body::after\s*\{[^}]*backdrop-filter/);
    expect(component).toContain('setScrolledFromTop(scroll.scrollTop > 1)');
    expect(component).toContain('data-thinking-scrolled-from-top');
    expect(component).toContain('onScroll=');
    expect(css).toContain('--work-visual-inset: 0px');
    expect(css).toContain('--work-item-gap: 8px');
    expect(css).toMatch(/\.cot-header-bar\s*\{[\s\S]*?width:\s*100%;[\s\S]*?padding:\s*2px 0 4px;[\s\S]*?border-bottom:\s*1px solid var\(--line\)/);
    expect(css).toMatch(/\.tool-group-header\.thinking-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, max-content\) 14px;[\s\S]*?padding-left:\s*var\(--work-visual-inset\)/);
    expect(css).toMatch(/\.tool-group-header\s*\{[\s\S]*?min-height:\s*24px;[\s\S]*?padding:\s*0;/);
    expect(component).toContain('className="tool-group-summary thinking-summary"');
    expect(css).toMatch(/\.thinking-header \.thinking-summary\s*\{[\s\S]*?color:\s*#737373/);
    expect(css).toMatch(/\.cot-thinking-markdown\s*\{[\s\S]*?color:\s*#737373/);
    expect(css).toMatch(/\.markdown-content\s*\{[\s\S]*?color:\s*var\(--ink\)/);
    expect(css).toMatch(/\.markdown-content hr\s*\{[\s\S]*?display:\s*none/);
    expect(css).toMatch(/\.tool-group-summary\s*\{[\s\S]*?font-size:\s*var\(--body-copy-size\);[\s\S]*?font-weight:\s*var\(--body-copy-weight\);[\s\S]*?line-height:\s*var\(--body-copy-line-height\)/);
    expect(css).toMatch(/\.thinking-body\s*\{[\s\S]*?padding-left:\s*var\(--work-visual-inset\)/);
    expect(css).toMatch(/\.cot-text\s*\{[\s\S]*?padding-left:\s*var\(--work-visual-inset\)/);
    expect(css).toMatch(/\.thinking-scroll \.cot-thinking-markdown strong,[\s\S]*?\.thinking-scroll \.cot-thinking-markdown b\s*\{[\s\S]*?font-weight:\s*400/);
    expect(css).toContain('.thinking-skeleton-container');
    expect(css).toContain('.thinking-skeleton-line');
    expect(css).toContain('thinking-skeleton-shimmer');
    expect(component).toContain('userOverrideRef.current = true');
    expect(component).toContain('if (!userOverrideRef.current)');
    expect(css).toContain('.cot-work-item-enter');
    expect(css).toContain('cot-work-item-fade-in');
    expect(css).toContain('.tool-row-enter');
    expect(css).toContain('tool-row-slide-in');
  });

  it('keeps distinct unique IDs across different assistant messages in the same turn', () => {
    const msg1 = {
      id: 'msg-1',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'First thought' },
        { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.txt' } },
      ],
    };
    const msg2 = {
      id: 'msg-2',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Second thought' },
        { type: 'text', text: 'Final response' },
      ],
    };
    const mapped1 = toMessage(msg1);
    const mapped2 = toMessage(msg2);
    expect(mapped1?.parts?.[0].id).toBe('msg-1-thinking-0');
    expect(mapped2?.parts?.[0].id).toBe('msg-2-thinking-0');
    expect(mapped1?.parts?.[0].id).not.toBe(mapped2?.parts?.[0].id);
  });
});

