import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupAssistantWorkItems } from '../desktop/src/components/chat/AssistantWork';
import { formatToolGroupItem, formatToolGroupSummary } from '../desktop/src/components/chat/ToolGroup';
import { toolTriggerFields } from '../desktop/src/components/chat/ToolCard';
import { contextToolSummary, contextToolTrigger } from '../desktop/src/components/chat/ContextToolGroup';
import type { AssistantContentPart } from '../desktop/src/types';

const completed = (id: string, name: string, args: Record<string, unknown> = {}): Extract<AssistantContentPart, { type: 'toolCall' }> => ({
  type: 'toolCall', id, name, arguments: args, result: { content: 'ok' },
});

describe('desktop React Tool rendering', () => {
  it('groups only consecutive OpenCode context tools', () => {
    const items: AssistantContentPart[] = [
      { type: 'thinking', id: 'thinking', thinking: 'Inspecting.' },
      completed('read-1', 'read'), completed('read-2', 'read'),
      { type: 'text', id: 'text', text: 'Done.' }, completed('edit-1', 'edit'),
    ];
    const grouped = groupAssistantWorkItems(items);
    expect(grouped.map((item) => item.type)).toEqual(['contextGroup', 'text', 'toolCall']);
    expect(grouped[0]).toMatchObject({
      type: 'contextGroup',
      parts: [{ id: 'read-1' }, { id: 'read-2' }],
    });
  });

  it('builds contextual action summaries for legacy helpers', () => {
    const parts = [completed('read', 'read', { path: '/repo/a.ts' }), completed('edit', 'edit', { path: '/repo/b.ts' })];
    expect(formatToolGroupSummary(parts)).toBe('Read files · Edited files');
    expect(formatToolGroupItem(parts[0], 'Completed')).toBe('Read a.ts');
  });

  it('maps tool arguments into BasicTool trigger fields', () => {
    const part = completed('read', 'read', { path: '/repo/AssistantWork.tsx', offset: 12 });
    expect(toolTriggerFields(part, 'Completed')).toMatchObject({
      title: 'Read',
      subtitle: 'AssistantWork.tsx',
      args: ['offset=12'],
    });
  });

  it('formats OpenCode context group counts and rows', () => {
    const parts = [
      completed('read', 'read', { filePath: '/repo/README.md' }),
      completed('glob', 'glob', { pattern: '**/README*' }),
    ];
    expect(contextToolSummary(parts)).toEqual({ read: 1, search: 1, list: 0 });
    expect(contextToolTrigger(parts[0], {
      read: 'Read',
      list: 'List',
      glob: 'Glob',
      grep: 'Grep',
    })).toEqual({ title: 'Read', subtitle: 'README.md', args: [] });
    expect(contextToolTrigger(parts[1], {
      read: 'Read',
      list: 'List',
      glob: 'Glob',
      grep: 'Grep',
    })).toEqual({ title: 'Glob', subtitle: '/', args: ['pattern=**/README*'] });
  });

  it('wires context tools through ContextToolGroup and other tools through BasicTool', () => {
    const turn = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantTurn.tsx'), 'utf8');
    const work = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantWork.tsx'), 'utf8');
    const card = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ToolCard.tsx'), 'utf8');
    const basic = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/BasicTool.tsx'), 'utf8');
    const context = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ContextToolGroup.tsx'), 'utf8');
    expect(turn).toContain('<AssistantWork');
    expect(work).toContain('<ToolCard');
    expect(work).toContain('<ContextToolGroup');
    expect(work).not.toContain('<ToolGroup');
    expect(card).toContain('BasicTool');
    expect(card).toContain('tool-details-body');
    expect(card).toContain('buildToolFileDiff');
    expect(card).toContain('flush');
    expect(card).toContain('variant="Diff"');
    expect(card).toContain('Arguments:');
    expect(card).toContain('Output:');
    expect(card).toContain('data-scrollable');
    expect(basic).toContain('data-component="tool-trigger"');
    expect(context).toContain('data-component="context-tool-group-trigger"');
    expect(context).toContain('data-component="context-tool-group-list"');
    expect(context).toContain('useState(false)');
    expect(context).not.toContain('if (pending && !manualRef.current)');
    expect(work).toContain('busy={streaming && item.id === lastContextGroupId}');
  });
});
