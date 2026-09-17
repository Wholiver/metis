import React, { useId, useMemo, useState } from 'react';
import {
  FilePenLine,
  FileSearch,
  FolderSearch,
  Glasses,
  Globe,
  List,
  Search,
  Terminal,
  Brain,
  Bot,
  Wrench,
  Copy,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { AssistantContentPart } from '../../types';
import { computeToolDiffStats } from '../../lib/turn-files';
import { buildToolExpandedView, clipToolTranscript } from '../../lib/tool-diff';
import { useI18n } from '../../i18n';
import CodeBlock from '../primitives/CodeBlock';
import { BasicTool } from './BasicTool';
import { MarkdownContent } from './MarkdownContent';
import { TaskToolChip } from './TaskToolChip';

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

export function isToolCallFinished(part: ToolPart): boolean {
  const status = toolStatus(part, false);
  return status === 'Completed' || status === 'Error' || status === 'Denied';
}

export function formatToolDisplayName(toolName: string, status: ToolStatus, args: unknown): string {
  const name = toolName.toLowerCase();
  const values = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const running = status === 'Running' || status === 'Pending';
  const failed = status === 'Error' || status === 'Denied';
  if (name.includes('spawn_agent') || name.includes('subagent')) {
    const agent = values.agent ? String(values.agent) : '';
    if (running) return agent ? `Spawning ${agent}…` : 'Spawning Agent…';
    if (failed) return agent ? `${agent} Failed` : 'Agent Failed';
    return agent ? `Spawned ${agent}` : 'Spawned Agent';
  }
  return openCodeToolTitle(toolName);
}

function toolIcon(name: string): LucideIcon {
  const normalized = name.toLowerCase();
  if (normalized === 'read' || /read_file|view_file|read_plan|read_resource/.test(normalized)) return Glasses;
  if (normalized === 'write' || normalized === 'edit' || /write_to_file|replace_file|edit_file|apply_patch/.test(normalized)) return FilePenLine;
  if (normalized === 'bash' || normalized === 'exec' || /run_command|exec_command/.test(normalized)) return Terminal;
  if (normalized === 'ls' || /list_dir/.test(normalized)) return List;
  if (normalized === 'glob' || normalized === 'find') return FolderSearch;
  if (normalized === 'grep' || /search/.test(normalized)) return Search;
  if (normalized.startsWith('browser_')) return Globe;
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

const TOOL_TITLE_KEYS: Record<string, string> = {
  write: 'toolTitleWrite',
  write_to_file: 'toolTitleWrite',
  edit: 'toolTitleEdit',
  replace_file: 'toolTitleEdit',
  edit_file: 'toolTitleEdit',
  apply_patch: 'toolTitleEdit',
  read: 'toolTitleRead',
  read_file: 'toolTitleRead',
  view_file: 'toolTitleRead',
  read_resource: 'toolTitleRead',
  read_mcp_resource: 'toolTitleRead',
  read_plan: 'toolTitleReadPlan',
  bash: 'toolTitleShell',
  exec: 'toolTitleShell',
  shell: 'toolTitleShell',
  run_command: 'toolTitleShell',
  exec_command: 'toolTitleShell',
  ls: 'toolTitleList',
  list: 'toolTitleList',
  list_dir: 'toolTitleList',
  glob: 'toolTitleGlob',
  find: 'toolTitleFind',
  grep: 'toolTitleGrep',
  search_code: 'toolTitleGrep',
  websearch: 'toolTitleWebSearch',
  search_web: 'toolTitleWebSearch',
  webfetch: 'toolTitleFetch',
  query_memory_db: 'toolTitleMemory',
  task: 'toolTitleTask',
  todo: 'toolTitleTodo',
  todowrite: 'toolTitleTodo',
  performance_admit: 'toolTitlePerformanceAdmit',
  performance_gate: 'toolTitlePerformanceGate',
  browser_navigate: 'toolTitleBrowserNavigate',
  browser_snapshot: 'toolTitleBrowserSnapshot',
  browser_take_screenshot: 'toolTitleBrowserScreenshot',
  browser_click: 'toolTitleBrowserClick',
  browser_fill: 'toolTitleBrowserFill',
  browser_type: 'toolTitleBrowserType',
  browser_press_key: 'toolTitleBrowserPressKey',
  browser_scroll: 'toolTitleBrowserScroll',
  browser_tabs: 'toolTitleBrowserTabs',
  log: 'toolTitleLog',
  video: 'toolTitleVideo',
  update_plan: 'toolTitleUpdatePlan',
  ask_user: 'toolTitleAskUser',
  list_agents: 'toolTitleListAgents',
  wait_agent: 'toolTitleWaitAgent',
  kill_agent: 'toolTitleKillAgent',
  message_agent: 'toolTitleMessageAgent',
  remember_user_intent: 'toolTitleRememberIntent',
  user_intent: 'toolTitleUserIntent',
  skill: 'toolTitleSkill',
};

export function openCodeToolTitleKey(toolName: string): string | undefined {
  const name = toolName.toLowerCase();
  if (TOOL_TITLE_KEYS[name]) return TOOL_TITLE_KEYS[name];
  if (name.includes('websearch') || name.includes('search_web')) return 'toolTitleWebSearch';
  if (name.includes('webfetch')) return 'toolTitleFetch';
  if (/write_to_file/.test(name)) return 'toolTitleWrite';
  if (/replace_file|edit_file|apply_patch/.test(name)) return 'toolTitleEdit';
  if (/read_file|view_file|read_resource|read_mcp_resource/.test(name)) return 'toolTitleRead';
  if (/run_command|exec_command/.test(name)) return 'toolTitleShell';
  if (name.includes('list_dir')) return 'toolTitleList';
  if (name.includes('search_code')) return 'toolTitleGrep';
  if (/todo/.test(name)) return 'toolTitleTodo';
  return undefined;
}

const OPEN_CODE_TITLE_FALLBACK: Record<string, string> = {
  toolTitleWrite: 'Write',
  toolTitleEdit: 'Edit',
  toolTitleRead: 'Read',
  toolTitleReadPlan: 'Read plan',
  toolTitleShell: 'Shell',
  toolTitleGrep: 'Grep',
  toolTitleGlob: 'Glob',
  toolTitleFind: 'Find',
  toolTitleList: 'List',
  toolTitleFetch: 'Fetch',
  toolTitleWebSearch: 'WebSearch',
  toolTitleMemory: 'Memory',
  toolTitleTask: 'Task',
  toolTitleTodo: 'Todo',
  toolTitlePerformanceAdmit: 'Performance Admit',
  toolTitlePerformanceGate: 'Performance Gate',
  toolTitleBrowserNavigate: 'Browser Navigate',
  toolTitleBrowserSnapshot: 'Browser Snapshot',
  toolTitleBrowserScreenshot: 'Browser Screenshot',
  toolTitleBrowserClick: 'Browser Click',
  toolTitleBrowserFill: 'Browser Fill',
  toolTitleBrowserType: 'Browser Type',
  toolTitleBrowserPressKey: 'Browser Press Key',
  toolTitleBrowserScroll: 'Browser Scroll',
  toolTitleBrowserTabs: 'Browser Tabs',
  toolTitleLog: 'Log',
  toolTitleVideo: 'Video',
  toolTitleUpdatePlan: 'Update plan',
  toolTitleAskUser: 'Ask user',
  toolTitleListAgents: 'List agents',
  toolTitleWaitAgent: 'Wait agent',
  toolTitleKillAgent: 'Stop agent',
  toolTitleMessageAgent: 'Message agent',
  toolTitleRememberIntent: 'Remember intent',
  toolTitleUserIntent: 'User intent',
  toolTitleSkill: 'Skill',
};

export function openCodeToolTitle(toolName: string): string {
  const key = openCodeToolTitleKey(toolName);
  if (key) return OPEN_CODE_TITLE_FALLBACK[key] || 'Tool';
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
  let subtitleKey: string | undefined;
  let subtitleRaw: string | undefined;
  for (const key of labelKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      subtitleKey = key;
      subtitleRaw = value;
      break;
    }
  }
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

  const keepRaw = subtitleKey === 'url'
    || subtitleKey === 'query'
    || subtitleKey === 'command'
    || subtitleKey === 'cmd'
    || subtitleKey === 'pattern'
    || subtitleKey === 'description'
    || subtitleKey === 'task'
    || subtitleKey === 'title';
  const subtitle = subtitleRaw
    ? (keepRaw ? subtitleRaw : (fileName(subtitleRaw) || subtitleRaw))
    : undefined;

  return { title, subtitle, args: args.length ? args : undefined };
}

function toolKindAttr(view: ReturnType<typeof buildToolExpandedView>): string | undefined {
  if (!view) return undefined;
  if (view.kind === 'diff') return 'file-diff';
  return view.kind;
}

const ToolTranscript = React.memo(function ToolTranscript({
  text,
  variant,
  links,
}: {
  text: string;
  variant: 'bash' | 'markdown' | 'pre' | 'search';
  links?: string[];
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const clipped = variant === 'bash' || variant === 'pre' ? clipToolTranscript(text) : null;
  const visible = clipped?.text ?? text;
  const handleCopy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  };
  const component = variant === 'bash' ? 'bash-output' : 'tool-transcript';
  return (
    <div data-component={component} data-variant={variant} dir="ltr">
      <div data-slot="tool-transcript-copy">
        <button
          type="button"
          data-slot="tool-transcript-copy-button"
          aria-label={copied ? t('logCopied') : t('copy')}
          title={copied ? t('logCopied') : t('copy')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCopy}
        >
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={1.8} />}
        </button>
      </div>
      <div data-slot="tool-transcript-scroll" data-scrollable="" tabIndex={0} role="region">
        {variant === 'search' && links && links.length > 0 ? (
          <div data-component="exa-tool-output">
            <div data-slot="exa-tool-links">
              {links.map((url) => (
                <a
                  key={url}
                  data-slot="exa-tool-link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  {url}
                </a>
              ))}
            </div>
          </div>
        ) : variant === 'pre' || variant === 'bash' ? (
          <>
            <pre data-slot="tool-transcript-pre" data-i18n-skip="">
              <code>{visible}</code>
            </pre>
            {clipped?.truncated && (
              <div data-slot="tool-transcript-truncated">
                {t('toolOutputTruncated', { count: clipped.shownLines })}
              </div>
            )}
          </>
        ) : (
          <div data-slot="tool-transcript-markdown" data-i18n-skip="">
            <MarkdownContent markdown={text} />
          </div>
        )}
      </div>
    </div>
  );
});

