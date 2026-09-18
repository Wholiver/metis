import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveAssistantFinalCopyText, resolveAssistantTurnLayout } from '../desktop/src/components/chat/AssistantTurn';
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

  it('keeps later intermediate text in the work area while streaming', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Opening status.',
        parts: [
          { type: 'text', id: 'open', text: 'Opening status.' },
          { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'a.ts' } },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'Checked the file, next I will patch it.',
        parts: [
          { type: 'text', id: 'mid', text: 'Checked the file, next I will patch it.' },
          { type: 'toolCall', id: 'edit-1', name: 'edit', arguments: { path: 'a.ts' } },
        ],
      },
      {
        id: 'a3',
        role: 'assistant',
        content: 'Patched and verified.',
        parts: [{ type: 'text', id: 'final', text: 'Patched and verified.' }],
      },
    ];
    const streaming = resolveAssistantTurnLayout(messages, { streaming: true });
    expect(streaming.finalText).toBe('');
    expect(streaming.workItems.filter((part) => part.type === 'text').map((part) => part.id)).toEqual(['open', 'mid', 'final']);

    const completed = resolveAssistantTurnLayout(messages);
    expect(completed.finalText).toBe('Patched and verified.');
    expect(completed.workItems.filter((part) => part.type === 'text').map((part) => part.id)).toEqual(['open', 'mid']);
  });

  it('omits empty text parts from assistant work items', () => {
    const layout = resolveAssistantTurnLayout([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', id: 'empty', text: '' },
          { type: 'toolCall', id: 'ls-1', name: 'ls', arguments: { path: '.' } },
          { type: 'text', id: 'status', text: '检查工作区文件与任务上下文。' },
        ],
      },
    ], { streaming: true });
    expect(layout.workItems.filter((part) => part.type === 'text').map((part) => part.id)).toEqual(['status']);
  });

  it('builds mode · model meta without duration', () => {
    expect(buildAssistantTurnMeta({
      collaborationMode: 'build',
      model: { provider: 'openai', id: 'muse', name: 'Muse Spark 1.3 Free' },
    })).toBe('Build · Muse Spark 1.3 Free');
    expect(buildAssistantTurnMeta({ collaborationMode: 'plan' })).toBe('Plan');
    expect(buildAssistantTurnMeta({})).toBe('');
  });

  it('keeps composer free of work-progress chrome and footer free of duration copy', () => {
    const composer = readFileSync(new URL('../desktop/src/components/chat/Composer.tsx', import.meta.url), 'utf8');
    const footer = readFileSync(new URL('../desktop/src/components/chat/AssistantTurnFooter.tsx', import.meta.url), 'utf8');
    const turn = readFileSync(new URL('../desktop/src/components/chat/AssistantTurn.tsx', import.meta.url), 'utf8');

    expect(composer).not.toContain('WorkProgressIndicator');
    expect(composer).not.toContain('workProgress');
    expect(footer).toContain('data-assistant-turn-footer');
    expect(footer).not.toMatch(/分钟|duration|elapsed/);
    expect(turn).toContain('<AssistantTurnFooter');
    expect(turn).toContain('resolveAssistantFinalCopyText');
  });
});
