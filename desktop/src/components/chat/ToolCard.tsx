import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
} from 'lucide-react';
import { AssistantContentPart } from '../../types';
import { useElapsedDuration } from '../../hooks/useElapsedDuration';
import { computeToolDiffStats } from '../../lib/turn-files';

export type ToolPart = Extract<AssistantContentPart, { type: 'toolCall' }>;
export type ToolStatus = 'Running' | 'Pending' | 'Completed' | 'Error' | 'Denied';

export function toolStatus(part: ToolPart, streaming: boolean): ToolStatus {
  if (part.progress) {
    if (part.progress.state === 'running') return 'Running';
    if (part.progress.state === 'failed') return 'Error';
    return 'Completed';
  }
  if (part.result) {
    if (!part.result.isError) return 'Completed';
    const output = part.result.content.toLowerCase();
    return /denied|rejected|cancel/.test(output) ? 'Denied' : 'Error';
  }
  return streaming ? 'Running' : 'Pending';
}

function formatSubagentDuration(durationMs: number | undefined): string {
  if (!Number.isFinite(durationMs) || Number(durationMs) < 0) return '';
  if (Number(durationMs) < 1000) return `${Math.max(1, Math.round(Number(durationMs)))}ms`;
  if (Number(durationMs) < 60000) return `${(Number(durationMs) / 1000).toFixed(Number(durationMs) < 10000 ? 1 : 0)}s`;
  const totalSeconds = Math.round(Number(durationMs) / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

export function formatToolDisplayName(toolName: string, status: ToolStatus, args: unknown): string {
  const name = toolName.toLowerCase();
  const values = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const running = status === 'Running' || status === 'Pending';
  const failed = status === 'Error' || status === 'Denied';
  if (name.includes('websearch') || name.includes('search_web')) return running ? 'WebSearching...' : failed ? 'WebSearch Failed' : 'WebSearched';
  if (name.includes('webfetch')) return running ? 'Fetching Page...' : failed ? 'Fetch Failed' : 'Fetched Page';
  if (name === 'read_plan') return running ? 'Reading Plan…' : failed ? 'Plan Read Failed' : 'Read Plan';
  if (name === 'read' || /read_file|view_file|read_resource|read_mcp_resource/.test(name)) return running ? 'Reading File...' : failed ? 'Failed Reading File' : 'Read File';
  if (name === 'write' || name === 'edit' || /write_to_file|replace_file|edit_file|apply_patch/.test(name)) return running ? 'Editing File...' : failed ? 'Failed Editing File' : 'Edited File';
  if (name === 'bash' || name === 'exec' || name.includes('run_command')) return running ? 'Running Command...' : failed ? 'Command Failed' : 'Ran Command';
  if (name === 'ls' || name.includes('list_dir')) return running ? 'Listing Directory...' : failed ? 'Failed Listing Directory' : 'Listed Directory';
  if (name === 'find' || name === 'grep' || name.includes('search_code')) return running ? 'Searching Codebase...' : failed ? 'Search Failed' : 'Searched Codebase';
  if (name === 'list_agents') return running ? 'Listing Agents…' : failed ? 'Failed Listing Agents' : 'Listed Agents';
  if (name === 'wait_agent') return running ? 'Waiting for Agent…' : failed ? 'Failed Waiting Agent' : 'Waited for Agent';
  if (name === 'kill_agent') return running ? 'Terminating Agent…' : failed ? 'Failed Terminating Agent' : 'Terminated Agent';
  if (name === 'message_agent') return running ? 'Messaging Agent…' : failed ? 'Failed Messaging Agent' : 'Messaged Agent';
  if (name === 'query_memory_db') return running ? 'Querying Memory…' : failed ? 'Query Memory Failed' : 'Queried Memory';
  if (name.includes('spawn_agent') || name.includes('subagent')) {
    const agent = values.agent ? String(values.agent) : '';
    if (running) return agent ? `Spawning ${agent}…` : 'Spawning Agent…';
    if (failed) return agent ? `${agent} Failed` : 'Agent Failed';
    return agent ? `Spawned ${agent}` : 'Spawned Agent';
  }
  const formatted = (toolName || 'Tool').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  return running ? `Running ${formatted}` : failed ? `${formatted} Failed` : formatted;
}

export const ToolCard = React.memo<{ part: ToolPart; streaming?: boolean }>(({ part, streaming = false }) => {
  const [expanded, setExpanded] = useState(false);
  const status = toolStatus(part, streaming);
  const running = status === 'Running' || status === 'Pending';
  const subagent = /spawn_agent|subagent/.test(part.name.toLowerCase());
  const args = part.arguments && typeof part.arguments === 'object' ? part.arguments as Record<string, unknown> : {};
  const targetAgent = args.agent ? String(args.agent) : '';
  const displayTask = String(args.task || args.title || 'Subagent task');
  const subagentTitle = targetAgent ? `${targetAgent}: ${displayTask}` : displayTask;
  const liveSubagentDurationMs = useElapsedDuration(
    part.progress?.startedAt,
    part.progress?.durationMs,
    subagent && running,
  );
  const subagentDuration = formatSubagentDuration(liveSubagentDurationMs);
  const diffStats = computeToolDiffStats(part, status);
  const detailsId = `tool-${part.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div
      className={`tool-card ${expanded ? '' : 'collapsed'} ${running ? 'running' : ''} ${subagent ? 'subagent-tool-card' : ''} ${subagent && (status === 'Error' || status === 'Denied') ? 'failed' : ''}`}
      data-part-key={part.id}
      data-part-type="toolCall"
      data-tool-name={part.name}
      data-tool-status={status}
      {...(part.progress ? { 'data-job-id': part.progress.jobId, 'data-state': part.progress.state } : {})}
    >
      <button
        type="button"
        className={`tool-header-bar ${subagent ? 'subagent-tool-header' : ''}`}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`tool-name ${running ? 'shimmering' : ''}`}>
          {subagent ? subagentTitle : formatToolDisplayName(part.name, status, part.arguments)}
        </span>
        {diffStats && (
          <span className="tool-diff-stats" aria-label={`+${diffStats.added} -${diffStats.removed}`}>
            {diffStats.added > 0 && <span className="tool-diff-added">+{diffStats.added}</span>}
            {diffStats.removed > 0 && <span className="tool-diff-removed">-{diffStats.removed}</span>}
          </span>
        )}
        <span className="tool-duration">{subagentDuration}</span>
        {subagent && (
          <span className={`subagent-tool-status ${status === 'Error' || status === 'Denied' ? 'failed' : ''}`}>
            {status === 'Completed' && <Check aria-hidden="true" />}
            {status === 'Error' || status === 'Denied' ? 'Failed' : status}
          </span>
        )}
        <ChevronRight aria-hidden="true" className="tool-chevron" strokeWidth={1.7} />
      </button>
      <div id={detailsId} className={`tool-details-body ${subagent ? 'subagent-tool-details' : ''}`} aria-hidden={!expanded}>
        <div className="tool-card-collapse-wrapper">
          <div className="min-h-0">
            {subagent ? (
              <>
                <div className="tool-section-title">Task</div>
                <p className="subagent-tool-task" title={String(args.task || args.title || '')}>{displayTask}</p>
                <div className="subagent-tool-meta">
                  <span>{args.mode === 'sync' ? 'Synchronous' : args.mode === 'async' ? 'Asynchronous' : 'Background'}</span>
                  <code>ID #{part.progress?.jobId || part.id.slice(-6)}</code>
                  {args.worktree && <span className="subagent-tool-worktree">Worktree: {String(args.worktree)}</span>}
                  {subagentDuration && <span className="subagent-tool-duration">Duration: {subagentDuration}</span>}
                </div>
              </>
            ) : (
              <>
                <div className="tool-section-title">Arguments:</div>
                <pre><code>{typeof part.arguments === 'object' ? JSON.stringify(part.arguments, null, 2) : String(part.arguments ?? '')}</code></pre>
              </>
            )}
            {!subagent && part.result && (
              <>
                <div className="tool-section-title">Output:</div>
                <pre><code>{part.result.content}</code></pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

ToolCard.displayName = 'ToolCard';

