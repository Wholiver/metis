import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Bot, Check, Copy, GitBranch, Globe, ListTodo, Maximize2, Minimize2, PanelRightClose, Plus } from 'lucide-react';
import { WorkflowPlanState, WorkflowProposalState, AssistantContentPart } from '../../types';
import { SubagentItem } from '../../lib/subagents';
import { InspectorTab, InspectorTabKind, isPinnedInspectorTab } from '../../lib/inspector-tabs';
import { useI18n } from '../../i18n';
import { ReviewPanel } from './ReviewPanel';
import { InspectorPlanPanel } from './InspectorPlanPanel';
import { SubagentsList } from './SubagentsList';
import { InspectorBrowserPanel } from './InspectorBrowserPanel';

interface InspectorProps {
  tabs: InspectorTab[];
  activeTabId: string | null;
  workflowPlan?: WorkflowPlanState;
  workflowProposal?: WorkflowProposalState;
  planActionsEnabled?: boolean;
  onProcessProposal?: () => void;
  onRefineProposal?: (request: string) => void;
  toolParts?: AssistantContentPart[];
  workspacePath?: string;
  subagents?: SubagentItem[];
  width?: number;
  onOpenTab: (kind: InspectorTabKind) => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onMoveTab: (tabId: string, toIndex: number) => void;
  onUpdateTab: (tabId: string, patch: Partial<InspectorTab>) => void;
  onOpenSubagent?: (partId: string) => void;
  onClose?: () => void;
  onCollapse?: () => void;
  activeSessionId?: string | null;
  onToggleWideWidth?: () => void;
  isWideWidth?: boolean;
  browserModelControlled?: boolean;
}

type ShortcutToken = 'ctrl' | 'shift' | 'alt' | 'meta' | string;

