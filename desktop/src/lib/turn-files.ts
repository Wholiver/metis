import { AssistantContentPart } from '../types';

export interface TurnFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface TurnFileChangeOptions {
  workspacePath?: string;
}

type ToolArguments = Record<string, unknown>;

const AGENT_GOVERNANCE_FILES = new Set([
  'roadmap.md',
  'gatelog.md',
  'prompts.txt',
]);

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^file:\/\//i, '').replace(/\/+$/, '');
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:\//i.test(value);
}

function isInsideWorkspace(filePath: string, workspacePath: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedWorkspace = normalizePath(workspacePath);
  const windowsPath = /^[a-z]:\//i.test(normalizedFile) || /^[a-z]:\//i.test(normalizedWorkspace);
  const file = windowsPath ? normalizedFile.toLowerCase() : normalizedFile;
  const workspace = windowsPath ? normalizedWorkspace.toLowerCase() : normalizedWorkspace;
  return file === workspace || file.startsWith(`${workspace}/`);
}

export function isAgentInternalFilePath(filePath: string, options: TurnFileChangeOptions = {}): boolean {
  const normalized = normalizePath(filePath);
  const basename = normalized.split('/').at(-1)?.toLowerCase() || '';
  if (AGENT_GOVERNANCE_FILES.has(basename)) return true;
  if (/^g(?:[0-7]|3\.5)(?:[-_.].*)?receipt\.md$/i.test(basename)) return true;
  if (/^\.metis-(?:agent-task-|subagent-|agent-.*\.log$)/i.test(basename)) return true;
  if (/\/(?:\.metis\/agent\/performance-runs|metis-performance-runs?)\//i.test(`/${normalized}`)) return true;
  if (options.workspacePath && isAbsolutePath(normalized) && !isInsideWorkspace(normalized, options.workspacePath)) return true;
  return false;
}

function asToolArguments(value: unknown): ToolArguments | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ToolArguments : undefined;
}

function lineCount(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0);
}

function editStats(args: ToolArguments): Pick<TurnFileChange, 'additions' | 'deletions'> {
  const edits = Array.isArray(args.edits) ? args.edits : [args];
  return edits.reduce((total, edit) => {
    const replacement = asToolArguments(edit);
    return {
      additions: total.additions + lineCount(replacement?.newText),
      deletions: total.deletions + lineCount(replacement?.oldText),
    };
  }, { additions: 0, deletions: 0 });
}

function changeFromTool(
  part: Extract<AssistantContentPart, { type: 'toolCall' }>,
  options: TurnFileChangeOptions = {},
): TurnFileChange | undefined {
  if (!part.result || part.result.isError) return undefined;
  const args = asToolArguments(part.arguments);
  const path = typeof args?.path === 'string'
    ? args.path
    : typeof args?.filePath === 'string'
    ? args.filePath
    : typeof args?.file_path === 'string'
    ? args.file_path
    : typeof args?.target === 'string'
    ? args.target
    : typeof args?.TargetFile === 'string'
    ? args.TargetFile
    : undefined;
  if (!path) return undefined;
  if (isAgentInternalFilePath(path, options)) return undefined;

  const name = part.name.toLowerCase();
  if (name === 'write' || /write_to_file|create_file/.test(name)) {
    const content = args.content ?? args.CodeContent ?? args.code_content ?? args.file_text;
    const additions = lineCount(content);
    return additions > 0 ? { path, additions, deletions: 0 } : undefined;
  }
  if (name !== 'edit' && !/replace_file|edit_file|apply_patch/.test(name)) return undefined;

  const { additions, deletions } = editStats(args);
  return additions || deletions ? { path, additions, deletions } : undefined;
}

export function collectTurnFileChanges(parts: AssistantContentPart[], options: TurnFileChangeOptions = {}): TurnFileChange[] {
  const changes = new Map<string, TurnFileChange>();
  for (const part of parts) {
    if (part.type !== 'toolCall') continue;
    const change = changeFromTool(part, options);
    if (!change) continue;
    const current = changes.get(change.path);
    changes.set(change.path, current
      ? { ...current, additions: current.additions + change.additions, deletions: current.deletions + change.deletions }
      : change);
  }
  return [...changes.values()];
}

export function computeToolDiffStats(
  part: Extract<AssistantContentPart, { type: 'toolCall' }>,
  status?: string,
  options: TurnFileChangeOptions = {},
): { added: number; removed: number } | null {
  if (status && status !== 'Completed') return null;
  const change = changeFromTool(part, options);
  if (!change) return null;
  if (change.additions === 0 && change.deletions === 0) return null;
  return { added: change.additions, removed: change.deletions };
}

