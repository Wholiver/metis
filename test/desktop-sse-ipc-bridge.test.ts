import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  peekSseEventType,
  peekSseToolCallId,
  peekSseServerSequence,
  createSseIpcBridge,
} = require('../desktop/sse-ipc-bridge.cjs') as {
  peekSseEventType: (data: string) => string;
  peekSseToolCallId: (data: string) => string;
  peekSseServerSequence: (data: string) => number;
  createSseIpcBridge: (options: {
    send: (data: string) => void;
    schedule?: (fn: () => void) => unknown;
    cancel?: (id: unknown) => void;
  }) => {
    push: (data: string) => void;
    flush: () => void;
    dispose: () => void;
  };
};

function envelope(event: Record<string, unknown>, sequence: number): string {
  return JSON.stringify({
    ...event,
    serverInstanceId: 'instance-1',
    serverSequence: sequence,
    serverSessionId: 'session-1',
  });
}

function createQueuedBridge() {
  const sent: string[] = [];
  const queue: Array<() => void> = [];
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const bridge = createSseIpcBridge({
    send: (data) => sent.push(data),
    schedule: (fn) => {
      const id = nextId++;
      pending.set(id, fn);
      queue.push(fn);
      return id;
    },
    cancel: (id) => {
      const fn = pending.get(id as number);
      pending.delete(id as number);
      const index = queue.indexOf(fn as () => void);
      if (index >= 0) queue.splice(index, 1);
    },
  });
  return {
    sent,
    runScheduled: () => {
      const fn = queue.shift();
      fn?.();
    },
    bridge,
  };
}

describe('desktop SSE IPC bridge', () => {
  it('peeks envelope fields without parsing the full payload', () => {
    const data = envelope({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello "type":"nope"' }] },
    }, 42);
    expect(peekSseEventType(data)).toBe('message_update');
    expect(peekSseServerSequence(data)).toBe(42);
    expect(peekSseToolCallId(envelope({
      type: 'tool_execution_update',
      toolCallId: 'call-9',
      partialResult: { content: 'partial' },
    }, 7))).toBe('call-9');
  });

  it('drops heartbeats and coalesces message_update to the latest frame', () => {
    const { sent, runScheduled, bridge } = createQueuedBridge();
    bridge.push(envelope({ type: 'server.heartbeat', properties: { timestamp: 1 } }, 1));
    bridge.push(envelope({ type: 'message_update', message: { text: 'a' } }, 2));
    bridge.push(envelope({ type: 'message_update', message: { text: 'ab' } }, 3));
    bridge.push(envelope({ type: 'message_update', message: { text: 'abc' } }, 4));
    expect(sent).toEqual([]);
    runScheduled();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({
      type: 'message_update',
      message: { text: 'abc' },
      serverSequence: 4,
    });
  });

  it('keeps the latest tool_execution_update per toolCallId and preserves sequence order', () => {
    const { sent, runScheduled, bridge } = createQueuedBridge();
    bridge.push(envelope({ type: 'tool_execution_update', toolCallId: 'a', partialResult: '1' }, 10));
    bridge.push(envelope({ type: 'tool_execution_update', toolCallId: 'b', partialResult: '2' }, 11));
    bridge.push(envelope({ type: 'tool_execution_update', toolCallId: 'a', partialResult: '1b' }, 12));
    runScheduled();
    expect(sent.map((frame) => JSON.parse(frame))).toEqual([
      expect.objectContaining({ toolCallId: 'b', serverSequence: 11 }),
      expect.objectContaining({ toolCallId: 'a', partialResult: '1b', serverSequence: 12 }),
    ]);
  });

  it('flushes coalesced updates before a control event so sequence filters still apply', () => {
    const { sent, bridge } = createQueuedBridge();
    bridge.push(envelope({ type: 'message_update', message: { text: 'draft' } }, 20));
    bridge.push(envelope({ type: 'message_end', message: { text: 'done' } }, 21));
    expect(sent.map((frame) => JSON.parse(frame).type)).toEqual(['message_update', 'message_end']);
    expect(JSON.parse(sent[0]).serverSequence).toBe(20);
    expect(JSON.parse(sent[1]).serverSequence).toBe(21);
  });

  it('forwards session switch, abort, and user-input events immediately', () => {
    const { sent, bridge } = createQueuedBridge();
    for (const type of ['server.session_changed', 'user_input_request', 'agent_end', 'message_start']) {
      bridge.push(envelope({ type }, sent.length + 1));
    }
    expect(sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'server.session_changed',
      'user_input_request',
      'agent_end',
      'message_start',
    ]);
  });

  it('wires the main-process SSE loop through the bridge and sends JSON strings', () => {
    const main = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(main).toContain('createSseIpcBridge');
    expect(main).toContain('./sse-ipc-bridge.cjs');
    expect(main).toContain('bridge.push(data)');
    expect(main).not.toContain('webContents.send("metis:event", JSON.parse(data))');
    const preload = readFileSync(resolve(process.cwd(), 'desktop/preload.cjs'), 'utf8');
    expect(preload).toContain('ipcRenderer.on("metis:event", handler)');
  });
});