const PANEL_OPTIONS: Array<{
  id: InspectorTabKind;
  icon: typeof GitBranch;
  labelKey: 'review' | 'plan' | 'subagents' | 'browser';
  shortcut: ShortcutToken[];
  matchKey: string;
  primaryMod: 'ctrl' | 'meta';
  requireShift?: boolean;
  requireAlt?: boolean;
}> = [
  { id: 'files', icon: GitBranch, labelKey: 'review', shortcut: ['ctrl', 'shift', 'G'], matchKey: 'g', primaryMod: 'ctrl', requireShift: true },
  { id: 'plan', icon: ListTodo, labelKey: 'plan', shortcut: ['meta', 'shift', 'P'], matchKey: 'p', primaryMod: 'meta', requireShift: true },
  { id: 'subagents', icon: Bot, labelKey: 'subagents', shortcut: ['alt', 'meta', 'S'], matchKey: String.fromCharCode(115), primaryMod: 'meta', requireAlt: true },
  { id: 'browser', icon: Globe, labelKey: 'browser', shortcut: ['meta', 'shift', 'B'], matchKey: 'b', primaryMod: 'meta', requireShift: true },
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export const Inspector = memo(forwardRef<HTMLElement, InspectorProps>(({
  tabs,
  activeTabId,
  workflowPlan,
  workflowProposal,
  planActionsEnabled = false,
  onProcessProposal,
  onRefineProposal,
  toolParts = [],
  workspacePath,
  subagents = [],
  width = 360,
  onOpenTab,
  onActivateTab,
  onCloseTab,
  onMoveTab,
  onUpdateTab,
  onOpenSubagent,
  onClose,
  onCollapse,
  activeSessionId,
  onToggleWideWidth,
  isWideWidth = false,
  browserModelControlled = false,
}: InspectorProps, ref) => {
  const { t } = useI18n();
  const [planCopied, setPlanCopied] = useState(false);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [faviconErrors, setFaviconErrors] = useState<Record<string, boolean>>({});
  const tabStripRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs.find((tab) => tab.kind === 'files') ?? null;

  const optionLabel = useCallback((kind: InspectorTabKind) => {
    const option = PANEL_OPTIONS.find((item) => item.id === kind);
    return option ? (t(option.labelKey) || option.labelKey) : kind;
  }, [t]);

  const tabLabel = useCallback((tab: InspectorTab) => {
    if (tab.kind === 'browser' && tab.browserTitle) {
      return tab.browserTitle;
    }
    return optionLabel(tab.kind);
  }, [optionLabel]);

  const saveActiveScroll = useCallback(() => {
    if (!activeTab || !contentScrollRef.current) return;
    const scrollTop = contentScrollRef.current.scrollTop;
    if (scrollTop !== activeTab.scrollTop) onUpdateTab(activeTab.id, { scrollTop });
  }, [activeTab, onUpdateTab]);

  const openPanel = useCallback((kind: InspectorTabKind) => {
    saveActiveScroll();
    onOpenTab(kind);
  }, [onOpenTab, saveActiveScroll]);

  const activateTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return;
    saveActiveScroll();
    onActivateTab(tabId);
  }, [activeTabId, onActivateTab, saveActiveScroll]);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (tab && isPinnedInspectorTab(tab)) return;
    if (tabId === activeTabId) saveActiveScroll();
    onCloseTab(tabId);
  }, [activeTabId, onCloseTab, saveActiveScroll, tabs]);

  useLayoutEffect(() => {
    if (!activeTab || !contentScrollRef.current) return;
    contentScrollRef.current.scrollTop = activeTab.scrollTop;
  }, [activeTab?.id]);

  useEffect(() => {
    if (!activeTabId) return;
    const activeElement = tabStripRef.current?.querySelector<HTMLElement>(`[data-inspector-tab-id="${activeTabId}"]`);
    activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.repeat) return;
      const key = event.key.toLowerCase();
      for (const option of PANEL_OPTIONS) {
        if (key !== option.matchKey) continue;
        if (Boolean(option.requireShift) !== event.shiftKey) continue;
        if (Boolean(option.requireAlt) !== event.altKey) continue;
        const primaryOk = option.primaryMod === 'ctrl'
          ? event.ctrlKey && !event.metaKey
          : event.metaKey || event.ctrlKey;
        if (!primaryOk) continue;
        event.preventDefault();
        openPanel(option.id);
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openPanel]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (event.key === 'Delete' || event.key === 'Backspace' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w')) {
      const tab = tabs.find((item) => item.id === tabId);
      if (tab && isPinnedInspectorTab(tab)) return;
      event.preventDefault();
      closeTab(tabId);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    activateTab(nextTab.id);
    requestAnimationFrame(() => {
      tabStripRef.current?.querySelector<HTMLElement>(`[data-inspector-tab-id="${nextTab.id}"]`)?.focus();
    });
  };

  const handleTabDragOver = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    if (!draggedTabId || draggedTabId === targetId) return;
    const sourceIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
    const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    let insertionIndex = targetIndex + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    onMoveTab(draggedTabId, insertionIndex);
  };

  const handleCopyPlan = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!workflowPlan?.plan?.length) return;
    const lines: string[] = [];
    if (workflowPlan.explanation?.trim()) lines.push(workflowPlan.explanation.trim(), '');
    for (const item of workflowPlan.plan) {
      const mark = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[-]' : '[ ]';
      lines.push(`- ${mark} ${item.step}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setPlanCopied(true);
      setTimeout(() => setPlanCopied(false), 2000);
    } catch {}
  };

  return (
    <aside ref={ref} style={{ width: `${width}px` }} className="h-full min-w-[360px] shrink bg-page flex flex-col overflow-hidden select-none relative" aria-label={t('workspaceContext') || 'Workspace context'} data-plan-inspector="">
      <div className="h-[50px] px-2 flex items-center justify-between flex-shrink-0 titlebar-drag gap-1.5 border-b border-line">
        <div className="flex min-w-0 flex-1 items-center gap-1 no-drag">
          <div
            ref={tabStripRef}
            role="tablist"
            aria-label={t('inspectorTabs') || 'Inspector tabs'}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain"
            data-inspector-tab-strip=""
            onWheel={(event) => {
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
              event.currentTarget.scrollLeft += event.deltaY;
            }}
          >
            {tabs.map((tab) => {
              const option = PANEL_OPTIONS.find((item) => item.id === tab.kind)!;
              const Icon = option.icon;
              const selected = tab.id === activeTab?.id;
              const label = tabLabel(tab);
              const pinned = isPinnedInspectorTab(tab);
              return (
                <div
                  key={tab.id}
                  id={`inspector-tab-${tab.id}`}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  aria-selected={selected}
                  aria-controls={`inspector-panel-${tab.id}`}
                  aria-label={label}
                  draggable={!pinned}
                  onClick={() => activateTab(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button !== 1 || pinned) return;
                    event.preventDefault();
                    closeTab(tab.id);
                  }}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                  onDragStart={(event) => {
                    if (pinned) {
                      event.preventDefault();
                      return;
                    }
                    setDraggedTabId(tab.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', tab.id);
                  }}
                  onDragOver={(event) => handleTabDragOver(event, tab.id)}
                  onDragEnd={() => setDraggedTabId(null)}
                  data-inspector-tab=""
                  data-inspector-tab-id={tab.id}
                  data-inspector-tab-kind={tab.kind}
                  data-inspector-tab-pinned={pinned ? 'true' : undefined}
                  className={`group flex h-8 min-w-[108px] max-w-[168px] shrink-0 cursor-default items-center gap-1.5 rounded-[9px] ${pinned ? 'pl-2.5 pr-2.5' : 'pl-2.5 pr-1'} text-[12.5px] outline-none transition-[background-color,color,opacity] focus-visible:ring-2 focus-visible:ring-[color:var(--focus)] ${selected ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink'} ${draggedTabId === tab.id ? 'opacity-55' : 'opacity-100'}`}
                >
                  {tab.kind === 'browser' && tab.browserFavicon && !faviconErrors[tab.id] ? (
                    <img
                      src={tab.browserFavicon}
                      alt=""
                      onError={() => setFaviconErrors((prev) => ({ ...prev, [tab.id]: true }))}
                      className="h-3.5 w-3.5 shrink-0 rounded-[2px]"
                    />
                  ) : (
                    <Icon className="h-3.5 w-3.5 shrink-0 stroke-[1.7]" aria-hidden="true" />
                  )}
                  <span
                    className="min-w-0 flex-1 truncate capitalize"
                    title={label}
                    data-plan-points-title={tab.kind === 'plan' ? '' : undefined}
                    data-subagents-title={tab.kind === 'subagents' ? '' : undefined}
                    data-review-title={tab.kind === 'files' ? '' : undefined}
                    data-browser-title={tab.kind === 'browser' ? '' : undefined}
                  >
                    {label}
                  </span>
                  {!pinned && (
                    <button type="button" tabIndex={-1} aria-label={`${t('closeInspectorTab') || 'Close tab'}: ${label}`} title={t('closeInspectorTab') || 'Close tab'} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink-2 dark:text-ink-3 dark:hover:bg-hover-2 dark:hover:text-ink transition-[background-color,color,opacity] ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`} data-inspector-tab-close="">
                      <span className="text-[14px] leading-none" aria-hidden="true">×</span>
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => onOpenTab('browser')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] transition-all duration-150"
              title={t('newBrowserTab') || 'New browser tab'}
              aria-label={t('newBrowserTab') || 'New browser tab'}
              data-new-browser-tab=""
            >
              <Plus className="h-3.5 w-3.5 stroke-[2]" />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 no-drag">
          {activeTab?.kind === 'plan' && workflowPlan?.plan?.length ? (
            <button type="button" onClick={handleCopyPlan} className="flex h-8 items-center gap-1 rounded-[9px] px-2 text-[12px] font-medium text-ink-3 hover:bg-hover hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]" title={planCopied ? (t('planCopied') || 'Copied') : (t('copyPlan') || 'Copy Plan')} aria-label={t('copyPlan') || 'Copy Plan'} data-copy-plan-button="">
              {planCopied ? <Check size={13} className="text-green stroke-[2.2]" /> : <Copy size={13} strokeWidth={1.8} />}
              <span className={planCopied ? 'text-green' : ''}>{planCopied ? (t('planCopied') || 'Copied') : (t('copy') || 'Copy')}</span>
            </button>
          ) : null}
          {activeTab?.kind === 'browser' && onToggleWideWidth ? (
            <button
              type="button"
              onClick={onToggleWideWidth}
              className="relative flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
              title={isWideWidth ? (t('restoreInspectorWidth') || 'Restore inspector width') : (t('expandInspectorWidth') || 'Expand browser view')}
              aria-label={isWideWidth ? (t('restoreInspectorWidth') || 'Restore inspector width') : (t('expandInspectorWidth') || 'Expand browser view')}
              data-toggle-wide-button=""
            >
              {isWideWidth ? <Minimize2 className="w-3.5 h-3.5 stroke-[1.8]" /> : <Maximize2 className="w-3.5 h-3.5 stroke-[1.8]" />}
            </button>
          ) : null}
          <button type="button" onClick={() => { saveActiveScroll(); (onCollapse || onClose)?.(); }} className="relative flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-3 dark:text-ink-3 hover:bg-hover hover:text-ink active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]" title={t('collapseInspector') || 'Collapse Inspector'} aria-label={t('collapseWorkspaceContext') || 'Collapse workspace context'} data-inspector-collapse-button="">
            <PanelRightClose className="w-4 h-4 stroke-[1.8]" aria-hidden="true" />
          </button>
        </div>
      </div>

      {tabs.map((tab) => {
        const selected = tab.id === activeTab?.id;
        if (tab.kind === 'plan') {
          return (
            <div
              key={tab.id}
              id={`inspector-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`inspector-tab-${tab.id}`}
              hidden={!selected}
              className="flex min-h-0 flex-1 flex-col overflow-hidden px-3.5 pb-3.5 pt-2 no-drag"
              data-inspector-panel="plan"
              data-plan-section=""
            >
              <InspectorPlanPanel
                viewedProposalMarkdown={tab.viewedProposalMarkdown}
                viewedProposalSessionId={tab.viewedProposalSessionId}
                activeSessionId={activeSessionId}
                workflowProposal={workflowProposal}
                workflowPlan={workflowPlan}
                planActionsEnabled={planActionsEnabled}
                onProcessProposal={onProcessProposal}
                onRefineProposal={onRefineProposal}
                contentScrollRef={selected ? contentScrollRef : undefined}
              />
            </div>
          );
        }
        if (tab.kind === 'subagents') {
          return (
            <div
              key={tab.id}
              ref={selected ? contentScrollRef : undefined}
              id={`inspector-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`inspector-tab-${tab.id}`}
              hidden={!selected}
              className="flex-1 overflow-y-auto px-3.5 pb-3.5 pt-2 no-drag"
              data-inspector-panel="subagents"
              data-subagents-section=""
            >
              <SubagentsList
                subagents={subagents}
                onSelect={(item) => onOpenSubagent?.(item.id)}
              />
            </div>
          );
        }
        if (tab.kind === 'browser') {
          return (
            <div
              key={tab.id}
              id={`inspector-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`inspector-tab-${tab.id}`}
              hidden={!selected}
              className="flex min-h-0 flex-1 flex-col overflow-hidden no-drag"
              data-inspector-panel="browser"
            >
              <InspectorBrowserPanel
                tab={tab}
                modelControlled={browserModelControlled}
                onUpdateTab={onUpdateTab}
              />
            </div>
          );
        }
        return (
          <div
            key={tab.id}
            id={`inspector-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`inspector-tab-${tab.id}`}
            hidden={!selected}
            className="flex min-h-0 flex-1 flex-col overflow-hidden no-drag"
            data-inspector-panel="files"
            data-changed-files-section=""
            data-review-section=""
          >
            <ReviewPanel
              sessionId={activeSessionId}
              workspacePath={workspacePath}
              toolParts={toolParts}
              enabled
            />
          </div>
        );
      })}
    </aside>
  );
}));

Inspector.displayName = 'Inspector';
