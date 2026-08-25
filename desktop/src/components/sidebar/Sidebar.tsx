import React, { useState } from 'react';
import { Search, Plus, Settings, PanelLeftClose } from 'lucide-react';
import { Agent, ProjectItem } from '../../types';
import { AgentItem } from './AgentItem';
import { ProjectDots } from './ProjectDots';

interface SidebarProps {
  agents: Agent[];
  activeAgentId: string;
  projects?: ProjectItem[];
  activeProjectId?: string;
  width: number;
  isLoading?: boolean;
  error?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onAddProject?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  agents,
  activeAgentId,
  projects = [],
  activeProjectId = '',
  width,
  isLoading = false,
  error = '',
  onSelectAgent,
  onSelectProject,
  onAddProject,
  onNewChat,
  onOpenSettings,
  onToggleSidebar,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.subtitle.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside
      style={{ width: `${width}px` }}
      className="h-full min-w-[240px] shrink bg-[#f6f7f9] border-r border-slate-200/80 flex flex-col overflow-hidden select-none relative"
    >
      {/* 50px Top Header: Native traffic lights spacer + Collapse button on left, New chat (+) on right */}
      <div className="h-[50px] px-3.5 flex items-center justify-between flex-shrink-0 titlebar-drag">
        {/* Left container: Traffic lights spacer + Toggle sidebar button */}
        <div className="flex items-center gap-1.5 no-drag">
          <div className="w-[66px] h-[16px]" />
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#8e95a2] hover:bg-black/5 hover:text-[#1e293b] transition-colors"
            title="Toggle Sidebar"
          >
            <PanelLeftClose className="w-4 h-4 stroke-[1.8]" />
          </button>
        </div>

        {/* Right action: New chat (+) */}
        <button
          onClick={onNewChat}
          className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#8e95a2] hover:bg-black/5 hover:text-[#1e293b] transition-colors no-drag"
          title="New Chat"
        >
          <Plus className="w-4 h-4 stroke-[2]" />
        </button>
      </div>

      {/* Search Bar: small rounded-[8px] matching macOS spotlight style */}
      <div className="px-3 pb-2 flex-shrink-0 no-drag">
        <div className="relative flex items-center w-full bg-[#eef0f3] rounded-[8px] h-[34px] px-2.5 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-300/60 focus-within:shadow-sm">
          <Search className="w-4 h-4 text-[#9ca3af] mr-2 flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full bg-transparent text-[13.5px] text-[#1e293b] outline-none placeholder-[#9ca3af]"
          />
        </div>
      </div>

      {/* Session conversation list for the active project */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5 no-drag scrollbar-none">
        {isLoading && agents.length === 0 && (
          <p className="px-3 py-4 text-[12px] text-[#94a3b8]" role="status">
            Loading conversations…
          </p>
        )}
        {!isLoading && error && (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-red-600" role="alert">
            {error}
          </p>
        )}
        {!isLoading && !error && filteredAgents.length === 0 && (
          <p className="px-3 py-4 text-[12px] text-[#94a3b8]">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
        )}
        {filteredAgents.map((agent) => (
          <AgentItem
            key={agent.id}
            agent={agent}
            isActive={agent.id === activeAgentId}
            onClick={() => onSelectAgent(agent.id)}
          />
        ))}
      </div>

      {/* Bottom Footer: Project Switcher (. . . +) above Settings */}
      <div className="p-2.5 flex flex-col gap-1 flex-shrink-0 no-drag">
        {onSelectProject && onAddProject && (
          <ProjectDots
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            onAddProject={onAddProject}
          />
        )}

        <button
          id="sidebarSettingsButton"
          onClick={onOpenSettings}
          className="w-full h-9 px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13px] font-medium text-[#4b5563] hover:bg-black/5 hover:text-[#0f172a] transition-colors"
        >
          <Settings className="w-4 h-4 text-[#64748b]" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};
