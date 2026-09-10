import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { thinkingBody, thinkingSummary } from '../desktop/src/components/chat/ThinkingBlock';
import { toMessage } from '../desktop/src/hooks/useMetisServer';

describe('desktop React thinking block', () => {
  it('extracts folded summary and body', () => {
    const thinking = '# Investigating File Permissions\n\nChecking paths and access controls.';
    expect(thinkingSummary(thinking)).toBe('Investigating File Permissions');
    expect(thinkingBody(thinking)).toBe('Checking paths and access controls.');
    expect(thinkingBody('Verifying Primitives')).toBe('Verifying Primitives');
  });

  it('shows only the live Thinking shimmer and hides reasoning body/title', () => {
    const turn = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantTurn.tsx'), 'utf8');
    const work = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantWork.tsx'), 'utf8');
    const thinking = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ThinkingBlock.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/styles/beautifului/opencode-session.css'), 'utf8');
    expect(turn).toContain('<AssistantWork');
    expect(turn).not.toContain('<AgentResponse');
    expect(work).toContain('<ThinkingBlock');
    expect(work).toContain('item.type !== \'thinking\'');
    expect(work).toContain('<ContextToolGroup');
    expect(work).not.toContain('data-assistant-work-status');
    expect(work).not.toContain('setTimeout(() => {\n        setRevealedCount');
    expect(thinking).toContain('data-thinking-block');
    expect(thinking).toContain('data-slot="session-turn-thinking"');
    expect(thinking).toContain('<TextShimmer');
    expect(thinking).toContain('if (!isActive) return null');
    expect(thinking).not.toContain('PacedMarkdown');
    expect(thinking).not.toContain('reasoning-part');
    expect(thinking).not.toContain('BasicTool');
    expect(thinking).not.toContain('data-scrollable');
    expect(css).toContain('[data-slot="session-turn-thinking"]');
    expect(css).toContain('[data-component="tool-trigger"]');
  });

  it('keeps unique part IDs across assistant messages', () => {
    const first = toMessage({ id: 'msg-1', role: 'assistant', content: [{ type: 'thinking', thinking: 'One' }] });
    const second = toMessage({ id: 'msg-2', role: 'assistant', content: [{ type: 'thinking', thinking: 'Two' }] });
    expect(first?.parts?.[0].id).toBe('msg-1-thinking-0');
    expect(second?.parts?.[0].id).toBe('msg-2-thinking-0');
  });
});
