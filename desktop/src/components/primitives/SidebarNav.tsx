/**
 * Source: https://www.beautifului.dev/r/sidebar-nav.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Icons: Lucide (ISC) — Central Icons removed for commercial licensing.
 * Metis: controlled shell — no demo workspace/recents data.
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  LogOut,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SquarePen,
  UserPlus,
  X,
} from "lucide-react";
import GlideMenu from "@/components/primitives/GlideMenu";

/* ─────────────────────────────────────────────────────────
 * SIDEBAR NAV
 * Compact workspace switcher, primary navigation, searchable
 * chat history, and a collapse that preserves icon alignment.
 * ───────────────────────────────────────────────────────── */

export type SidebarRecent = {
  id: string;
  label: string;
  prompt?: string;
};

export type SidebarNavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  count?: string;
};

export type SidebarNavLabels = {
  workspaceAria: string;
  newChat: string;
  chats: string;
  searchChats: string;
  searchChatHistory: string;
  closeChatSearch: string;
  noChatsFound: string;
  collapseSidebar: string;
  expandSidebar: string;
  newWorkspace: string;
  workspaceSettings: string;
  inviteTeam: string;
  signOut: string;
};

const DEFAULT_LABELS: SidebarNavLabels = {
  workspaceAria: "",
  newChat: "",
  chats: "",
  searchChats: "",
  searchChatHistory: "",
  closeChatSearch: "",
  noChatsFound: "",
  collapseSidebar: "",
  expandSidebar: "",
  newWorkspace: "",
  workspaceSettings: "",
  inviteTeam: "",
  signOut: "",
};

type SidebarNavProps = {
  activeTitle?: string | null;
  className?: string;
  fill?: boolean;
  onNewChat?: () => void;
  onPick?: (id: string, label: string, prompt?: string) => void;
  activeNav?: string;
  onNavigate?: (key: string) => void;
  footerLabel?: string;
  footerIcon?: ReactNode;
  onFooterClick?: () => void;
  recents?: SidebarRecent[];
  navItems?: SidebarNavItem[];
  workspaceName?: string;
  workspaceMonogram?: string;
  labels?: Partial<SidebarNavLabels>;
  variant?: string;
};

