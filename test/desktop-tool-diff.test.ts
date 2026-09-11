import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildToolFileDiff,
  collectTurnFileDiffs,
  isFileMutationTool,
} from '../desktop/src/lib/tool-diff';
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

describe('desktop tool file diff rendering', () => {
  it('builds add-only rows for write tools', () => {
    expect(isFileMutationTool('write')).toBe(true);
    const diff = buildToolFileDiff(tool('w1', 'write', {
      path: 'docs/README.md',
      content: '<p>Hello</p>\n<img src="x.png" />\n',
    }));
    expect(diff?.filename).toBe('README.md');
    expect(diff?.rows).toHaveLength(2);
    expect(diff?.rows.every((row) => row.type === 'add')).toBe(true);
    expect(diff?.rows[0]).toMatchObject({ cur: 1, pieces: [{ text: '<p>Hello</p>', change: 'add' }] });
  });

  it('builds delete/add rows for edit replacements', () => {
    const diff = buildToolFileDiff(tool('e1', 'edit', {
      path: 'src/App.tsx',
      oldText: 'const a = 1;\n',
      newText: 'const a = 2;\nconst b = 3;\n',
    }));
    expect(diff?.rows.map((row) => row.type)).toEqual(['del', 'add', 'add']);
    expect(diff?.rows[0].pieces[0]).toEqual({ text: 'const a = 1;', change: 'del' });
    expect(diff?.rows[1].pieces[0]).toEqual({ text: 'const a = 2;', change: 'add' });
  });

  it('parses unified patch arguments when present', () => {
    const diff = buildToolFileDiff(tool('e2', 'edit', {
      path: 'a.ts',
      patch: [
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-old',
        '+new',
      ].join('\n'),
    }));
    expect(diff?.rows.map((row) => row.type)).toEqual(['ctx', 'del', 'add']);
  });

  it('collects turn diffs without fabricating empty-patch source', () => {
    const emptyEdit = tool('e0', 'edit', { path: 'noop.ts' });
    expect(collectTurnFileDiffs([emptyEdit])).toEqual([]);
    expect(buildToolFileDiff(emptyEdit)).toBeNull();
  });

  it('renders ToolCard write/edit bodies as flush diffs without card chrome', () => {
    const card = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ToolCard.tsx'), 'utf8');
    const code = readFileSync(resolve(process.cwd(), 'desktop/src/components/primitives/CodeBlock.tsx'), 'utf8');
    const markdown = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/MarkdownContent.tsx'), 'utf8');
    const session = readFileSync(resolve(process.cwd(), 'desktop/src/styles/beautifului/opencode-session.css'), 'utf8');

    expect(card).toContain('data-tool-kind={fileDiff ? \'file-diff\' : undefined}');
    expect(card).toContain('tool-details-flush');
    expect(card).toContain('flush');
    expect(code).toContain('flush = false');
    expect(code).toContain('data-flush');
    expect(code).toContain('rounded-card bg-surface shadow-card');
    expect(markdown).toContain('flush');
    expect(session).toContain('.tool-card .tool-details-body.tool-details-flush');
    expect(session).toContain('[data-code-block][data-flush]');
  });
});
