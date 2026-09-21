import type { DiffRow } from '../components/primitives/CodeBlock';
import type { AssistantContentPart } from '../types';
import { parseUnifiedDiff } from './review-diff';
import { isAgentInternalFilePath, type TurnFileChangeOptions } from './turn-files';

type ToolPart = Extract<AssistantContentPart, { type: 'toolCall' }>;
type ToolArgs = Record<string, unknown>;

export interface TurnFileDiff {
  path: string;
  rows: DiffRow[];
  additions: number;
  deletions: number;
}

function asArgs(value: unknown): ToolArgs {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ToolArgs
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const normalized = value.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return normalized.length === 0 ? [''] : normalized.split('\n');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^file:\/\//i, '').replace(/\/+$/, '');
}

export function relativizeWorkspacePath(filePath: string, workspacePath?: string): string {
  const normalized = normalizePath(filePath);
  if (!workspacePath) return normalized;
  const workspace = normalizePath(workspacePath);
  const windowsPath = /^[a-z]:\//i.test(normalized) || /^[a-z]:\//i.test(workspace);
  const file = windowsPath ? normalized.toLowerCase() : normalized;
  const root = windowsPath ? workspace.toLowerCase() : workspace;
  if (file === root) return '';
  if (file.startsWith(`${root}/`)) {
    return windowsPath ? normalized.slice(workspace.length + 1) : normalized.slice(workspace.length + 1);
  }
  return normalized;
}

function filePathFromArgs(args: ToolArgs): string | undefined {
  return asString(args.path)
    ?? asString(args.filePath)
    ?? asString(args.file_path)
    ?? asString(args.TargetFile)
    ?? asString(args.target);
}

