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
  formatSessionTime,
  getSubagentProgress,
  isSessionOwnedByProject,
  mergeAssistantParts,
  pathsEqual,
  reconcileSessionAgents,
  sessionSubtitle,
  sessionTitle,
  sessionToAgent,
  toMessage,
  toMessages,
  upsertConversationMessage,
} from '../desktop/src/hooks/useMetisServer';
import { composeAttachmentPayload } from '../desktop/src/lib/attachments';
import { Sidebar } from '../desktop/src/components/sidebar/Sidebar';
import { ProjectDots } from '../desktop/src/components/sidebar/ProjectDots';

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
    expect(selectConversation).toContain("await request<SessionState & { cancelled: boolean }>('/session/switch'");
    expect(selectConversation).toContain('await loadMessages(targetSessionId, true)');

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

  it('renders text-only conversation rows without colorful conversation icons', () => {
    const itemSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/AgentItem.tsx'), 'utf8');
    const sidebarSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/Sidebar.tsx'), 'utf8');
    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');

    expect(itemSource).not.toContain('ConversationIcon');
    expect(itemSource).toContain('data-conversation-row={agent.id}');
    expect(itemSource).toContain('data-conversation-content');
    expect(itemSource).toContain('h-8');
    expect(itemSource).toContain('rounded-[8px]');
    expect(sidebarSource).not.toContain('ConversationIcon');
    expect(sidebarSource).toContain('data-new-conversation-action');
    expect(sidebarSource).toContain('data-sidebar-projects');
    expect(sidebarSource).toContain('data-project-row');
    expect(sidebarSource).toContain('data-add-project-button');
    expect(sidebarSource).toContain('data-sidebar-footer');
    expect(sidebarSource).toContain('pl-[30px]');
    expect(sidebarSource).toContain('indented: true');
    expect(sidebarSource).toContain('bg-hover-2');
    expect(sidebarSource).toContain('data-conversation-indicator');
    expect(mainSource).toContain('activeIndicator: boxMetrics(activeIndicator)');
    expect(mainSource).toContain('settingsButton: boxMetrics(settingsButton)');
    expect(sidebarSource).toContain('data-project-conversations');
    expect(sidebarSource).toContain('data-show-more-conversations');
    expect(sidebarSource).toContain('min-w-[224px]');
    expect(sidebarSource).toContain('rounded-[7px] bg-hover-2');
    expect(sidebarSource).not.toContain('ProjectDots');
    expect(itemSource).toContain("indented ? 'pl-[30px] pr-2' : 'px-2'");
    expect(itemSource).toContain('PixelOrbitLoader');
    expect(itemSource).toContain('data-conversation-working');
    expect(itemSource).toContain('absolute right-full');
    expect(sidebarSource).toContain('workingAgentId');
    expect(sidebarSource).toContain('isWorking={Boolean(workingAgentId) && agent.id === workingAgentId}');
  });

  it('ships the orbiting pixel loader used for working conversations', () => {
    const loader = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/PixelOrbitLoader.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/styles/beautifului/foundation.css'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(loader).toContain('text-ink-3');
    expect(loader).toContain('ORBIT_ORDER');
    expect(loader).toContain('pixel-on');
    expect(css).toContain('@keyframes pixel-on');
    expect(loader).toContain('opacity: delay === null ? 0.12 : 0.28');
    expect(app).toContain('workingAgentId=');
    expect(app).toContain('isStreaming || isCompacting');
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

  it('formats session timestamps as compact relative labels', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    expect(formatSessionTime('2026-09-08T11:56:00.000Z', now)).toBe('4m');
    expect(formatSessionTime('2026-09-08T11:00:00.000Z', now)).toBe('1h');
    expect(formatSessionTime('2026-09-06T12:00:00.000Z', now)).toBe('2d');
    expect(formatSessionTime('not-a-date', now)).toBe('');
  });

  it('maps server sessions to selectable sidebar conversations', () => {
    expect(sessionTitle(session)).toBe('Investigate sidebar sessions');
    expect(sessionSubtitle(session)).toBe('Investigate sidebar sessions');
    expect(sessionToAgent(session)).toMatchObject({
      id: 'session-1',
      name: 'Investigate sidebar sessions',
      subtitle: 'Investigate sidebar sessions',
      sessionPath: '/tmp/project/session-1.jsonl',
      projectPath: '/tmp/project',
    });
    expect(sessionToAgent({ ...session, lastMessage: 'Latest user prompt' })).toMatchObject({
      subtitle: 'Latest user prompt',
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

  it('does not inject an active session from another project into the project agent list', () => {
    const foreignState = {
      sessionId: 'foreign-session',
      sessionName: 'Foreign conversation',
      sessionFile: '/Users/test/.metis/agent/sessions/--Users-test-other-project--/foreign-session.jsonl',
      cwd: '/Users/test/other-project',
    };
    const localSessions = [session];
    const agents = reconcileSessionAgents(localSessions, foreignState, '/tmp/project');

    expect(agents.map((agent) => agent.id)).toEqual(['session-1']);
    expect(agents.some((agent) => agent.id === 'foreign-session')).toBe(false);
  });

  it('rejects foreign sessions based on sessionFile when cwd is missing', () => {
    const foreignState = {
      sessionId: 'foreign-session-2',
      sessionName: 'Another foreign conversation',
      sessionFile: '/Users/test/.metis/agent/sessions/--Users-test-other--/s2.jsonl',
    };
    const agents = reconcileSessionAgents([], foreignState, '/tmp/project');
    expect(agents).toEqual([]);
  });

  it('keeps new conversation when cwd matches projectPath with trailing slashes', () => {
    const agents = reconcileSessionAgents([], {
      sessionId: 'new-session-cwd',
      sessionName: 'New chat',
      cwd: '/tmp/project/',
    }, '/tmp/project');

    expect(agents).toEqual([
      expect.objectContaining({
        id: 'new-session-cwd',
        name: 'New chat',
        projectPath: '/tmp/project',
      }),
    ]);
  });

  it('correctly compares paths across platforms and slashes with pathsEqual', () => {
    expect(pathsEqual('/tmp/project', '/tmp/project/')).toBe(true);
    expect(pathsEqual('/tmp/project//', '/tmp/project')).toBe(true);
    expect(pathsEqual('C:\\Users\\test\\proj', 'c:/users/test/proj/')).toBe(true);
    expect(pathsEqual('/tmp/projA', '/tmp/projB')).toBe(false);
    expect(pathsEqual(undefined, '/tmp/proj')).toBe(false);
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

  it('keeps terminal Provider errors visible as assistant replies', () => {
    const providerError = toMessage({
      id: 'provider-error-1',
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: '429 rate limit exceeded',
    });
    expect(providerError).toMatchObject({
      id: 'provider-error-1',
      role: 'assistant',
      content: '429 rate limit exceeded',
      stopReason: 'error',
    });
    const repeatedErrors = toMessages([
      { id: 'user-1', role: 'user', content: 'First attempt' },
      {
        id: 'provider-error-1',
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: '429 rate limit exceeded',
      },
      { id: 'user-2', role: 'user', content: 'Second attempt' },
      {
        id: 'provider-error-2',
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Provider authentication failed',
      },
    ]);
    expect(repeatedErrors.map((message) => message.content)).toEqual([
      'First attempt',
      '429 rate limit exceeded',
      'Second attempt',
      'Provider authentication failed',
    ]);
  });

  it('preserves compactionSummary as an informative assistant message', () => {
    const compactionMsg = toMessage({
      id: 'cmp-1',
      role: 'compactionSummary',
      summary: 'Summary of earlier work',
      tokensBefore: 45000,
      timestamp: 123456789,
    });
    expect(compactionMsg).toBeDefined();
    expect(compactionMsg).toMatchObject({
      id: 'cmp-1',
      role: 'assistant',
      tags: ['compaction'],
    });
    expect(compactionMsg?.content).toContain('Context Compacted');
    expect(compactionMsg?.content).toContain('45000');
    expect(compactionMsg?.content).toContain('Summary of earlier work');
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

  it('renders redesigned borderless rectangular project switcher matching Settings button size', () => {
    const projects = [
      { id: 'proj-1', name: 'Metis Core', path: '/path/to/metis' },
      { id: 'proj-2', name: 'Desktop App', path: '/path/to/desktop' },
    ];
    const markup = renderToStaticMarkup(React.createElement(ProjectDots, {
      projects,
      activeProjectId: 'proj-1',
      onSelectProject: () => undefined,
      onAddProject: () => undefined,
    }));

    // Outer container: borderless rectangular switcher (kept as standalone component)
    expect(markup).toContain('data-project-switcher=""');
    expect(markup).toContain('w-full');
    expect(markup).toContain('h-8');
    expect(markup).toContain('rounded-control');
    expect(markup).toContain('bg-hover-2');
    expect(markup).not.toContain('border-');

    // Project tabs
    expect(markup).toContain('data-project-tab="proj-1"');
    expect(markup).toContain('data-project-tab="proj-2"');
    expect(markup).toContain('Metis Core');
    expect(markup).toContain('Desktop App');

    // Active project tab has white card background and shadow
    expect(markup).toContain('bg-surface text-ink shadow-btn font-medium');
    expect(markup).toContain('rounded-chip');

    // Plus button immediately following tabs
    expect(markup).toContain('data-add-project-button=""');
    expect(markup).toContain('aria-label="Add project"');
  });

  it('renders Codex-style project tree in Sidebar with Settings pinned to the footer', () => {
    const projects = [
      { id: 'proj-1', name: 'Metis Core', path: '/path/to/metis' },
      { id: 'proj-2', name: 'Desktop App', path: '/path/to/desktop' },
    ];
    const markup = renderToStaticMarkup(React.createElement(Sidebar, {
      agents: [sessionToAgent({
        ...session,
        cwd: '/path/to/metis',
        path: '/path/to/metis/session-1.jsonl',
      })],
      agentsByProject: {
        '/path/to/metis': [sessionToAgent({
          ...session,
          cwd: '/path/to/metis',
          path: '/path/to/metis/session-1.jsonl',
        })],
        '/path/to/desktop': [sessionToAgent({
          ...session,
          id: 'session-other',
          path: '/path/to/desktop/session.jsonl',
          cwd: '/path/to/desktop',
          title: 'Other project chat',
        })],
      },
      activeAgentId: session.id,
      projects,
      activeProjectId: 'proj-1',
      width: 248,
      onSelectAgent: () => undefined,
      onSelectProject: () => undefined,
      onAddProject: () => undefined,
      onNewChat: () => undefined,
      onOpenSettings: () => undefined,
    }));

    expect(markup).toContain('data-sidebar-actions=""');
    expect(markup).toContain('data-new-conversation-action=""');
    expect(markup).toContain('data-sidebar-projects=""');
    expect(markup).toContain('data-sidebar=""');
    const sidebarSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/Sidebar.tsx'), 'utf8');
    expect(sidebarSource).toContain('data-sidebar=""');
    expect(sidebarSource).not.toContain('bg-[#f7f7f7]');
    expect(sidebarSource).not.toContain('dark:bg-[#121316]');
    const cssSource = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    expect(cssSource).toContain('body {\n  background-color: var(--page);');
    const sidebarRule = cssSource.match(/\[data-sidebar\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(sidebarRule).toContain('background-color: var(--canvas);');
    expect(sidebarRule).not.toContain('border-right:');
    expect(sidebarRule).not.toContain('backdrop-filter:');
    expect(sidebarRule).not.toContain('-webkit-backdrop-filter:');
    expect(cssSource).not.toContain('--surface-sidebar');
    expect(cssSource).not.toContain('rgba(255, 255, 255, 0.55)');
    expect(cssSource).not.toContain('rgba(232, 235, 240');
    expect(cssSource).not.toContain('#e8ebf0');
    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(mainSource).toContain('backgroundsMatch: Boolean(sidebarStyle && mainChatStyle');
    expect(mainSource).toContain('sidebarDiffersFromMainChat');
    expect(mainSource).toContain('sidebarMatchesReferenceGray');
    expect(mainSource).toContain('mainChatMatchesInspector');
    expect(mainSource).toContain('dividersAreSinglePixelAndNotWhite');
    expect(mainSource).toContain('lightSurfaces');
    expect(mainSource).toContain('darkSurfaces');
    expect(markup).toContain('data-project-row="proj-1"');
    expect(markup).toContain('data-project-row="proj-2"');
    expect(markup).toContain('data-project-expanded="true"');
    expect(markup).toContain('data-project-expanded="false"');
    // Active project starts expanded; others stay collapsed until opened
    expect(markup.match(/data-project-expanded="true"/g)?.length).toBe(1);
    expect(markup).toContain('data-conversation-row="session-1"');
    expect(markup).not.toContain('data-conversation-icon');
    expect(markup).toContain('data-project-conversations="proj-1"');
    expect(markup).toContain('pl-[30px]');
    expect(markup).toContain('data-conversation-indicator');
    expect(markup).toContain('bg-hover-2');
    expect(markup).toContain('data-add-project-button=""');
    expect(markup).toContain('data-sidebar-footer=""');
    expect(markup).toContain('id="sidebarSettingsButton"');
    expect(markup.indexOf('data-sidebar-projects=""')).toBeLessThan(markup.indexOf('data-sidebar-footer=""'));
    expect(markup.indexOf('data-sidebar-footer=""')).toBeLessThan(markup.indexOf('id="sidebarSettingsButton"'));
  });

  it('allows multiple project folders to stay expanded independently', () => {
    const sidebarSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/Sidebar.tsx'), 'utf8');
    expect(sidebarSource).toContain('expandedProjectIds');
    expect(sidebarSource).toContain('handleProjectRowClick');
    expect(sidebarSource).toContain('data-project-expanded');
    expect(sidebarSource).toContain('next.add(projectId)');
    expect(sidebarSource).toContain('agentsByProject');
    expect(sidebarSource).toContain('onPrefetchProjectSessions');
    expect(sidebarSource).not.toContain('activeFolderCollapsed');

    const hookSource = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(hookSource).toContain('projectAgentsByPath');
    expect(hookSource).toContain('prefetchProjectSessions');
    expect(hookSource).toContain('rememberProjectAgents');

    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    expect(appSource).toContain('agentsByProject={captureConversationIcons ? undefined : projectAgentsByPath}');
    expect(appSource).toContain('onPrefetchProjectSessions={captureConversationIcons ? undefined : prefetchProjectSessions}');
  });

  it('renders a blue update button next to Settings when an update is available', () => {
    const sidebarSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/Sidebar.tsx'), 'utf8');
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    // Source wiring assertions
    expect(appSource).toContain('updateCheck={updateCheck}');
    expect(sidebarSource).toContain('RELEASES_URL');
    expect(sidebarSource).toContain('id="sidebarUpdateButton"');
    expect(sidebarSource).toContain('openExternal(RELEASES_URL)');
    expect(sidebarSource).toContain("window.open(RELEASES_URL, '_blank')");

    // When updateCheck is undefined or status is not 'available', update button should NOT render
    const noUpdateMarkup = renderToStaticMarkup(React.createElement(Sidebar, {
      agents: [sessionToAgent(session)],
      activeAgentId: session.id,
      width: 260,
      onSelectAgent: () => undefined,
      updateCheck: { status: 'current' },
    }));
    expect(noUpdateMarkup).toContain('id="sidebarSettingsButton"');
    expect(noUpdateMarkup).not.toContain('id="sidebarUpdateButton"');

    // When updateCheck.status === 'available', blue update button renders alongside Settings
    const updateAvailableMarkup = renderToStaticMarkup(React.createElement(Sidebar, {
      agents: [sessionToAgent(session)],
      activeAgentId: session.id,
      width: 260,
      onSelectAgent: () => undefined,
      updateCheck: {
        status: 'available',
        currentVersion: '1.1.15',
        latestVersion: '1.1.16',
      },
    }));

    expect(updateAvailableMarkup).toContain('id="sidebarSettingsButton"');
    expect(updateAvailableMarkup).toContain('id="sidebarUpdateButton"');
    expect(updateAvailableMarkup).toContain('bg-accent');
    expect(updateAvailableMarkup).toContain('text-white');
    expect(updateAvailableMarkup).toContain('h-8 px-2.5 rounded-control');
    expect(updateAvailableMarkup).toContain('Update');
    expect(updateAvailableMarkup).toContain('v1.1.16');
  });
});
