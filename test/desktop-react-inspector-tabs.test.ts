import { describe, expect, it } from 'vitest';
import {
  createInspectorTabsState,
  inspectorTabsReducer,
  isPinnedInspectorTab,
  resolveViewedProposalMarkdown,
  type InspectorTabsState,
} from '../desktop/src/lib/inspector-tabs';

function reduce(state: InspectorTabsState, actions: Parameters<typeof inspectorTabsReducer>[1][]) {
  return actions.reduce(inspectorTabsReducer, state);
}

describe('desktop inspector browser tabs', () => {
  it('starts with a pinned review tab', () => {
    const state = createInspectorTabsState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: 'files-1', kind: 'files' });
    expect(state.activeTabId).toBe('files-1');
    expect(isPinnedInspectorTab(state.tabs[0])).toBe(true);
  });

  it('opens unlimited duplicate plan tabs while keeping a single review tab', () => {
    let state = createInspectorTabsState();
    for (let index = 0; index < 100; index += 1) {
      state = inspectorTabsReducer(state, { type: 'open', kind: 'plan' });
    }
    expect(state.tabs).toHaveLength(101);
    expect(state.tabs.filter((tab) => tab.kind === 'files')).toHaveLength(1);
    expect(new Set(state.tabs.map((tab) => tab.id)).size).toBe(101);
    expect(state.activeTabId).toBe('plan-101');
    expect(state.nextId).toBe(102);
  });

  it('activates review instead of duplicating files tabs and refuses to close it', () => {
    let state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'files' },
      { type: 'open', kind: 'plan' },
      { type: 'open', kind: 'subagents' },
      { type: 'open', kind: 'files' },
    ]);
    expect(state.tabs.map((tab) => tab.id)).toEqual(['files-1', 'plan-2', 'subagents-3']);
    expect(state.activeTabId).toBe('files-1');

    state = inspectorTabsReducer(state, { type: 'activate', tabId: 'plan-2' });
    state = inspectorTabsReducer(state, { type: 'close', tabId: 'plan-2' });
    expect(state.tabs.map((tab) => tab.id)).toEqual(['files-1', 'subagents-3']);
    expect(state.activeTabId).toBe('subagents-3');

    state = inspectorTabsReducer(state, { type: 'close', tabId: 'subagents-3' });
    expect(state.activeTabId).toBe('files-1');
    state = inspectorTabsReducer(state, { type: 'close', tabId: 'files-1' });
    expect(state).toMatchObject({
      tabs: [{ id: 'files-1', kind: 'files' }],
      activeTabId: 'files-1',
    });
  });

  it('keeps the active tab when an inactive tab closes and reorders by final index', () => {
    const state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'plan' },
      { type: 'open', kind: 'subagents' },
      { type: 'activate', tabId: 'subagents-3' },
      { type: 'close', tabId: 'plan-2' },
      { type: 'move', tabId: 'subagents-3', toIndex: 0 },
    ]);
    expect(state.tabs.map((tab) => tab.id)).toEqual(['subagents-3', 'files-1']);
    expect(state.activeTabId).toBe('subagents-3');
  });

  it('isolates subagent selection and scroll position per tab', () => {
    const state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'subagents' },
      { type: 'open', kind: 'subagents' },
      { type: 'update', tabId: 'subagents-2', patch: { selectedSubagentId: 'agent-a', scrollTop: 240 } },
      { type: 'update', tabId: 'subagents-3', patch: { selectedSubagentId: 'agent-b', scrollTop: 80 } },
    ]);
    expect(state.tabs.find((tab) => tab.id === 'subagents-2')).toMatchObject({
      selectedSubagentId: 'agent-a',
      scrollTop: 240,
    });
    expect(state.tabs.find((tab) => tab.id === 'subagents-3')).toMatchObject({
      selectedSubagentId: 'agent-b',
      scrollTop: 80,
    });
  });

  it('openOrActivate focuses an existing plan tab and stores viewed proposal markdown', () => {
    let state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'plan' },
      { type: 'open', kind: 'files' },
    ]);
    expect(state.tabs.map((tab) => tab.id)).toEqual(['files-1', 'plan-2']);
    expect(state.activeTabId).toBe('files-1');

    state = inspectorTabsReducer(state, {
      type: 'openOrActivate',
      kind: 'plan',
      viewedProposalMarkdown: '# Existing plan',
      viewedProposalSessionId: 'session-a',
    });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe('plan-2');
    expect(state.tabs.find((tab) => tab.id === 'plan-2')).toMatchObject({
      viewedProposalMarkdown: '# Existing plan',
      viewedProposalSessionId: 'session-a',
      scrollTop: 0,
    });

    state = inspectorTabsReducer(createInspectorTabsState(), {
      type: 'openOrActivate',
      kind: 'plan',
      viewedProposalMarkdown: '# Fresh plan',
      viewedProposalSessionId: 'session-b',
    });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe('plan-2');
    expect(state.tabs.find((tab) => tab.id === 'plan-2')).toMatchObject({
      viewedProposalMarkdown: '# Fresh plan',
      viewedProposalSessionId: 'session-b',
    });
  });

  it('scopes viewed proposal markdown to the active conversation session', () => {
    expect(resolveViewedProposalMarkdown({
      viewedProposalMarkdown: '# Old conversation plan',
      viewedProposalSessionId: 'session-a',
    }, 'session-b')).toBeNull();
    expect(resolveViewedProposalMarkdown({
      viewedProposalMarkdown: '# Current conversation plan',
      viewedProposalSessionId: 'session-a',
    }, 'session-a')).toBe('# Current conversation plan');
    expect(resolveViewedProposalMarkdown({
      viewedProposalMarkdown: '# Orphan plan',
      viewedProposalSessionId: null,
    }, 'session-a')).toBeNull();
  });

  it('clears cached plan views when conversations switch', () => {
    let state = reduce(createInspectorTabsState(), [
      {
        type: 'openOrActivate',
        kind: 'plan',
        viewedProposalMarkdown: '# Sticky plan',
        viewedProposalSessionId: 'session-a',
      },
      { type: 'open', kind: 'files' },
    ]);
    state = inspectorTabsReducer(state, { type: 'clearPlanViews' });
    expect(state.tabs.find((tab) => tab.kind === 'plan')).toMatchObject({
      viewedProposalMarkdown: null,
      viewedProposalSessionId: null,
    });
    expect(state.tabs.find((tab) => tab.kind === 'files')?.viewedProposalMarkdown).toBeNull();
  });

  it('supports opening and updating multiple independent browser tabs', () => {
    let state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'browser', browserUrl: 'http://localhost:3000', browserTitle: 'Localhost' },
      { type: 'open', kind: 'browser', browserUrl: 'https://github.com', browserTitle: 'GitHub' },
    ]);
    expect(state.tabs).toHaveLength(3);
    const browserTabs = state.tabs.filter((tab) => tab.kind === 'browser');
    expect(browserTabs).toHaveLength(2);
    expect(browserTabs[0]).toMatchObject({
      id: 'browser-2',
      kind: 'browser',
      browserUrl: 'http://localhost:3000',
      browserTitle: 'Localhost',
    });
    expect(browserTabs[1]).toMatchObject({
      id: 'browser-3',
      kind: 'browser',
      browserUrl: 'https://github.com',
      browserTitle: 'GitHub',
    });
    expect(state.activeTabId).toBe('browser-3');

    // Update browser tab metadata
    state = inspectorTabsReducer(state, {
      type: 'update',
      tabId: 'browser-2',
      patch: {
        browserTitle: 'My Dev Server',
        browserCanGoBack: true,
        browserCanGoForward: false,
        browserIsLoading: false,
      },
    });
    const updatedTab = state.tabs.find((tab) => tab.id === 'browser-2');
    expect(updatedTab?.browserTitle).toBe('My Dev Server');
    expect(updatedTab?.browserCanGoBack).toBe(true);

    // Closing browser tab activates adjacent tab
    state = inspectorTabsReducer(state, { type: 'close', tabId: 'browser-3' });
    expect(state.tabs.map((tab) => tab.id)).toEqual(['files-1', 'browser-2']);
    expect(state.activeTabId).toBe('browser-2');
  });

  it('openOrActivate browser activates existing tab and can update its url', () => {
    let state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'browser', browserUrl: 'about:blank' },
      { type: 'open', kind: 'files' },
    ]);
    expect(state.activeTabId).toBe('files-1');

    state = inspectorTabsReducer(state, {
      type: 'openOrActivate',
      kind: 'browser',
      browserUrl: 'https://docs.metis.sh',
      browserTitle: 'Metis Docs',
    });
    expect(state.activeTabId).toBe('browser-2');
    const browserTab = state.tabs.find((t) => t.id === 'browser-2');
    expect(browserTab?.browserUrl).toBe('https://docs.metis.sh');
    expect(browserTab?.browserTitle).toBe('Metis Docs');
  });

  it('update returns the same state when browser metadata is unchanged', () => {
    let state = reduce(createInspectorTabsState(), [
      { type: 'open', kind: 'browser', browserUrl: 'https://example.com', browserTitle: 'Example' },
    ]);
    const before = state;
    state = inspectorTabsReducer(state, {
      type: 'update',
      tabId: 'browser-2',
      patch: {
        browserUrl: 'https://example.com',
        browserTitle: 'Example',
      },
    });
    expect(state).toBe(before);

    state = inspectorTabsReducer(state, {
      type: 'update',
      tabId: 'browser-2',
      patch: { browserTitle: 'Changed' },
    });
    expect(state).not.toBe(before);
    expect(state.tabs.find((tab) => tab.id === 'browser-2')?.browserTitle).toBe('Changed');
  });
});
