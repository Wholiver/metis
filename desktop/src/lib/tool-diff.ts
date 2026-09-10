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