export const ToolCard = React.memo<{
  part: ToolPart;
  streaming?: boolean;
  onOpenSubagent?: (partId: string) => void;
}>(({ part, streaming = false, onOpenSubagent }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const status = toolStatus(part, streaming);
  const running = status === 'Running' || status === 'Pending';
  const subagent = /spawn_agent|subagent/.test(part.name.toLowerCase());
  const args = part.arguments && typeof part.arguments === 'object' ? part.arguments as Record<string, unknown> : {};
  const targetAgent = args.agent ? String(args.agent) : '';
  const displayTask = String(args.task || args.title || 'Subagent task');
  const diffStats = computeToolDiffStats(part, status);
  const expandedView = useMemo(() => (subagent ? null : buildToolExpandedView(part)), [part, subagent]);
  const detailsId = useId();
  const fields = toolTriggerFields(part, status);
  const titleKey = openCodeToolTitleKey(part.name);
  const title = titleKey ? t(titleKey) : fields.title;
  const Icon = toolIcon(part.name);

  if (subagent) {
    return (
      <div
        className={`tool-card subagent-tool-card task-tool-chip ${running ? 'running' : ''} ${status === 'Error' || status === 'Denied' ? 'failed' : ''}`}
        data-part-key={part.id}
        data-part-type="toolCall"
        data-tool-name={part.name}
        data-tool-status={status}
        {...(part.progress ? { 'data-job-id': part.progress.jobId, 'data-state': part.progress.state } : {})}
      >
        <TaskToolChip
          agent={targetAgent}
          task={displayTask}
          running={running}
          onOpen={onOpenSubagent ? () => onOpenSubagent(part.id) : undefined}
        />
      </div>
    );
  }

  const hideDetails = !expandedView || titleKey === 'toolTitleFetch';
  const showCommandSubtitle = !(expandedView?.kind === 'bash' && expanded);

  const action = (
    <>
      {diffStats && (
        <span className="tool-diff-stats" aria-label={`+${diffStats.added} -${diffStats.removed}`}>
          {diffStats.added > 0 && <span className="tool-diff-added">+{diffStats.added}</span>}
          {diffStats.removed > 0 && <span className="tool-diff-removed">-{diffStats.removed}</span>}
        </span>
      )}
    </>
  );

  return (
    <div
      className={`tool-card ${expanded ? '' : 'collapsed'} ${running ? 'running' : ''}`}
      data-part-key={part.id}
      data-part-type="toolCall"
      data-tool-name={part.name}
      data-tool-status={status}
      data-tool-kind={toolKindAttr(expandedView)}
    >
      <BasicTool
        icon={Icon}
        status={running ? 'running' : status === 'Error' || status === 'Denied' ? 'error' : 'completed'}
        allowOpenWhilePending={expandedView?.kind === 'bash'}
        hideDetails={hideDetails}
        defer={expandedView?.kind === 'bash' || expandedView?.kind === 'diff'}
        open={expanded}
        onOpenChange={setExpanded}
        trigger={{
          title,
          subtitle: showCommandSubtitle ? fields.subtitle : undefined,
          args: fields.args,
          action,
        }}
      >
        {expandedView && !hideDetails ? (
          <div
            id={detailsId}
            className="tool-details-body tool-details-flush"
            aria-hidden={!expanded}
          >
            {expandedView.kind === 'diff' ? (
              <div data-component="tool-output" data-scrollable="" className="tool-output-scroll tool-file-diff">
                <CodeBlock
                  variant="Diff"
                  flush
                  filename={expandedView.filename}
                  diff={expandedView.rows}
                  code={expandedView.rows.map((row) => row.pieces.map((piece) => piece.text).join('')).join('\n')}
                />
              </div>
            ) : expandedView.kind === 'bash' ? (
              <ToolTranscript variant="bash" text={expandedView.text} />
            ) : (
              <ToolTranscript
                variant={expandedView.format}
                text={expandedView.text}
                links={expandedView.links}
              />
            )}
          </div>
        ) : null}
      </BasicTool>
    </div>
  );
});

ToolCard.displayName = 'ToolCard';
