export type InspectorTabKind = 'files' | 'plan' | 'subagents';

export interface InspectorTab {
  id: string;
  kind: InspectorTabKind;
  selectedSubagentId: string | null;
  scrollTop: number;
  viewedProposalMarkdown: string | null;
  viewedProposalSessionId: string | null;
}

export interface InspectorTabsState {
  tabs: InspectorTab[];
  activeTabId: string | null;
  nextId: number;
}

export type InspectorTabsAction =
  | {
    type: 'open';
    kind: InspectorTabKind;
    viewedProposalMarkdown?: string | null;
    viewedProposalSessionId?: string | null;
  }
  | {
    type: 'openOrActivate';
    kind: InspectorTabKind;
    viewedProposalMarkdown?: string | null;
    viewedProposalSessionId?: string | null;
  }
  | { type: 'activate'; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'move'; tabId: string; toIndex: number }
  | { type: 'clearPlanViews' }
  | {
    type: 'update';
    tabId: string;
    patch: Partial<Pick<InspectorTab, 'selectedSubagentId' | 'scrollTop' | 'viewedProposalMarkdown' | 'viewedProposalSessionId'>>;
  };

function createTab(
  kind: InspectorTabKind,
  id: string,
  viewedProposalMarkdown: string | null = null,
  viewedProposalSessionId: string | null = null,
): InspectorTab {
  return {
    id,
    kind,
    selectedSubagentId: null,
    scrollTop: 0,
    viewedProposalMarkdown,
    viewedProposalSessionId,
  };
}

export function createInspectorTabsState(): InspectorTabsState {
  const review = createTab('files', 'files-1');
  return { tabs: [review], activeTabId: review.id, nextId: 2 };
}

export function isPinnedInspectorTab(tab: Pick<InspectorTab, 'kind'>): boolean {
  return tab.kind === 'files';
}

export function resolveViewedProposalMarkdown(
  tab: Pick<InspectorTab, 'viewedProposalMarkdown' | 'viewedProposalSessionId'>,
  activeSessionId?: string | null,
): string | null {
  if (!tab.viewedProposalMarkdown) return null;
  if (!tab.viewedProposalSessionId) return null;
  if (!activeSessionId || tab.viewedProposalSessionId !== activeSessionId) return null;
  return tab.viewedProposalMarkdown;
}

export function inspectorTabsReducer(
  state: InspectorTabsState,
  action: InspectorTabsAction,
): InspectorTabsState {
  if (action.type === 'open') {
    if (action.kind === 'files') {
      const existing = state.tabs.find((tab) => tab.kind === 'files');
      if (existing) return { ...state, activeTabId: existing.id };
    }
    const id = `${action.kind}-${state.nextId}`;
    return {
      tabs: [...state.tabs, createTab(
        action.kind,
        id,
        action.viewedProposalMarkdown ?? null,
        action.viewedProposalSessionId ?? null,
      )],
      activeTabId: id,
      nextId: state.nextId + 1,
    };
  }

  if (action.type === 'openOrActivate') {
    const existing = state.tabs.find((tab) => tab.kind === action.kind);
    if (existing) {
      const index = state.tabs.findIndex((tab) => tab.id === existing.id);
      const tabs = [...state.tabs];
      tabs[index] = {
        ...existing,
        viewedProposalMarkdown: action.viewedProposalMarkdown !== undefined
          ? action.viewedProposalMarkdown
          : existing.viewedProposalMarkdown,
        viewedProposalSessionId: action.viewedProposalSessionId !== undefined
          ? action.viewedProposalSessionId
          : existing.viewedProposalSessionId,
        scrollTop: 0,
      };
      return { ...state, tabs, activeTabId: existing.id };
    }
    const id = `${action.kind}-${state.nextId}`;
    return {
      tabs: [...state.tabs, createTab(
        action.kind,
        id,
        action.viewedProposalMarkdown ?? null,
        action.viewedProposalSessionId ?? null,
      )],
      activeTabId: id,
      nextId: state.nextId + 1,
    };
  }

  if (action.type === 'clearPlanViews') {
    let changed = false;
    const tabs = state.tabs.map((tab) => {
      if (tab.kind !== 'plan' || (tab.viewedProposalMarkdown == null && tab.viewedProposalSessionId == null)) {
        return tab;
      }
      changed = true;
      return { ...tab, viewedProposalMarkdown: null, viewedProposalSessionId: null };
    });
    return changed ? { ...state, tabs } : state;
  }

  if (action.type === 'activate') {
    if (state.activeTabId === action.tabId || !state.tabs.some((tab) => tab.id === action.tabId)) return state;
    return { ...state, activeTabId: action.tabId };
  }

  if (action.type === 'close') {
    const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
    if (index < 0) return state;
    const closing = state.tabs[index];
    if (isPinnedInspectorTab(closing)) return state;
    const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
    if (state.activeTabId !== action.tabId) return { ...state, tabs };
    return {
      ...state,
      tabs,
      activeTabId: tabs[Math.min(index, tabs.length - 1)]?.id ?? null,
    };
  }

  if (action.type === 'move') {
    const fromIndex = state.tabs.findIndex((tab) => tab.id === action.tabId);
    if (fromIndex < 0) return state;
    const toIndex = Math.max(0, Math.min(action.toIndex, state.tabs.length - 1));
    if (fromIndex === toIndex) return state;
    const tabs = [...state.tabs];
    const [tab] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, tab);
    return { ...state, tabs };
  }

  if (action.type === 'update') {
    const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
    if (index < 0) return state;
    const current = state.tabs[index];
    const patch = {
      ...action.patch,
      ...(action.patch.scrollTop === undefined
        ? {}
        : { scrollTop: Math.max(0, Number.isFinite(action.patch.scrollTop) ? action.patch.scrollTop : 0) }),
    };
    const tabs = [...state.tabs];
    tabs[index] = { ...current, ...patch };
    return { ...state, tabs };
  }

  return state;
}
