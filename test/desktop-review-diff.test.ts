import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  filterReviewFiles,
  parseUnifiedDiff,
  resolveReviewMode,
  reviewChangesOptions,
} from '../desktop/src/lib/review-diff';
import { collectTurnFileDiffs } from '../desktop/src/lib/tool-diff';
import type { AssistantContentPart } from '../desktop/src/types';

const tool = (
  id: string,
  name: string,
  args: Record<string, unknown>,
): Extract<AssistantContentPart, { type: 'toolCall' }> => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
  result: { content: 'ok' },
});

describe('desktop review-diff helpers', () => {
  it('parses unified diffs into CodeBlock rows', () => {
    const rows = parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 context
-old
+new
+extra
`);
    expect(rows).toEqual([
      { old: 1, cur: 1, type: 'ctx', pieces: [{ text: 'context' }] },
      { old: 2, cur: null, type: 'del', pieces: [{ text: 'old', change: 'del' }] },
      { old: null, cur: 2, type: 'add', pieces: [{ text: 'new', change: 'add' }] },
      { old: null, cur: 3, type: 'add', pieces: [{ text: 'extra', change: 'add' }] },
    ]);
  });

  it('filters review files by substring', () => {
    const files = [{ file: 'src/App.tsx' }, { file: 'desktop/main.cjs' }];
    expect(filterReviewFiles(files, 'app')).toEqual([{ file: 'src/App.tsx' }]);
    expect(filterReviewFiles(files, '')).toEqual(files);
  });

  it('builds OpenCode-compatible review mode options', () => {
    expect(reviewChangesOptions({ isRepo: false })).toEqual(['turn']);
    expect(reviewChangesOptions({ isRepo: true, branch: 'main', defaultBranch: 'main' })).toEqual(['git', 'turn']);
    expect(reviewChangesOptions({ isRepo: true, branch: 'feat', defaultBranch: 'main' })).toEqual(['git', 'branch', 'turn']);
  });

  it('corrects invalid review modes to the first available option', () => {
    expect(resolveReviewMode('branch', ['git', 'turn'])).toBe('git');
    expect(resolveReviewMode('turn', ['git', 'turn'])).toBe('turn');
    expect(resolveReviewMode(undefined, ['turn'])).toBe('turn');
  });

  it('aggregates turn write/edit diffs and replaces prior rows on later write', () => {
    const parts: AssistantContentPart[] = [
      tool('w1', 'write', { path: 'README.md', content: 'one\ntwo\n' }),
      tool('e1', 'edit', {
        path: '/repo/src/App.tsx',
        oldText: 'old\n',
        newText: 'new\n',
      }),
      tool('e2', 'edit', {
        path: 'src/App.tsx',
        oldText: 'new\n',
        newText: 'newer\n',
      }),
      tool('w2', 'write', { path: 'README.md', content: 'fresh\n' }),
      {
        type: 'toolCall',
        id: 'failed',
        name: 'edit',
        arguments: { path: 'broken.ts', oldText: 'a', newText: 'b' },
        result: { content: 'nope', isError: true },
      },
    ];

    const diffs = collectTurnFileDiffs(parts, { workspacePath: '/repo' });
    expect(diffs.map((item) => item.path)).toEqual(['README.md', 'src/App.tsx']);
    expect(diffs[0].rows).toEqual([
      { old: null, cur: 1, type: 'add', pieces: [{ text: 'fresh', change: 'add' }] },
    ]);
    expect(diffs[1].additions).toBe(2);
    expect(diffs[1].deletions).toBe(2);
    expect(diffs[1].rows.map((row) => row.type)).toEqual(['del', 'add', 'del', 'add']);
  });

  it('wires Review turn mode to tool diffs instead of workspace.diff', () => {
    const hook = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useWorkspaceReview.ts'), 'utf8');
    expect(hook).toContain('collectTurnFileDiffs');
    expect(hook).toContain("resolvedMode === 'turn'");
    expect(hook).toContain('turnDiffs.find');
    expect(hook).not.toContain('if (info.isRepo && workspace?.diff)');
  });
});
