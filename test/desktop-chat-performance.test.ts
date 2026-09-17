import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyWorkingSessionIds,
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
});
