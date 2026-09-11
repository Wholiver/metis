import React, { useId, useMemo, useState } from 'react';
import {
  Check,
  FilePenLine,
  FileSearch,
  FolderSearch,
  Glasses,
  List,
  Search,
  Terminal,
  Brain,
  Bot,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { AssistantContentPart } from '../../types';
import { useElapsedDuration } from '../../hooks/useElapsedDuration';
import { computeToolDiffStats } from '../../lib/turn-files';
import { buildToolFileDiff } from '../../lib/tool-diff';
import CodeBlock from '../primitives/CodeBlock';
import { BasicTool } from './BasicTool';

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
  if (name === 'bash' || name === 'exec' || /run_command|exec_command/.test(name)) return running ? 'Running Command...' : failed ? 'Command Failed' : 'Ran Command';
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

function toolIcon(name: string): LucideIcon {
  const normalized = name.toLowerCase();
  if (normalized === 'read' || /read_file|view_file|read_plan|read_resource/.test(normalized)) return Glasses;
  if (normalized === 'write' || normalized === 'edit' || /write_to_file|replace_file|edit_file|apply_patch/.test(normalized)) return FilePenLine;
  if (normalized === 'bash' || normalized === 'exec' || /run_command|exec_command/.test(normalized)) return Terminal;
  if (normalized === 'ls' || /list_dir/.test(normalized)) return List;
  if (normalized === 'glob' || normalized === 'find') return FolderSearch;
  if (normalized === 'grep' || /search/.test(normalized)) return Search;
  if (/spawn_agent|subagent|agent/.test(normalized)) return Bot;
  if (/skill/.test(normalized)) return Brain;
  if (/webfetch|websearch/.test(normalized)) return FileSearch;
  return Wrench;
}

function fileName(value: unknown): string {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

export function openCodeToolTitle(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes('websearch') || name.includes('search_web')) return 'Web search';
  if (name.includes('webfetch')) return 'Fetch';
  if (name === 'read_plan') return 'Read plan';
  if (name === 'read' || /read_file|view_file|read_resource|read_mcp_resource/.test(name)) return 'Read';
  if (name === 'write' || /write_to_file/.test(name)) return 'Write';
  if (name === 'edit' || /replace_file|edit_file|apply_patch/.test(name)) return 'Edit';
  if (name === 'bash' || name === 'exec' || /run_command|exec_command/.test(name)) return 'Shell';
  if (name === 'ls' || name.includes('list_dir')) return 'List';
  if (name === 'find' || name === 'glob') return 'Glob';
  if (name === 'grep' || name.includes('search_code')) return 'Grep';
  if (name === 'query_memory_db') return 'Memory';
  return (toolName || 'Tool').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

/** OpenCode GenericTool subtitle/args helpers. */
export function toolTriggerFields(part: ToolPart, _status: ToolStatus): {
  title: string;
  subtitle?: string;
  args?: string[];
} {
  const input = part.arguments && typeof part.arguments === 'object'
    ? part.arguments as Record<string, unknown>
    : {};
  const title = openCodeToolTitle(part.name);
  const labelKeys = ['description', 'query', 'url', 'filePath', 'path', 'pattern', 'name', 'command', 'cmd', 'task', 'title'];
  const subtitleRaw = labelKeys.map((key) => input[key]).find((value): value is string => typeof value === 'string' && value.length > 0);
  const skip = new Set(labelKeys);
  const args = Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [`${key}=${value}`];
      }
      return [];
    })
    .slice(0, 3);

  const subtitle = subtitleRaw
    ? (fileName(subtitleRaw) || subtitleRaw)
    : undefined;

  return { title, subtitle, args: args.length ? args : undefined };
}

