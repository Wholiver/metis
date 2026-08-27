import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupAssistantWorkItems } from '../desktop/src/components/chat/AssistantWork';
import { formatToolGroupItem, formatToolGroupSummary } from '../desktop/src/components/chat/ToolGroup';
import { AssistantContentPart } from '../desktop/src/types';

const completed = (id: string, name: string, args: Record<string, unknown> = {}): AssistantContentPart => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
  result: { content: 'ok' },
});

describe('desktop React Tool grouping', () => {
  it('groups only consecutive runs containing more than one Tool call', () => {
    const items: AssistantContentPart[] = [
      { type: 'thinking', id: 'thinking', thinking: 'Inspecting.' },
      completed('read-1', 'read'),
      completed('read-2', 'read'),
      { type: 'text', id: 'evidence', text: 'Found it.' },
      completed('edit-1', 'edit'),
    ];
    const grouped = groupAssistantWorkItems(items);
    expect(grouped.map((item) => item.type)).toEqual(['thinking', 'toolGroup', 'text', 'toolCall']);
    expect(grouped[1]).toMatchObject({ type: 'toolGroup', parts: [{ id: 'read-1' }, { id: 'read-2' }] });
  });

  it('creates compact unique action summaries and contextual row labels', () => {
    const parts = [
      completed('memory', 'query_memory_db'),
      completed('read-1', 'read', { path: '/repo/AssistantWork.tsx' }),
      completed('read-2', 'read', { path: '/repo/ToolCard.tsx' }),
      completed('edit', 'edit', { path: '/repo/ToolGroup.tsx' }),
      completed('exec', 'exec_command', { cmd: 'npm test' }),
    ].filter((part): part is Extract<AssistantContentPart, { type: 'toolCall' }> => part.type === 'toolCall');
    expect(formatToolGroupSummary(parts)).toBe('Queried memory · Read files · Edited files · Ran commands');
    expect(formatToolGroupItem(parts[1], 'Completed')).toBe('Read AssistantWork.tsx');
    expect(formatToolGroupItem(parts[3], 'Completed')).toBe('Edited ToolGroup.tsx');
    expect(formatToolGroupItem(parts[4], 'Completed')).toBe('Ran npm test');
  });

  it('caps expanded height, enables internal scrolling, and follows new rows', () => {
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    const source = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ToolGroup.tsx'), 'utf8');
    expect(css).toMatch(/\.tool-group-list\s*\{[\s\S]*?max-height:\s*168px;[\s\S]*?overflow-y:\s*auto/);
    expect(css).toMatch(/\.tool-group-row\s*\{[\s\S]*?min-height:\s*24px/);
    expect(css).toMatch(/\.tool-header-bar\s*\{[\s\S]*?min-height:\s*24px;[\s\S]*?padding:\s*0;/);
    expect(css).toContain('--work-overflow-fade-height: 24px');
    expect(css).toContain('--work-overflow-fade: linear-gradient');
    expect(css).toContain('--work-overflow-fade-top: linear-gradient');
    expect(css).toMatch(/\.tool-group\.has-overflow \.tool-group-body::after\s*\{[\s\S]*?height:\s*var\(--work-overflow-fade-height\);[\s\S]*?background:\s*var\(--work-overflow-fade\)/);
    expect(css).toMatch(/\.tool-group\.has-overflow\.scrolled-from-top \.tool-group-body::before\s*\{[\s\S]*?background:\s*var\(--work-overflow-fade-top\)/);
    expect(css).not.toMatch(/\.tool-group\.has-overflow \.tool-group-body::after\s*\{[^}]*backdrop-filter/);
    expect(source).toContain('list.scrollTop = list.scrollHeight');
    expect(source).toContain('setHasOverflow(list.scrollHeight > list.clientHeight + 1)');
    expect(source).toContain('setScrolledFromTop(list.scrollTop > 1)');
    expect(source).toContain('data-tool-group-scrolled-from-top');
    expect(source).toContain('onScroll=');
    expect(source).toContain('[expanded, updateKey]');
    expect(source).toContain('data-tool-group-scroll');
    expect(source).not.toContain('<ToolIcon');
    expect(source).not.toContain('<Pencil');
    expect(css).toMatch(/\.tool-group-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, max-content\) 14px/);
    expect(css).toMatch(/\.tool-group-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.tool-group-row-label\s*\{[\s\S]*?color:\s*#737373;[\s\S]*?font-size:\s*var\(--body-copy-size\);[\s\S]*?font-weight:\s*var\(--body-copy-weight\);[\s\S]*?line-height:\s*var\(--body-copy-line-height\)/);
    expect(css).toContain('.tool-diff-stats');
    expect(css).toContain('.tool-diff-added');
    expect(css).toContain('.tool-diff-removed');
  });

  it('computes line additions and deletions for edit and write tools', async () => {
    const { computeToolDiffStats } = await import('../desktop/src/lib/turn-files');
    const editPart = completed('edit-1', 'edit', {
      path: '/repo/README.md',
      edits: [
        { oldText: 'line1\nline2', newText: 'line1_modified\nline2_modified\nline3_new' },
      ],
    }) as Extract<AssistantContentPart, { type: 'toolCall' }>;
    expect(computeToolDiffStats(editPart, 'Completed')).toEqual({ added: 3, removed: 2 });

    const writePart = completed('write-1', 'write', {
      path: '/repo/new.txt',
      content: 'hello\nworld',
    }) as Extract<AssistantContentPart, { type: 'toolCall' }>;
    expect(computeToolDiffStats(writePart, 'Completed')).toEqual({ added: 2, removed: 0 });

    const readPart = completed('read-1', 'read', {
      path: '/repo/README.md',
    }) as Extract<AssistantContentPart, { type: 'toolCall' }>;
    expect(computeToolDiffStats(readPart, 'Completed')).toBeNull();
  });
});

