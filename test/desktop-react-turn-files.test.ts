import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectTurnFileChanges } from '../desktop/src/lib/turn-files';
import { AssistantContentPart } from '../desktop/src/types';

function toolCall(overrides: Partial<Extract<AssistantContentPart, { type: 'toolCall' }>>): Extract<AssistantContentPart, { type: 'toolCall' }> {
  return {
    type: 'toolCall',
    id: 'tool',
    name: 'edit',
    arguments: {},
    result: { content: 'Done.' },
    ...overrides,
  };
}

describe('Desktop per-turn file changes', () => {
  it('aggregates completed edits and writes by file path', () => {
    const changes = collectTurnFileChanges([
      toolCall({ name: 'write', arguments: { path: 'desktop/main.cjs', content: 'one\ntwo\n' } }),
      toolCall({ arguments: { path: 'desktop/src/Composer.tsx', edits: [{ oldText: 'old', newText: 'first\nsecond' }] } }),
      toolCall({ arguments: { path: 'desktop/src/Composer.tsx', oldText: 'remove\nthis', newText: 'add' } }),
    ]);

    expect(changes).toEqual([
      { path: 'desktop/main.cjs', additions: 2, deletions: 0 },
      { path: 'desktop/src/Composer.tsx', additions: 3, deletions: 3 },
    ]);
  });

  it('omits failed, incomplete, read-only, and no-op calls', () => {
    const changes = collectTurnFileChanges([
      toolCall({ name: 'read', arguments: { path: 'desktop/main.cjs' } }),
      toolCall({ arguments: { path: 'failed.ts', oldText: 'old', newText: 'new' }, result: { content: 'Failed.', isError: true } }),
      toolCall({ arguments: { path: 'pending.ts', oldText: 'old', newText: 'new' }, result: undefined }),
      toolCall({ arguments: { path: 'same.ts', oldText: '', newText: '' } }),
    ]);

    expect(changes).toEqual([]);
  });

  it('keeps user project edits while hiding agent governance and out-of-workspace files', () => {
    const workspacePath = '/Users/huchenrui/测试文件夹';
    const changes = collectTurnFileChanges([
      toolCall({ name: 'write', arguments: { path: 'ROADMAP.md', content: 'internal roadmap\n' } }),
      toolCall({ name: 'write', arguments: { path: 'GATELOG.md', content: 'internal log\n' } }),
      toolCall({ name: 'write', arguments: { path: '/Users/huchenrui/.metis/agent/performance-runs/run-1/artifacts/g2-scope-receipt.md', content: 'internal receipt\n' } }),
      toolCall({ name: 'write', arguments: { path: '/Users/huchenrui/Documents/metis_v2/agent-debug.md', content: 'outside project\n' } }),
      toolCall({ name: 'write', arguments: { path: '.metis-agent-task-123.txt', content: 'internal task\n' } }),
      toolCall({ arguments: { path: `${workspacePath}/README.md`, oldText: 'old', newText: 'new' } }),
      toolCall({ name: 'write', arguments: { path: 'src/index.ts', content: 'export const ready = true;\n' } }),
    ], { workspacePath });

    expect(changes).toEqual([
      { path: `${workspacePath}/README.md`, additions: 1, deletions: 1 },
      { path: 'src/index.ts', additions: 1, deletions: 0 },
    ]);
  });

  it('uses a compact expandable summary without review controls or row dividers', () => {
    const source = readFileSync(new URL('../desktop/src/components/chat/TurnFilesSummary.tsx', import.meta.url), 'utf8');

    expect(source).toContain("files.slice(0, 3)");
    expect(source).toContain('已编辑 {files.length} 个文件');
    expect(source).toContain('再显示 ${hiddenCount} 个文件');
    expect(source).toContain('rounded-[10px]');
    expect(source).not.toContain('shadow-[');
    expect(source).not.toMatch(/撤销|审核|border-b|divide-y/);
  });
});