export const ToolCard = React.memo<{ part: ToolPart; streaming?: boolean }>(({ part, streaming = false }) => {
  const [expanded, setExpanded] = useState(false);
  const status = toolStatus(part, streaming);
  const running = status === 'Running' || status === 'Pending';
  const subagent = /spawn_agent|subagent/.test(part.name.toLowerCase());
  const args = part.arguments && typeof part.arguments === 'object' ? part.arguments as Record<string, unknown> : {};
  const targetAgent = args.agent ? String(args.agent) : '';
  const displayTask = String(args.task || args.title || 'Subagent task');
  const liveSubagentDurationMs = useElapsedDuration(
    part.progress?.startedAt,
    part.progress?.durationMs,
    subagent && running,
  );
  const subagentDuration = formatSubagentDuration(liveSubagentDurationMs);
  const diffStats = computeToolDiffStats(part, status);
  const fileDiff = useMemo(() => (subagent ? null : buildToolFileDiff(part)), [part, subagent]);
  const detailsId = useId();
  const fields = toolTriggerFields(part, status);
  const Icon = toolIcon(part.name);

  const action = (
    <>
      {diffStats && (
        <span className="tool-diff-stats" aria-label={`+${diffStats.added} -${diffStats.removed}`}>
          {diffStats.added > 0 && <span className="tool-diff-added">+{diffStats.added}</span>}
          {diffStats.removed > 0 && <span className="tool-diff-removed">-{diffStats.removed}</span>}
        </span>
      )}
      {subagentDuration && <span className="tool-duration">{subagentDuration}</span>}
      {subagent && (
        <span className={`subagent-tool-status ${status === 'Error' || status === 'Denied' ? 'failed' : ''}`}>
          {status === 'Completed' && <Check aria-hidden="true" size={12} />}
          {status === 'Error' || status === 'Denied' ? 'Failed' : status}
        </span>
      )}
    </>
  );

  return (
    <div
      className={`tool-card ${expanded ? '' : 'collapsed'} ${running ? 'running' : ''} ${subagent ? 'subagent-tool-card' : ''} ${subagent && (status === 'Error' || status === 'Denied') ? 'failed' : ''}`}
      data-part-key={part.id}
      data-part-type="toolCall"
      data-tool-name={part.name}
      data-tool-status={status}
      data-tool-kind={fileDiff ? 'file-diff' : undefined}
      {...(part.progress ? { 'data-job-id': part.progress.jobId, 'data-state': part.progress.state } : {})}
    >
      <BasicTool
        icon={Icon}
        status={running ? 'running' : status === 'Error' || status === 'Denied' ? 'error' : 'completed'}
        allowOpenWhilePending
        open={expanded}
        onOpenChange={setExpanded}
        trigger={{
          title: subagent ? (targetAgent || 'Agent') : fields.title,
          subtitle: subagent ? displayTask : fields.subtitle,
          args: subagent ? undefined : fields.args,
          action,
        }}
      >
        <div
          id={detailsId}
          className={`tool-details-body ${subagent ? 'subagent-tool-details' : ''} ${fileDiff ? 'tool-details-flush' : ''}`}
          aria-hidden={!expanded}
        >
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
          ) : fileDiff ? (
            <div data-component="tool-output" data-scrollable="" className="tool-output-scroll tool-file-diff">
              <CodeBlock
                variant="Diff"
                flush
                filename={fileDiff.filename}
                diff={fileDiff.rows}
                code={fileDiff.rows.map((row) => row.pieces.map((piece) => piece.text).join('')).join('\n')}
              />
            </div>
          ) : (
            <>
              <div className="tool-section-title">Arguments:</div>
              <div data-component="tool-output" data-scrollable="" className="tool-output-scroll">
                <pre><code>{typeof part.arguments === 'object' ? JSON.stringify(part.arguments, null, 2) : String(part.arguments ?? '')}</code></pre>
              </div>
            </>
          )}
          {!subagent && !fileDiff && part.result && (
            <>
              <div className="tool-section-title">Output:</div>
              <div data-component="tool-output" data-scrollable="" className="tool-output-scroll">
                <pre><code>{part.result.content}</code></pre>
              </div>
            </>
          )}
        </div>
      </BasicTool>
    </div>
  );
});

ToolCard.displayName = 'ToolCard';