const SIDEBAR_MOTION = {
  expandedWidth: 224,
  collapsedWidth: 52,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

const CHAT_SEARCH_MOTION = {
  duration: 180,
  closedWidth: 28,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

function GlideGroup({ children }: { children: ReactNode }) {
  return (
    <GlideMenu
      rowSelector="[data-row]"
      highlightClassName="sidebar-glide-highlight rounded-[7px] bg-hover-2"
      className="group/glide flex flex-col gap-px"
    >
      {children}
    </GlideMenu>
  );
}

function RailButton({
  icon,
  label,
  active = false,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  count?: string;
  onClick?: () => void;
}) {
  return (
    <button
      data-row
      type="button"
      title={label}
      onClick={onClick}
      className={`sidebar-row relative z-10 mx-2 flex h-9 items-center gap-2 rounded-[8px] px-2 text-left transition-[background-color,color,transform] duration-150 active:scale-[0.98] ${
        active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
      }`}
    >
      <span className={`flex size-5 shrink-0 items-center justify-center ${active ? "text-ink" : "text-ink-2"}`}>
        {icon}
      </span>
      <span className={`sidebar-copy min-w-0 flex-1 truncate text-[13.5px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>
        {label}
      </span>
      {count ? (
        <span className="sidebar-copy shrink-0 text-[11px] font-medium tabular-nums text-ink-3">{count}</span>
      ) : null}
    </button>
  );
}

function WorkspaceMenu({
  position,
  monogram,
  name,
  labels,
  onClose,
}: {
  position: { top: number; left: number };
  monogram: string;
  name: string;
  labels: SidebarNavLabels;
  onClose: () => void;
}) {
  return createPortal(
    <div
      data-workspace-menu
      className="fixed z-[80] w-[220px] overflow-hidden rounded-[12px] bg-surface p-1 shadow-raised"
      style={{ top: position.top, left: position.left }}
    >
      <GlideMenu className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
        <button
          data-menu-row
          type="button"
          onClick={onClose}
          className="relative z-10 flex h-10 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-ink text-[11px] font-semibold text-surface">
            {monogram}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{name}</span>
          <span className="shrink-0 text-ink"><Check size={18} strokeWidth={2} /></span>
        </button>
        <div className="my-1 h-px bg-line" />
        {[
          { label: labels.newWorkspace, icon: <Plus size={16} strokeWidth={1.8} /> },
          { label: labels.workspaceSettings, icon: <Settings size={16} strokeWidth={1.8} /> },
          { label: labels.inviteTeam, icon: <UserPlus size={16} strokeWidth={1.8} /> },
        ].filter((item) => item.label).map((item) => (
          <button
            key={item.label}
            data-menu-row
            type="button"
            onClick={onClose}
            className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{item.label}</span>
          </button>
        ))}
        {labels.signOut ? (
          <>
            <div className="my-1 h-px bg-line" />
            <button
              data-menu-row
              type="button"
              onClick={onClose}
              className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-2"><LogOut size={16} strokeWidth={1.8} /></span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{labels.signOut}</span>
            </button>
          </>
        ) : null}
      </GlideMenu>
    </div>,
    document.body,
  );
}

export default function SidebarNav({
  activeTitle,
  className = "",
  fill = false,
  onNewChat,
  onPick,
  activeNav,
  onNavigate,
  footerLabel = "",
  footerIcon,
  onFooterClick,
  recents = [],
  navItems = [],
  workspaceName = "",
  workspaceMonogram = "",
  labels,
}: SidebarNavProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const [collapsed, setCollapsed] = useState(false);
  const [internalNav, setInternalNav] = useState("chats");
  const currentNav = activeNav ?? internalNav;
  const selectNav = (key: string) => {
    setInternalNav(key);
    onNavigate?.(key);
  };
  const [demoActiveTitle, setDemoActiveTitle] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({ top: 0, left: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedTitle = activeTitle === undefined ? demoActiveTitle : activeTitle;
  const visibleRecents = recents.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!workspaceOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest("[data-workspace-trigger]") && !target.closest("[data-workspace-menu]")) {
        setWorkspaceOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [workspaceOpen]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const collapse = () => {
    setCollapsed(true);
    setWorkspaceOpen(false);
    setSearchOpen(false);
    setQuery("");
  };

  return (
    <aside
      data-sidebar-collapsed={collapsed}
      aria-label={text.workspaceAria}
      className={`relative flex shrink-0 overflow-hidden transition-[width] ${fill ? "h-full" : "h-[600px]"} ${className}`}
      style={{
        width: collapsed ? SIDEBAR_MOTION.collapsedWidth : SIDEBAR_MOTION.expandedWidth,
        transitionDuration: `${SIDEBAR_MOTION.duration}ms`,
        transitionTimingFunction: SIDEBAR_MOTION.easing,
        "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
        "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
        "--sidebar-easing": SIDEBAR_MOTION.easing,
      } as CSSProperties}
    >
      <div className="flex min-h-0 w-[224px] shrink-0 flex-col">
        <div className="relative mb-2.5 h-10 shrink-0">
          <button
            ref={workspaceButtonRef}
            data-workspace-trigger
            type="button"
            aria-expanded={workspaceOpen}
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={() => {
              if (!workspaceOpen && workspaceButtonRef.current) {
                const rect = workspaceButtonRef.current.getBoundingClientRect();
                setWorkspacePosition({ top: rect.bottom + 6, left: rect.left });
              }
              setWorkspaceOpen((open) => !open);
            }}
            className="sidebar-workspace-control absolute left-2 top-1 flex h-8 w-[164px] items-center rounded-[8px] px-2 text-left transition-[background-color,transform] duration-100 hover:bg-hover-2 active:scale-[0.99]"
          >
            <span className="sidebar-logo flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-ink text-[10px] font-semibold text-surface">
              {workspaceMonogram}
            </span>
            <span className="sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">
              {workspaceName}
            </span>
            <span className="sidebar-copy ml-1 flex shrink-0 text-ink-3">
              <ChevronDown size={16} strokeWidth={1.8} />
            </span>
          </button>

          {workspaceOpen && (
            <WorkspaceMenu
              position={workspacePosition}
              monogram={workspaceMonogram}
              name={workspaceName}
              labels={text}
              onClose={() => setWorkspaceOpen(false)}
            />
          )}

          <button
            type="button"
            aria-label={text.collapseSidebar}
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={collapse}
            className="sidebar-collapse-control absolute right-2 top-1 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeft size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label={text.expandSidebar}
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={() => setCollapsed(false)}
            className="sidebar-expand-control absolute left-2 top-0.5 flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeft size={18} strokeWidth={1.8} className="rotate-180" />
          </button>
        </div>

        <GlideGroup>
          <RailButton
            icon={<SquarePen size={18} strokeWidth={1.8} />}
            label={text.newChat}
            onClick={() => {
              if (activeTitle === undefined) setDemoActiveTitle(null);
              selectNav("chats");
              onNewChat?.();
            }}
          />
          {navItems.map((item) => (
            <RailButton
              key={item.key}
              icon={item.icon}
              label={item.label}
              count={item.count}
              active={currentNav === item.key}
              onClick={() => selectNav(item.key)}
            />
          ))}
        </GlideGroup>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="sidebar-copy relative mx-2 mb-1 h-8">
            <div
              aria-hidden={searchOpen}
              className={`absolute inset-0 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-ink-3 transition-[opacity,transform] ${searchOpen ? "pointer-events-none -translate-x-1 opacity-0" : "translate-x-0 opacity-100"}`}
              style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`, transitionTimingFunction: CHAT_SEARCH_MOTION.easing }}
            >
              <ChevronDown size={16} strokeWidth={1.8} />
              <span>{text.chats}</span>
            </div>

            <button
              type="button"
              aria-label={text.searchChats}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen(true)}
              className={`absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color,transform] hover:bg-hover-2 hover:text-ink active:scale-[0.96] ${searchOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}
              style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms` }}
            >
              <Search size={16} strokeWidth={1.8} />
            </button>

            <div
              className={`absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2 ${searchOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
              style={{
                width: searchOpen ? "100%" : CHAT_SEARCH_MOTION.closedWidth,
                transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
              }}
            >
              <span className="ml-2 flex shrink-0 items-center justify-center">
                <Search size={15} strokeWidth={1.8} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    setQuery("");
                  }
                }}
                placeholder={text.searchChats}
                aria-label={text.searchChatHistory}
                className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                aria-label={text.closeChatSearch}
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <GlideGroup>
            {visibleRecents.map((item) => {
              const active = item.label === selectedTitle;
              return (
                <button
                  key={item.id}
                  data-row
                  type="button"
                  title={item.label}
                  onClick={() => {
                    selectNav("chats");
                    if (activeTitle === undefined) setDemoActiveTitle(item.label);
                    onPick?.(item.id, item.label, item.prompt);
                  }}
                  className={`sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-[8px] px-2 text-left transition-[width,background-color,color,transform] duration-150 active:scale-[0.98] ${
                    active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
                  }`}
                >
                  <span className={`sidebar-copy min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
            {query && visibleRecents.length === 0 && (
              <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">{text.noChatsFound}</div>
            )}
          </GlideGroup>
        </div>

        {(footerLabel || footerIcon) && (
          <div className="sidebar-copy mx-2 mt-3 w-[208px] border-t border-line pt-3">
            <button
              type="button"
              onClick={onFooterClick ?? onNewChat}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-hover-2 text-[12.5px] font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-line-strong active:scale-[0.98]"
            >
              {footerIcon}
              {footerLabel}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
