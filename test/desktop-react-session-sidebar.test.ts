import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  CONVERSATION_ICON_COLORS,
  CONVERSATION_ICON_OPTICAL_Y,
  conversationIconAssignment,
} from '../desktop/src/lib/conversation-icon';
import {
  extractText,
  extractThinking,
  extractThinkingDurationMs,
  extractAssistantParts,
  getSubagentProgress,
  mergeAssistantParts,
  reconcileSessionAgents,
  sessionTitle,
  sessionToAgent,
  toMessage,
  toMessages,
  upsertConversationMessage,
} from '../desktop/src/hooks/useMetisServer';
import { composeAttachmentPayload } from '../desktop/src/lib/attachments';
import { Sidebar } from '../desktop/src/components/sidebar/Sidebar';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

const session = {
  id: 'session-1',
  path: '/tmp/project/session-1.jsonl',
  cwd: '/tmp/project',
  created: '2026-08-20T08:00:00.000Z',
  modified: '2026-08-20T09:00:00.000Z',
  messageCount: 4,
  firstMessage: 'Investigate sidebar sessions',
};

describe('desktop React session sidebar', () => {
  it('allows Desktop conversation navigation while active work continues', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    const selectConversation = source.slice(
      source.indexOf('const selectConversation'),
      source.indexOf('const newConversation'),
    );
    expect(source).not.toContain('guardSessionReplacement');
    expect(source).not.toContain('SESSION_REPLACEMENT_BUSY_MESSAGE');
    expect(appSource).toContain('if (isConnected && !isLoadingSessions) void newConversation();');
    expect(mainSource).toContain('"X-Metis-Desktop": "1"');
    expect(selectConversation.indexOf("await request('/session/switch', 'POST'")).toBeLessThan(
      selectConversation.indexOf('setMessages([])'),
    );

    const markup = renderToStaticMarkup(React.createElement(Sidebar, {
      agents: [sessionToAgent(session)],
      activeAgentId: session.id,
      width: 260,
      onSelectAgent: () => undefined,
    }));
    expect(markup).toContain(`data-conversation-row="${session.id}"`);
  });

  it('assigns each conversation a stable pseudo-random shape and color', () => {
    const assignment = conversationIconAssignment('session-1');
    expect(conversationIconAssignment('session-1')).toEqual(assignment);
    expect(assignment.shapeIndex).toBeGreaterThanOrEqual(0);
    expect(assignment.shapeIndex).toBeLessThan(8);
    expect(CONVERSATION_ICON_COLORS).toContain(assignment.color);

    const assignments = Array.from({ length: 32 }, (_, index) =>
      conversationIconAssignment(`session-${index}`)
    );
    expect(new Set(assignments.map(({ shapeIndex }) => shapeIndex)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(assignments.map(({ color }) => color)).size).toBeGreaterThanOrEqual(8);
    expect(CONVERSATION_ICON_OPTICAL_Y[4]).toBe(20);
    expect(CONVERSATION_ICON_OPTICAL_Y.filter(Boolean)).toHaveLength(1);
  });

  it('renders the supplied SVG shapes inside every conversation row', () => {
    const itemSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/AgentItem.tsx'), 'utf8');
    const iconSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/ConversationIcon.tsx'), 'utf8');
    const sprite = readFileSync(resolve(process.cwd(), 'desktop/public/assets/conversation-icons.svg'), 'utf8');

    expect(itemSource).toContain('<ConversationIcon seed={agent.id} />');
    expect(itemSource).toContain('data-conversation-row={agent.id}');
    expect(itemSource).toContain('data-conversation-content');
    expect(itemSource).toContain('min-h-[56px]');
    expect(iconSource).toContain('data-conversation-icon');
    expect(iconSource).toContain('data-conversation-icon-slot');
    expect(iconSource).toContain('size = 48');
    expect(iconSource).toContain('w-[38px]');
    expect(iconSource).toContain('transform={`translate(0 ${opticalOffsetY})`}');
    expect(iconSource).toContain('conversation-icons.svg#conversation-shape-');
    expect(iconSource).toContain('x="-125"');
    expect(iconSource).toContain('y="-125"');
    expect(sprite.match(/<symbol id="conversation-shape-/g)).toHaveLength(8);
    expect(sprite).toContain('fill="currentColor"');
    expect(sprite).toContain('fill="#fff"');
  });

  it('wires list, switch, create, messages, and prompt actions through the Server bridge', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(source).toContain("`/sessions?cwd=${encodeURIComponent(project.path)}`");
    expect(source).toContain("request('/session/switch', 'POST'");
    expect(source).toContain("request('/session/new', 'POST'");
    expect(source).toContain("request<SessionMessagesResponse>('/session/messages')");
    expect(source).toContain("request('/session/prompt', 'POST'");
    expect(source).toContain("...(options.images?.length ? { images: options.images } : {})");
    expect(source).toContain("type === 'message_start' || type === 'message_update' || type === 'message_end'");
    expect(source).toContain("event.serverSessionId !== activeSessionIdRef.current");
    expect(source).toContain("type === 'session_info_changed'");
    expect(source).toContain("type === 'session_name_generation' && event.status === 'completed'");
    expect(source).toContain("agent.id === activeSessionIdRef.current ? { ...agent, name: generatedName } : agent");
  });

  it('maps server sessions to selectable sidebar conversations', () => {
    expect(sessionTitle(session)).toBe('Investigate sidebar sessions');
    expect(sessionToAgent(session)).toMatchObject({
      id: 'session-1',
      name: 'Investigate sidebar sessions',
      subtitle: '4 messages',
      sessionPath: '/tmp/project/session-1.jsonl',
      projectPath: '/tmp/project',
    });
  });

  it('prefers generated session names and handles empty sessions', () => {
    expect(sessionTitle({ ...session, name: 'Generated title' })).toBe('Generated title');
    expect(sessionTitle({ ...session, firstMessage: '(no messages)' })).toBe('New conversation');
  });

  it('keeps the active new conversation visible while the persisted list catches up', () => {
    expect(reconcileSessionAgents([], {
      sessionId: 'new-session',
      sessionFile: '/tmp/project/new-session.jsonl',
      sessionName: 'First prompt',
    }, '/tmp/project')).toEqual([
      expect.objectContaining({
        id: 'new-session',
        name: 'First prompt',
        sessionPath: '/tmp/project/new-session.jsonl',
        projectPath: '/tmp/project',
      }),
    ]);
  });

  it('reconciles the active session name without dropping other conversations', () => {
    const other = { ...session, id: 'session-2', path: '/tmp/project/session-2.jsonl' };
    const agents = reconcileSessionAgents([session, other], {
      sessionId: session.id,
      sessionFile: session.path,
      sessionName: 'Generated title',
    }, '/tmp/project');

    expect(agents.map((agent) => agent.id)).toEqual(['session-1', 'session-2']);
    expect(agents[0].name).toBe('Generated title');
  });

  it('extracts visible text blocks and ignores tool-only blocks', () => {
    expect(extractText([
      { type: 'text', text: 'Visible' },
      { type: 'toolCall', text: 'Hidden tool payload' },
      { type: 'output_text', text: 'answer' },
    ])).toBe('Visible\nanswer');
  });

  it('restores attachment metadata and image previews from Server message history', () => {
    const attachment = {
      id: 'shot-1',
      kind: 'image' as const,
      name: 'shot.png',
      sizeText: '1.0 KB',
      mimeType: 'image/png',
      data: 'iVBORw0KGgo=',
      previewUrl: 'data:image/png;base64,iVBORw0KGgo=',
    };
    const payload = composeAttachmentPayload('Inspect this', [attachment]);
    expect(toMessage({
      role: 'user',
      content: [
        { type: 'text', text: payload.message },
        { type: 'image', mimeType: 'image/png', data: attachment.data },
      ],
    })).toMatchObject({
      content: 'Inspect this',
      attachments: [{ name: 'shot.png', previewUrl: attachment.previewUrl }],
    });
  });

  it('extracts thinking without leaking tool payloads into visible reasoning', () => {
    expect(extractThinking([
      { type: 'thinking', thinking: 'Inspect the renderer' },
      { type: 'toolCall', thinking: 'hidden tool payload' },
      { type: 'reasoning', text: 'Verify the streamed state' },
    ])).toBe('Inspect the renderer\n\nVerify the streamed state');
  });

  it('sums explicit archived thinking-segment durations', () => {
    expect(extractThinkingDurationMs([
      { type: 'thinking', thinking: 'One', durationMs: 1200 },
      { type: 'thinking', thinking: 'Two', metadata: { durationMs: 800 } },
      { type: 'text', text: 'Answer', durationMs: 9000 },
    ])).toBe(2000);
  });

  it('maps only user and assistant server messages', () => {
    const mapped = toMessages([
      { id: 'u1', role: 'user', content: 'Hello' },
      { id: 'tool1', role: 'toolResult', content: 'internal' },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ id: 'u1', role: 'user', content: 'Hello' });
    expect(mapped[1]).toMatchObject({ id: 'a1', role: 'assistant', content: 'Hi' });
    expect(mapped[1].parts).toEqual([{ type: 'text', id: 'a1-text-0', text: 'Hi' }]);
  });

  it('keeps thinking-only and mixed assistant messages', () => {
    expect(toMessage({
      id: 'thinking-1',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Checking the code path' }],
    })).toMatchObject({
      id: 'thinking-1',
      content: '',
      thinking: 'Checking the code path',
    });
    expect(toMessage({
      id: 'mixed-1',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Reason first' },
        { type: 'text', text: 'Final answer' },
      ],
    })).toMatchObject({ content: 'Final answer', thinking: 'Reason first' });
  });

  it('replaces optimistic sends and incrementally updates streamed replies', () => {
    const optimistic = {
      id: 'optimistic-user-1',
      role: 'user' as const,
      content: 'Hello',
      optimistic: true,
    };
    const serverUser = toMessage({ role: 'user', timestamp: 10, content: 'Hello' });
    const partial = toMessage({ role: 'assistant', timestamp: 20, content: [{ type: 'text', text: 'Hel' }] }, 0, true);
    const complete = toMessage({ role: 'assistant', timestamp: 20, content: [{ type: 'text', text: 'Hello back' }] });
    expect(serverUser).toBeDefined();
    expect(partial).toBeDefined();
    expect(complete).toBeDefined();

    let messages = upsertConversationMessage([optimistic], serverUser!);
    expect(messages).toHaveLength(1);
    expect(messages[0].optimistic).toBeUndefined();
    messages = upsertConversationMessage(messages, partial!);
    messages = upsertConversationMessage(messages, complete!);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ content: 'Hello back', serverTimestamp: 20 });
    expect(messages[1].streaming).toBeUndefined();
  });

  it('preserves emitted thinking when a partial stream snapshot omits it', () => {
    const existing = {
      id: 'assistant-stream',
      role: 'assistant' as const,
      content: '',
      thinking: 'Inspecting files',
      streaming: true,
    };
    const partial = {
      id: 'assistant-stream',
      role: 'assistant' as const,
      content: 'Still working',
      streaming: true,
    };
    expect(upsertConversationMessage([existing], partial)[0]).toMatchObject({
      content: 'Still working',
      thinking: 'Inspecting files',
    });
  });

  it('preserves archived work-part order across partial streaming snapshots', () => {
    const previous = extractAssistantParts([
      { type: 'thinking', id: 'thought-1', thinking: 'Inspecting' },
      { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'a.ts' } },
    ]);
    const incoming = extractAssistantParts([
      { type: 'thinking', id: 'thought-1', thinking: 'Inspecting more' },
      { type: 'text', id: 'final-1', text: 'Done' },
    ]);
    expect(mergeAssistantParts(previous, incoming).map((part) => part.id)).toEqual([
      'thought-1',
      'tool-1',
      'final-1',
    ]);
  });

  it('correlates tool results into their archived Tool card parts', () => {
    const mapped = toMessages([
      { role: 'assistant', id: 'a-tool', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'a.ts' } }] },
      { role: 'toolResult', toolCallId: 'read-1', content: [{ type: 'text', text: 'file contents' }] },
    ]);
    expect(mapped[0].parts?.[0]).toMatchObject({
      type: 'toolCall',
      id: 'read-1',
      name: 'read',
      result: { content: 'file contents', isError: false },
    });
  });

  it('restores persisted assistant completion timestamps for accurate turn timing', () => {
    const messages = toMessages([
      { role: 'assistant', timestamp: 2000, content: [{ type: 'thinking', thinking: 'Working' }] },
    ], [
      { messageTimestamp: 2000, completedAt: 9500 },
    ]);
    expect(messages[0]).toMatchObject({ serverTimestamp: 2000, completedAt: 9500 });
  });

  it('keeps archived asynchronous subagent cards running until their completion marker arrives', () => {
    const part = {
      type: 'toolCall' as const,
      id: 'tool-call-kqpvqh',
      name: 'spawn_agent',
      arguments: { agent: 'implementer', task: 'Restore tools', mode: 'async' },
    };
    const running = [
      { role: 'assistant', timestamp: 1000, content: [part] },
      { role: 'toolResult', toolCallId: part.id, timestamp: 1200, content: 'Subagent Job kqpvqh started' },
    ];
    expect(getSubagentProgress(part, running)).toEqual({ jobId: 'kqpvqh', state: 'running', startedAt: 1000 });

    const completed = [
      ...running,
      { role: 'custom', customType: 'subagent_result', timestamp: 4000, content: '[Subagent Job kqpvqh finished]\n\nDone' },
    ];
    expect(getSubagentProgress(part, completed)).toEqual({
      jobId: 'kqpvqh',
      state: 'completed',
      startedAt: 1000,
      completedAt: 4000,
      durationMs: 3000,
    });
    expect(toMessages(completed)[0].parts?.[0]).toMatchObject({
      type: 'toolCall',
      progress: { jobId: 'kqpvqh', state: 'completed', durationMs: 3000 },
    });
  });

  it('maps archived synchronous subagent result payload errors to failed cards', () => {
    const part = {
      type: 'toolCall' as const,
      id: 'tool-call-spwn02',
      name: 'spawn_agent',
      arguments: { agent: 'implementer', task: 'Write code', mode: 'sync' },
    };
    expect(getSubagentProgress(part, [
      { role: 'assistant', timestamp: 1000, content: [part] },
      { role: 'toolResult', toolCallId: part.id, timestamp: 2450, content: JSON.stringify({ status: 'error' }) },
    ])).toEqual({
      jobId: 'spwn02',
      state: 'failed',
      startedAt: 1000,
      completedAt: 2450,
      durationMs: 1450,
    });

    expect(getSubagentProgress(part, [
      { role: 'assistant', timestamp: 1000, content: [part] },
      { role: 'toolResult', toolCallId: part.id, timestamp: 9000, content: JSON.stringify({ status: 'completed', elapsedSec: 2.75 }) },
    ])).toMatchObject({ state: 'completed', durationMs: 2750 });
  });

  it('reserves native traffic light spacing in ChatHeader when sidebar is collapsed', () => {
    const headerSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatHeader.tsx'), 'utf8');
    const chatAreaSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'), 'utf8');
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(headerSource).toContain('w-[66px]');
    expect(headerSource).toContain('!isSidebarOpen');
    expect(headerSource).toContain('PanelLeftOpen');
    expect(headerSource).toContain('onNewChat');
    expect(chatAreaSource).toContain('onNewChat={onNewChat}');
    expect(appSource).toContain('onNewChat={newConversation}');
  });
});

