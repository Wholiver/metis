import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop React user message bubble', () => {
  it('uses a white surface with a visible border for sent user message blocks', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/UserBubble.tsx'),
      'utf8',
    );

    expect(source).toContain('data-user-bubble=""');
    expect(source).toContain('bg-surface');
    expect(source).toContain('border border-line');
    expect(source).toContain('rounded-[10px]');
    expect(source).not.toContain('bg-[#f1f1f1]');
  });

  it('keeps subagent assigned-task blocks visually aligned with user bubbles', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/inspector/SubagentDetailView.tsx'),
      'utf8',
    );

    expect(source).toContain('data-user-bubble=""');
    expect(source).toContain('bg-surface');
    expect(source).toContain('rounded-card');
    expect(source).toContain('shadow-card');
    expect(source).not.toContain('bg-[#f1f3f6]');
  });
});