function fileName(path: string | undefined): string {
  if (!path) return 'file';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function countDiffStats(rows: DiffRow[]): { additions: number; deletions: number } {
  return rows.reduce(
    (total, row) => ({
      additions: total.additions + (row.type === 'add' ? 1 : 0),
      deletions: total.deletions + (row.type === 'del' ? 1 : 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

function rowsFromWrite(content: string): DiffRow[] {
  return splitLines(content).map((text, index) => ({
    old: null,
    cur: index + 1,
    type: 'add' as const,
    pieces: [{ text, change: 'add' as const }],
  }));
}

function rowsFromReplacement(oldText: string, newText: string, startOld = 1, startNew = 1): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = startOld;
  let newLine = startNew;
  for (const text of splitLines(oldText)) {
    rows.push({
      old: oldLine,
      cur: null,
      type: 'del',
      pieces: [{ text, change: 'del' }],
    });
    oldLine += 1;
  }
  for (const text of splitLines(newText)) {
    rows.push({
      old: null,
      cur: newLine,
      type: 'add',
      pieces: [{ text, change: 'add' }],
    });
    newLine += 1;
  }
  return rows;
}

function rowsFromEditArgs(args: ToolArgs): DiffRow[] {
  const patch = asString(args.patch) ?? asString(args.diff);
  if (patch && (patch.includes('\n+') || patch.includes('\n-') || patch.startsWith('@@') || patch.startsWith('diff '))) {
    const parsed = parseUnifiedDiff(patch);
    if (parsed.length > 0) return parsed;
  }

  const edits = Array.isArray(args.edits) ? args.edits : [args];
  const rows: DiffRow[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  for (const edit of edits) {
    const item = asArgs(edit);
    const oldText = asString(item.oldText)
      ?? asString(item.old_string)
      ?? asString(item.OldString)
      ?? '';
    const newText = asString(item.newText)
      ?? asString(item.new_string)
      ?? asString(item.NewString)
      ?? '';
    if (!oldText && !newText) continue;
    const block = rowsFromReplacement(oldText, newText, oldCursor, newCursor);
    rows.push(...block);
    oldCursor += splitLines(oldText).length;
    newCursor += splitLines(newText).length;
  }
  return rows;
}

export function isFileMutationTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === 'write'
    || normalized === 'edit'
    || /write_to_file|create_file|replace_file|edit_file|apply_patch/.test(normalized);
}

export function toolResultText(part: ToolPart): string {
  const content = part.result?.content;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    const compact = JSON.stringify(content);
    if (compact.length > TOOL_TRANSCRIPT_CHAR_LIMIT) return compact;
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function buildToolFileDiff(part: ToolPart, options: TurnFileChangeOptions = {}): {
  filename: string;
  path?: string;
  rows: DiffRow[];
  mode: 'diff' | 'text';
} | null {
  if (!isFileMutationTool(part.name)) return null;
  if (part.result?.isError) return null;
  const args = asArgs(part.arguments);
  const rawPath = filePathFromArgs(args);
  if (!rawPath) return null;
  if (isAgentInternalFilePath(rawPath, options)) return null;
  const path = relativizeWorkspacePath(rawPath, options.workspacePath);
  const filename = fileName(path || rawPath);
  const name = part.name.toLowerCase();

  if (name === 'write' || /write_to_file|create_file/.test(name)) {
    const content = asString(args.content)
      ?? asString(args.CodeContent)
      ?? asString(args.code_content)
      ?? asString(args.file_text)
      ?? '';
    if (!content) return null;
    return {
      filename,
      path,
      rows: rowsFromWrite(content),
      mode: 'diff',
    };
  }

  const rows = rowsFromEditArgs(args);
  if (rows.length === 0) return null;
  return { filename, path, rows, mode: 'diff' };
}

export type ToolExpandedView =
  | { kind: 'diff'; filename: string; path?: string; rows: DiffRow[]; truncated?: boolean }
  | { kind: 'bash'; command: string; text: string }
  | { kind: 'output'; text: string; format: 'markdown' | 'pre' | 'search'; links?: string[] };

export function isShellTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === 'bash'
    || normalized === 'exec'
    || normalized === 'shell'
    || /run_command|exec_command/.test(normalized);
}

function isWebSearchTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes('websearch') || normalized.includes('search_web');
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

/** Keep expanded shell/pre output cheap to layout; copy still uses the full string. */
export const TOOL_TRANSCRIPT_LINE_LIMIT = 80;
export const TOOL_TRANSCRIPT_CHAR_LIMIT = 8_000;
export const TOOL_DIFF_ROW_LIMIT = 80;
export const TOOL_TRIGGER_TEXT_LIMIT = 96;
export const TOOL_TRIGGER_ARG_LIMIT = 48;

const HEAVY_TOOL_ARG_KEYS = new Set([
  'content',
  'oldText',
  'newText',
  'old_string',
  'new_string',
  'OldString',
  'NewString',
  'patch',
  'diff',
  'file_text',
  'CodeContent',
  'code_content',
  'edits',
]);

export function isHeavyToolArgKey(key: string): boolean {
  return HEAVY_TOOL_ARG_KEYS.has(key);
}

/** Collapse heredocs and long paths so collapsed tool rows stay cheap to layout. */
export function clipToolTriggerText(value: string, limit = TOOL_TRIGGER_TEXT_LIMIT): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export function clipToolTranscript(
  text: string,
  lineLimit = TOOL_TRANSCRIPT_LINE_LIMIT,
  charLimit = TOOL_TRANSCRIPT_CHAR_LIMIT,
): { text: string; truncated: boolean; shownLines: number } {
  if (!text) return { text: '', truncated: false, shownLines: 0 };
  const lines = text.split('\n');
  let truncated = lines.length > lineLimit;
  let clipped = truncated ? lines.slice(0, lineLimit).join('\n') : text;
  if (clipped.length > charLimit) {
    clipped = clipped.slice(0, charLimit);
    truncated = true;
  }
  const shownLines = clipped.length === 0 ? 0 : clipped.split('\n').length;
  return { text: clipped, truncated, shownLines };
}

export function extractOutputUrls(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    const url = match[0].replace(/[),.;:!?]+$/g, '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function outputFormat(name: string, text: string): 'markdown' | 'pre' | 'search' {
  if (isWebSearchTool(name)) return 'search';
  const normalized = name.toLowerCase();
  if (normalized === 'log' || normalized === 'video' || normalized.startsWith('browser_')) return 'pre';
  if (text.length > TOOL_TRANSCRIPT_CHAR_LIMIT) return 'pre';
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return 'pre';
  }
  return 'markdown';
}

function hasResultText(part: ToolPart): boolean {
  const content = part.result?.content;
  if (typeof content === 'string') return content.length > 0;
  return content != null;
}

/** Cheap collapsed-row check — do not parse diffs or concatenate transcripts. */
export function toolHasExpandableDetails(part: ToolPart): boolean {
  if (isShellTool(part.name)) {
    const args = asArgs(part.arguments);
    return Boolean(asString(args.command) ?? asString(args.cmd)) || hasResultText(part);
  }
  if (isFileMutationTool(part.name) && !part.result?.isError) {
    const args = asArgs(part.arguments);
    if (!filePathFromArgs(args)) return hasResultText(part);
    const name = part.name.toLowerCase();
    if (name === 'write' || /write_to_file|create_file/.test(name)) {
      return Boolean(
        asString(args.content)
        ?? asString(args.CodeContent)
        ?? asString(args.code_content)
        ?? asString(args.file_text)
      ) || hasResultText(part);
    }
    return Boolean(
      asString(args.patch)
      ?? asString(args.diff)
      ?? asString(args.oldText)
      ?? asString(args.newText)
    ) || Array.isArray(args.edits) || hasResultText(part);
  }
  return hasResultText(part);
}

export function toolKindHint(part: ToolPart): string | undefined {
  if (isShellTool(part.name)) return 'bash';
  if (isFileMutationTool(part.name)) return 'file-diff';
  return undefined;
}

export function buildToolExpandedView(
  part: ToolPart,
  options: TurnFileChangeOptions = {},
): ToolExpandedView | null {
  if (isShellTool(part.name)) {
    const args = asArgs(part.arguments);
    const command = asString(args.command) ?? asString(args.cmd) ?? '';
    const output = stripAnsi(toolResultText(part)).replace(/\r\n?/g, '\n');
    if (!command && !output) return null;
    return {
      kind: 'bash',
      command,
      text: `$ ${command}${output ? `\n\n${output}` : ''}`,
    };
  }

  const fileDiff = buildToolFileDiff(part, options);
  if (fileDiff && fileDiff.rows.length > 0) {
    const truncated = fileDiff.rows.length > TOOL_DIFF_ROW_LIMIT;
    return {
      kind: 'diff',
      filename: fileDiff.filename,
      path: fileDiff.path,
      rows: truncated ? fileDiff.rows.slice(0, TOOL_DIFF_ROW_LIMIT) : fileDiff.rows,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  const output = toolResultText(part);
  if (!output) return null;
  const format = outputFormat(part.name, output);
  const links = format === 'search' ? extractOutputUrls(output) : undefined;
  return { kind: 'output', text: output, format, ...(links && links.length ? { links } : {}) };
}

/** Aggregate write/edit/apply_patch diffs for Review Turn mode. */
export function collectTurnFileDiffs(
  parts: AssistantContentPart[],
  options: TurnFileChangeOptions = {},
): TurnFileDiff[] {
  const byPath = new Map<string, DiffRow[]>();
  for (const part of parts) {
    if (part.type !== 'toolCall') continue;
    if (!part.result || part.result.isError) continue;
    const built = buildToolFileDiff(part, options);
    if (!built?.path || built.rows.length === 0) continue;
    const current = byPath.get(built.path) || [];
    // A later write replaces prior rows for the same path.
    if (/^write$|write_to_file|create_file/i.test(part.name)) {
      byPath.set(built.path, built.rows);
    } else {
      byPath.set(built.path, [...current, ...built.rows]);
    }
  }

  return [...byPath.entries()]
    .map(([path, rows]) => {
      const stats = countDiffStats(rows);
      return { path, rows, additions: stats.additions, deletions: stats.deletions };
    })
    .filter((item) => item.additions > 0 || item.deletions > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}
