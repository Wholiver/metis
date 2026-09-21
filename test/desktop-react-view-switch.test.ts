import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rememberSessionMessages, pickPreferredProjectSession, isTransientSessionId, PROJECT_SWITCH_PENDING_ID, NEW_CONVERSATION_PENDING_PREFIX } from '../desktop/src/hooks/useMetisServer';
import type { Agent, Message } from '../desktop/src/types';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('desktop view-switch jank', () => {
  it('never writes transcript cache under an empty session id', () => {
    const cache = new Map<string, Message[]>();
    const kept: Message[] = [{ id: 'a1', role: 'user', content: 'hello' }];
    cache.set('session-a', kept);
    rememberSessionMessages(cache, undefined, []);
    rememberSessionMessages(cache, '', [{ id: 'b1', role: 'user', content: 'other' }]);
    rememberSessionMessages(cache, PROJECT_SWITCH_PENDING_ID, [{ id: 'c1', role: 'user', content: 'pending' }]);
    rememberSessionMessages(cache, `${NEW_CONVERSATION_PENDING_PREFIX}1`, [{ id: 'd1', role: 'user', content: 'new' }]);
    expect(cache.get('session-a')).toBe(kept);
    expect(cache.size).toBe(1);

    const next: Message[] = [{ id: 'b1', role: 'user', content: 'other' }];
    rememberSessionMessages(cache, 'session-b', next);
    expect(cache.get('session-a')).toBe(kept);
    expect(cache.get('session-b')).toBe(next);
  });

  it('keys the live transcript cache by messagesSessionId, not the in-flight switch target', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain('rememberSessionMessages(messagesCacheRef.current, messagesSessionId, messages)');
    expect(hook).not.toContain('activeSessionIdRef.current || messagesSessionId');
    expect(hook).toContain('if (isLoadingMessages) return;');
    expect(hook).toContain('const sameSession = Boolean(state.sessionId) && messagesSessionIdRef.current === state.sessionId');
    expect(hook).toContain('messageLoadVersionRef.current += 1');
    expect(hook).toContain('hadCachedView');
    expect(hook).toContain('if (!hadCachedView) await snapshot');
    expect(hook).toContain('pendingSwitchAgentIdRef.current');
  });

  it('swaps MessageList data without remounting the transcript tree', () => {
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const messageList = source('desktop/src/components/chat/MessageList.tsx');
    expect(chatArea).toContain('sessionId={agent.id}');
    expect(chatArea).not.toContain('key={agent.id}');
    expect(messageList).toContain('sessionId?: string');
    expect(messageList).toContain('if (sessionId !== previousSessionIdRef.current)');
  });

  it('keeps inspector panels and sidebar/inspector shells mounted across switches', () => {
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    const app = source('desktop/src/App.tsx');
    expect(inspector).toContain('hidden={!selected}');
    expect(inspector).toContain('tabs.map((tab) => {');
    expect(app).toContain('data-sidebar-shell');
    expect(app).toContain('data-inspector-shell');
    expect(app).toContain("className={isSidebarOpen ? 'contents' : 'hidden'}");
    expect(app).toContain("className={isInspectorOpen ? 'contents' : 'hidden'}");
    expect(app).toContain('const switching = selectConversation(agentId)');
  });

  it('debounces i18n translation and skips characterData to avoid remount flicker', () => {
    const i18n = source('desktop/src/i18n.tsx');
    expect(i18n).toContain('window.requestAnimationFrame');
    expect(i18n).toContain('observer.disconnect()');
    expect(i18n).not.toContain('characterData: true');
  });

  it('does not flash settings loading on reopen once data is cached', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    expect(settings).toContain('hasLoadedRef');
    expect(settings).toContain('if (!hasLoadedRef.current) setLoading(true)');
  });

  it('paints an optimistic empty new chat without waiting on loadProject or refreshModels', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    const newConversation = hook.slice(
      hook.indexOf('const newConversation'),
      hook.indexOf('const selectProject'),
    );
    expect(newConversation).toContain("beginPendingSessionView(optimisticId, 'empty')");
    expect(newConversation).toContain('NEW_CONVERSATION_PENDING_PREFIX');
    expect(newConversation).toContain("await request<SessionState>('/session/new'");
    expect(newConversation).toContain('void loadProject(project, false)');
    expect(newConversation).not.toContain('await loadProject');
    expect(newConversation).not.toContain('refreshModels');
    expect(newConversation).not.toContain('setIsLoadingSessions(true)');
    expect(newConversation).toContain('enqueueSessionMutation');
    expect(newConversation).toContain('switchVersionRef.current');
    expect(hook).toContain('beginPendingSessionView');
    expect(hook).toContain("pendingSwitchAgentIdRef.current?.startsWith(NEW_CONVERSATION_PENDING_PREFIX)");
  });

  it('cancels in-flight snapshot applies when switching projects and does not double-load on connect', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    const app = source('desktop/src/App.tsx');
    const selectProject = hook.slice(
      hook.indexOf('const selectProject'),
      hook.indexOf('const activeProjectPath'),
    );
    const connectServer = hook.slice(
      hook.indexOf('const connectServer'),
      hook.indexOf('useEffect(() => {\n    const desktop'),
    );
    expect(selectProject).toContain('beginPendingSessionView');
    expect(selectProject).toContain('pickPreferredProjectSession');
    expect(selectProject).toContain('switchVersionRef.current');
    expect(selectProject).toContain('await loadProject(project, true, preferred.id)');
    expect(selectProject).toContain('beginPendingSessionView(PROJECT_SWITCH_PENDING_ID, \'loading\')');
    expect(selectProject).toContain('lastActivatedProjectPathRef.current = project.path');
    expect(hook).toContain("lastActivatedProjectPathRef.current = ''");
    expect(hook).toContain('if (pendingSwitchAgentIdRef.current) return');
    expect(hook).toContain('if (lastActivatedProjectPathRef.current === activeProjectPath) return');
    expect(hook).toContain('void selectProject(project)');
    expect(connectServer).toContain('if (options)');
    expect(connectServer).toContain('if (project) await loadProject(project, true)');
    expect(connectServer).toContain('else if (!project)');
    expect(connectServer).toContain('await loadMessages(activeSessionIdRef.current || undefined)');
    expect(app).toContain('void selectProject(targetProj)');
    expect(app).toContain('void desktop.workspace.set(targetProj.path)');
    expect(app).toContain('const switching = selectConversation(agentId)');
  });

  it('picks the last viewed session for a project and treats optimistic ids as transient', () => {
    const agents = [
      { id: 'session-old', name: 'Older' },
      { id: 'session-new', name: 'Newer' },
    ] as Agent[];
    expect(pickPreferredProjectSession(agents, 'session-old')?.id).toBe('session-old');
    expect(pickPreferredProjectSession(agents)?.id).toBe('session-old');
    expect(pickPreferredProjectSession([], 'missing')).toBeUndefined();
    expect(isTransientSessionId('')).toBe(true);
    expect(isTransientSessionId(PROJECT_SWITCH_PENDING_ID)).toBe(true);
    expect(isTransientSessionId(`${NEW_CONVERSATION_PENDING_PREFIX}99`)).toBe(true);
    expect(isTransientSessionId('session-a')).toBe(false);
  });
});
