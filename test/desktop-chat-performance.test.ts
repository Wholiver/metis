import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyWorkingSessionIds,
  mergeAssistantParts,
  reuseStableMessages,
  toMessage,
} from '../desktop/src/hooks/useMetisServer';
import { splitMarkdown } from '../desktop/src/components/chat/MarkdownContent';
import { applyToolExecutionEnd, applyToolExecutionUpdate } from '../desktop/src/lib/tool-execution-update';
import { isToolCallFinished, toolStatus, type ToolPart } from '../desktop/src/components/chat/ToolCard';
import type { Message } from '../desktop/src/types';

describe('desktop chat performance helpers', () => {
  it('reuses prior message object identity when snapshot content is unchanged', () => {
    const first = toMessage({
      role: 'assistant',
      id: 'a1',
      timestamp: 1000,
      content: [{ type: 'text', text: 'Hello' }],
    })!;
    const previous: Message[] = [first];
    const rebuilt = toMessage({
      role: 'assistant',
      id: 'a1',
      timestamp: 1000,
      content: [{ type: 'text', text: 'Hello' }],
    })!;
    const next = reuseStableMessages(previous, [rebuilt]);
    expect(next).toBe(previous);
    expect(next[0]).toBe(first);

    const changed = toMessage({
      role: 'assistant',
      id: 'a1',
      timestamp: 1000,
      content: [{ type: 'text', text: 'Hello world' }],
    })!;
    const updated = reuseStableMessages(previous, [changed]);
    expect(updated).not.toBe(previous);
    expect(updated[0]).not.toBe(first);
    expect(updated[0].content).toBe('Hello world');
  });

  it('keeps the same working-session Set when membership is unchanged', () => {
    const current = new Set(['s1', 's2']);
    expect(applyWorkingSessionIds(current, ['s1'], true)).toBe(current);
    expect(applyWorkingSessionIds(current, ['s3'], false)).toBe(current);

    const withAdded = applyWorkingSessionIds(current, ['s3'], true);
    expect(withAdded).not.toBe(current);
    expect([...withAdded].sort()).toEqual(['s1', 's2', 's3']);

    const withRemoved = applyWorkingSessionIds(withAdded, ['s3'], false);
    expect([...withRemoved].sort()).toEqual(['s1', 's2']);
  });

  it('ships markdown html LRU and stable segment splitting', () => {
    const markdownSource = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MarkdownContent.tsx'),
      'utf8',
    );
    expect(markdownSource).toContain('HTML_CACHE_LIMIT = 200');
    expect(markdownSource).toContain('htmlCache');
    expect(markdownSource).toContain('React.memo(MarkdownContentInner)');
    expect(splitMarkdown('before\n```ts\nconst x = 1\n```\nafter')).toHaveLength(3);
  });

  it('marks tools completed on tool_execution_end so shimmer can stop without a snapshot', () => {
    const messages: Message[] = [{
      id: 'msg-1',
      role: 'assistant',
      content: '',
      parts: [{
        type: 'toolCall',
        id: 'call-read-1',
        name: 'read',
        arguments: { path: 'README.md' },
      }],
    }];
    const running = applyToolExecutionUpdate(messages, 'call-read-1', {
      content: [{ type: 'text', text: 'partial' }],
    });
    expect(toolStatus(running[0].parts![0] as ToolPart, true)).toBe('Running');

    const ended = applyToolExecutionEnd(running, 'call-read-1', '# Readme', false);
    const part = ended[0].parts![0] as ToolPart;
    expect(part).toMatchObject({
      type: 'toolCall',
      result: { content: '# Readme' },
      progress: { state: 'completed' },
    });
    expect(isToolCallFinished(part)).toBe(true);
    expect(toolStatus(part, true)).toBe('Completed');
  });

  it('reuses unchanged toolCall part identity across streaming snapshots', () => {
    const first = {
      type: 'toolCall' as const,
      id: 'bash-1',
      name: 'bash',
      arguments: { command: 'ls' },
      result: { content: 'ok' },
    };
    const later = {
      type: 'toolCall' as const,
      id: 'bash-1',
      name: 'bash',
      arguments: { command: 'ls' },
      result: { content: 'ok' },
    };
    const incoming = [
      { type: 'toolCall' as const, id: 'bash-1', name: 'bash', arguments: { command: 'ls' } },
      { type: 'toolCall' as const, id: 'shot-2', name: 'browser_take_screenshot', arguments: { tabId: 'browser-3' } },
    ];
    const merged = mergeAssistantParts([first], incoming);
    expect(merged[0]).toBe(first);
    expect(merged[0]).not.toBe(later);
    expect(merged.map((part) => part.id)).toEqual(['bash-1', 'shot-2']);
  });

  it('reuses every prior toolCall when a long computer-use turn appends one more tool', () => {
    const previous = Array.from({ length: 40 }, (_, index) => ({
      type: 'toolCall' as const,
      id: `tool-${index}`,
      name: index % 2 === 0 ? 'bash' : 'browser_take_screenshot',
      arguments: index % 2 === 0
        ? { command: `cat <<'EOF' > file-${index}.svg\n${'M'.repeat(4000)}\nEOF` }
        : { tabId: 'browser-3' },
      result: { content: index % 2 === 0 ? 'ok' : `snapshot-${'x'.repeat(8000)}` },
    }));
    const incoming = [
      ...previous.map((part) => ({
        ...part,
        arguments: { ...part.arguments },
        result: part.result ? { ...part.result } : undefined,
      })),
      {
        type: 'toolCall' as const,
        id: 'tool-new',
        name: 'browser_navigate',
        arguments: { url: 'file:///tmp/out.svg' },
      },
    ];
    const merged = mergeAssistantParts(previous, incoming);
    expect(merged).toHaveLength(41);
    for (let index = 0; index < 40; index += 1) {
      expect(merged[index]).toBe(previous[index]);
    }
    expect(merged[40]?.id).toBe('tool-new');
  });
});
