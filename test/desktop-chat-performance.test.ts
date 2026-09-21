import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adoptSnapshotWithoutRegressing,
  applyStreamBatch,
  applyWorkingSessionIds,
  isPlaceholderSessionName,
  mergeAssistantParts,
  messageIsStrictlyAhead,
  parseMetisIpcEvent,
  queuePendingToolUpdate,
  reuseStableMessages,
  sessionNameFromPrompt,
  toMessage,
  upsertConversationMessage,
  type PendingStreamBatch,
} from '../desktop/src/hooks/useMetisServer';
import { messageListContentEpoch } from '../desktop/src/components/chat/MessageList';
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

  it('ships markdown html LRU, paced parse, and stable segment splitting', () => {
    const markdownSource = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MarkdownContent.tsx'),
      'utf8',
    );
    expect(markdownSource).toContain('HTML_CACHE_LIMIT = 200');
    expect(markdownSource).toContain('htmlCache');
    expect(markdownSource).toContain('React.memo(MarkdownContentInner)');
    expect(markdownSource).toContain('PARAGRAPH_SPLIT_MIN = 1024');
    expect(markdownSource).not.toContain('createPacedTextController');
    expect(markdownSource).toContain('cache: !streaming || index !== lastHtmlIndex');
    expect(markdownSource).toContain('MarkdownHtmlSegment');
    expect(splitMarkdown('before\n```ts\nconst x = 1\n```\nafter')).toHaveLength(3);

    const prefix = `${'Committed paragraph. '.repeat(80)}\n\n`;
    const growing = `${prefix}Para 2 being streamed`;
    const grown = `${growing} further`;
    const first = splitMarkdown(growing);
    const second = splitMarkdown(grown);
    expect(first[0]).toMatchObject({ type: 'html', key: 'html-0', html: prefix });
    expect(first[1]?.key).toBe(`html-${prefix.length}`);
    expect(second[0]).toEqual(first[0]);
    expect(second[1]?.key).toBe(first[1]?.key);
    expect(second[1]?.type === 'html' && second[1].html.startsWith('Para 2')).toBe(true);

    const list = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MessageList.tsx'),
      'utf8',
    );
    expect(list).toContain('messageListContentEpoch');
    expect(list).toContain('Text-token length is intentionally omitted');
    expect(list).not.toContain('lastMessage.content.length');
    expect(list).toContain('[sessionId, latestUserId, scrollFollowEpoch, isLoading, resume, scrollToBottom]');
  });

  it('keeps conversation list identity when an upsert repeats the same assistant snapshot', () => {
    const tool = {
      type: 'toolCall' as const,
      id: 't1',
      name: 'read',
      arguments: { path: 'a.ts' },
      result: { content: 'ok' },
    };
    const first: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Hello',
      streaming: true,
      serverTimestamp: 1000,
      parts: [{ type: 'text', id: 'text-1', text: 'Hello' }, tool],
    };
    const messages = [first];
    const repeated: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Hello',
      streaming: true,
      serverTimestamp: 1000,
      parts: [{ type: 'text', id: 'text-1', text: 'Hello' }, { ...tool, arguments: { path: 'a.ts' }, result: { content: 'ok' } }],
    };
    const next = upsertConversationMessage(messages, repeated);
    expect(next).toBe(messages);
    expect(next[0]).toBe(first);

    const grown: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Hello world',
      streaming: true,
      serverTimestamp: 1000,
      parts: [{ type: 'text', id: 'text-1', text: 'Hello world' }, { ...tool, arguments: { path: 'a.ts' }, result: { content: 'ok' } }],
    };
    const updated = upsertConversationMessage(messages, grown);
    expect(updated).not.toBe(messages);
    expect(updated[0].content).toBe('Hello world');
    expect(updated[0].parts?.find((part) => part.type === 'toolCall')).toBe(tool);
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

  it('parses JSON-string IPC events and ignores invalid payloads', () => {
    expect(parseMetisIpcEvent('{"type":"message_update","serverSequence":3}')).toEqual({
      type: 'message_update',
      serverSequence: 3,
    });
    expect(parseMetisIpcEvent({ type: 'agent_end' })).toEqual({ type: 'agent_end' });
    expect(parseMetisIpcEvent('not-json')).toBeUndefined();
    expect(parseMetisIpcEvent(null)).toBeUndefined();
  });

  it('applies a coalesced stream batch in one pass and drops it after a session switch', () => {
    const previous: Message[] = [{
      id: 'msg-1',
      role: 'assistant',
      content: 'Hi',
      parts: [{
        type: 'toolCall',
        id: 'call-1',
        name: 'read',
        arguments: { path: 'README.md' },
      }],
    }];
    const next = applyStreamBatch(previous, {
      sessionId: 'session-a',
      message: {
        raw: {
          role: 'assistant',
          id: 'msg-1',
          content: [
            { type: 'text', text: 'Hi there' },
            { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } },
          ],
        },
        streaming: true,
      },
      tools: new Map([
        ['call-1', { kind: 'update', partialResult: { content: [{ type: 'text', text: 'partial' }] } }],
      ]),
    }, 'session-a');
    expect(next).not.toBe(previous);
    expect(next[0].content).toBe('Hi there');
    expect(next[0].streaming).toBe(true);
    const tool = next[0].parts?.find((part) => part.type === 'toolCall');
    expect(tool).toMatchObject({
      type: 'toolCall',
      id: 'call-1',
      result: { content: 'partial' },
    });

    const ignored = applyStreamBatch(previous, {
      sessionId: 'session-a',
      message: {
        raw: { role: 'assistant', id: 'msg-1', content: [{ type: 'text', text: 'stale' }] },
        streaming: true,
      },
      tools: new Map(),
    }, 'session-b');
    expect(ignored).toBe(previous);
  });

  it('coalesces streaming message and tool updates on rAF and skips token-cost IPC while streaming', () => {
    const server = readFileSync(
      resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'),
      'utf8',
    );
    expect(server).toContain('parseMetisIpcEvent(payload)');
    expect(server).toContain('scheduleStreamBatch');
    expect(server).toContain('window.requestAnimationFrame');
    expect(server).toContain('STREAM_FLUSH_FALLBACK_MS');
    expect(server).toContain('adoptSnapshotWithoutRegressing');
    expect(server).toContain('queuePendingToolUpdate');
    expect(server).toContain('flushPendingStreamRef.current()');
    expect(server).toContain('if (project) void loadProject(project, false);');
    expect(server).toContain('reconcileCurrentSession()');
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    expect(app).toContain('if (isStreaming) return;');
    expect(app).toContain('}, [agents, isStreaming]);');
    expect(app).not.toContain('}, [agents, messages]);');
    expect(app).toContain('onOpenSettings={handleOpenSettings}');
  });

  it('does not let a shorter snapshot erase live streaming tokens', () => {
    const live: Message[] = [
      { id: 'u1', role: 'user', content: 'Hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Hello world from the live stream',
        streaming: true,
        parts: [{ type: 'text', id: 't1', text: 'Hello world from the live stream' }],
      },
    ];
    const snapshot: Message[] = [
      { id: 'u1', role: 'user', content: 'Hi' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Hello',
        streaming: true,
        usage: { input: 10, output: 2, totalTokens: 12, cost: 0 },
        parts: [{ type: 'text', id: 't1', text: 'Hello' }],
      },
    ];
    expect(messageIsStrictlyAhead(live[1], snapshot[1])).toBe(true);
    const next = adoptSnapshotWithoutRegressing(live, snapshot);
    expect(next[1].content).toBe('Hello world from the live stream');
    expect(next[1].usage?.totalTokens).toBe(12);
  });

  it('keeps a live assistant message that the snapshot has not caught yet', () => {
    const live: Message[] = [
      { id: 'optimistic-user-1', role: 'user', content: 'Hi', optimistic: true },
      { id: 'a1', role: 'assistant', content: 'Working', streaming: true },
    ];
    const snapshot: Message[] = [
      { id: 'u1', role: 'user', content: 'Hi' },
    ];
    const next = adoptSnapshotWithoutRegressing(live, snapshot);
    expect(next.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(next[1].content).toBe('Working');
  });

  it('reuses message identity until usage fields the token bar shows actually change', () => {
    const first = toMessage({
      role: 'assistant',
      id: 'a1',
      timestamp: 1000,
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: 0 },
    })!;
    const sameTotalDifferentSplit = toMessage({
      role: 'assistant',
      id: 'a1',
      timestamp: 1000,
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input: 8, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: 0 },
    })!;
    const next = reuseStableMessages([first], [sameTotalDifferentSplit]);
    expect(next[0]).not.toBe(first);
    expect(next[0].usage?.output).toBe(6);
  });

  it('does not reuse a toolCall part identity when streaming arguments change', () => {
    const previous = [{
      type: 'toolCall' as const,
      id: 'bash-1',
      name: 'bash',
      arguments: { command: 'ls' },
      result: { content: 'ok' },
    }];
    const incoming = [{
      type: 'toolCall' as const,
      id: 'bash-1',
      name: 'bash',
      arguments: { command: 'ls -la' },
      result: { content: 'ok' },
    }];
    const merged = mergeAssistantParts(previous, incoming);
    expect(merged[0]).not.toBe(previous[0]);
    expect(merged[0]).toMatchObject({ arguments: { command: 'ls -la' }, result: { content: 'ok' } });
  });

  it('does not let a later partial overwrite a completed tool in the same stream batch', () => {
    const batch: PendingStreamBatch = { sessionId: 's1', tools: new Map() };
    queuePendingToolUpdate(batch, 'call-1', { kind: 'end', result: 'done', isError: false });
    queuePendingToolUpdate(batch, 'call-1', { kind: 'update', partialResult: { content: 'stale' } });
    expect(batch.tools.get('call-1')?.kind).toBe('end');
  });

  it('promotes a placeholder session title from the first prompt immediately', () => {
    expect(isPlaceholderSessionName('New conversation')).toBe(true);
    expect(isPlaceholderSessionName('New conversation · metis_v2')).toBe(true);
    expect(isPlaceholderSessionName('Investigate sidebar')).toBe(false);
    expect(sessionNameFromPrompt('Fix the stale rAF flush\nmore detail')).toBe('Fix the stale rAF flush');
  });

  it('changes the scroll-follow epoch when a tool starts or finishes, not when tokens grow', () => {
    const base: Message[] = [{
      id: 'a1',
      role: 'assistant',
      content: 'Hi',
      parts: [{ type: 'text', id: 't1', text: 'Hi' }],
    }];
    const longerText: Message[] = [{
      ...base[0],
      content: 'Hi there',
      parts: [{ type: 'text', id: 't1', text: 'Hi there' }],
    }];
    expect(messageListContentEpoch(base, true)).toBe(messageListContentEpoch(longerText, true));

    const withTool: Message[] = [{
      ...base[0],
      parts: [
        { type: 'text', id: 't1', text: 'Hi' },
        { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'a.ts' } },
      ],
    }];
    expect(messageListContentEpoch(withTool, true)).not.toBe(messageListContentEpoch(base, true));

    const finished = [{
      ...withTool[0],
      parts: [
        { type: 'text', id: 't1', text: 'Hi' },
        { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'a.ts' }, result: { content: 'ok' }, progress: { jobId: 'read-1', state: 'completed' as const } },
      ],
    }];
    expect(messageListContentEpoch(finished, true)).not.toBe(messageListContentEpoch(withTool, true));
  });
});
