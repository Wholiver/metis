import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveAssistantFinalCopyText } from '../desktop/src/components/chat/AssistantTurn';
import { buildAssistantTurnMeta } from '../desktop/src/components/chat/AssistantTurnFooter';
import type { Message } from '../desktop/src/types';

describe('assistant turn footer', () => {
  it('copies only the final assistant text part, not tools or thinking', () => {
    const messages: Message[] = [{
      id: 'a1',
      role: 'assistant',
      content: 'final answer',
      thinking: 'secret reasoning',
      parts: [
        { type: 'thinking', id: 't1', thinking: 'secret reasoning' },
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' }, result: { content: 'ok' } },
        { type: 'text', id: 'x1', text: 'draft note' },
        { type: 'text', id: 'x2', text: 'final answer' },
      ],
    }];

    expect(resolveAssistantFinalCopyText(messages)).toBe('final answer');
    expect(resolveAssistantFinalCopyText(messages, { streaming: true })).toBe('');
  });

  it('builds mode · model meta without duration', () => {
    expect(buildAssistantTurnMeta({
      collaborationMode: 'build',
      model: { provider: 'openai', id: 'muse', name: 'Muse Spark 1.3 Free' },
    })).toBe('Build · Muse Spark 1.3 Free');
    expect(buildAssistantTurnMeta({ collaborationMode: 'plan' })).toBe('Plan');
    expect(buildAssistantTurnMeta({})).toBe('');
  });

  it('hides idle all-set mascot in composer and keeps footer free of duration copy', () => {
    const composer = readFileSync(new URL('../desktop/src/components/chat/Composer.tsx', import.meta.url), 'utf8');
    const footer = readFileSync(new URL('../desktop/src/components/chat/AssistantTurnFooter.tsx', import.meta.url), 'utf8');
    const turn = readFileSync(new URL('../desktop/src/components/chat/AssistantTurn.tsx', import.meta.url), 'utf8');

    expect(composer).toContain('workProgress && !isWorkIdle');
    expect(composer).not.toContain('idle={isWorkIdle}');
    expect(footer).toContain('data-assistant-turn-footer');
    expect(footer).not.toMatch(/分钟|duration|elapsed/);
    expect(turn).toContain('<AssistantTurnFooter');
    expect(turn).toContain('resolveAssistantFinalCopyText');
  });
});
