import type { DiffRow } from '../components/primitives/CodeBlock';

/** Parse unified diff text into CodeBlock DiffRow[]. */
export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  const lines = diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

  for (const raw of lines) {
    if (
      raw.startsWith('diff --git')
      || raw.startsWith('index ')
      || raw.startsWith('--- ')
      || raw.startsWith('+++ ')
      || raw.startsWith('new file')
      || raw.startsWith('deleted file')
      || raw.startsWith('old mode')
      || raw.startsWith('new mode')
      || raw.startsWith('similarity index')
      || raw.startsWith('rename from')
      || raw.startsWith('rename to')
      || raw.startsWith('Binary files')
      || raw.startsWith('\\ No newline')
    ) {
      continue;
    }

    const hunk = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }

    if (raw.startsWith('+')) {
      rows.push({
        old: null,
        cur: newLine,
        type: 'add',
        pieces: [{ text: raw.slice(1), change: 'add' }],
      });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({
        old: oldLine,
        cur: null,
        type: 'del',
        pieces: [{ text: raw.slice(1), change: 'del' }],
      });
      oldLine += 1;
      continue;
    }
    if (raw.startsWith(' ') || raw === '') {
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      rows.push({
        old: oldLine,
        cur: newLine,
        type: 'ctx',
        pieces: [{ text }],
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  return rows;
}

export function filterReviewFiles<T extends { file: string }>(files: T[], filter: string): T[] {
  const query = filter.trim().toLowerCase();
  if (!query) return files;
  return files.filter((item) => item.file.toLowerCase().includes(query));
}

export function reviewChangesOptions(info: {
  isRepo: boolean;
  branch?: string | null;
  defaultBranch?: string | null;
}): Array<'git' | 'branch' | 'turn'> {
  const options: Array<'git' | 'branch' | 'turn'> = [];
  if (info.isRepo) {
    options.push('git');
    if (info.branch && info.defaultBranch && info.branch !== info.defaultBranch) {
      options.push('branch');
    }
  }
  options.push('turn');
  return options;
}

export function resolveReviewMode(
  requested: string | null | undefined,
  options: Array<'git' | 'branch' | 'turn'>,
): 'git' | 'branch' | 'turn' {
  if (requested === 'git' || requested === 'branch' || requested === 'turn') {
    if (options.includes(requested)) return requested;
  }
  return options[0] || 'turn';
}

export function diffRowsEqual(left: DiffRow[] = [], right: DiffRow[] = []): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.type !== b.type || a.old !== b.old || a.cur !== b.cur) return false;
    if (a.pieces.length !== b.pieces.length) return false;
    for (let pieceIndex = 0; pieceIndex < a.pieces.length; pieceIndex += 1) {
      const pieceA = a.pieces[pieceIndex];
      const pieceB = b.pieces[pieceIndex];
      if (pieceA.text !== pieceB.text || pieceA.change !== pieceB.change) return false;
    }
  }
  return true;
}

export function reviewFilesEqual<T extends {
  file: string;
  additions: number;
  deletions: number;
  patch?: string;
  rows?: DiffRow[];
}>(left: T[], right: T[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return item.file === other.file
      && item.additions === other.additions
      && item.deletions === other.deletions
      && (item.patch || '') === (other.patch || '')
      && diffRowsEqual(item.rows, other.rows);
  });
}
