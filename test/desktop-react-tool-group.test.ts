import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssistantWork, areVisibleAssistantWorkItemsEqual, groupAssistantWorkItems } from '../desktop/src/components/chat/AssistantWork';
import { CommandToolGroup } from '../desktop/src/components/chat/CommandToolGroup';
import { formatToolGroupItem, formatToolGroupSummary } from '../desktop/src/components/chat/ToolGroup';
import { openCodeToolTitle, openCodeToolTitleKey, toolTriggerFields } from '../desktop/src/components/chat/ToolCard';
import { contextToolSummary, contextToolTrigger } from '../desktop/src/components/chat/ContextToolGroup';
import type { AssistantContentPart } from '../desktop/src/types';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

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

  it('groups consecutive grep with read on the same context-tool path', () => {
    const grouped = groupAssistantWorkItems([
      completed('read-1', 'read', { path: '/repo/a.ts' }),
      completed('grep-1', 'grep', { pattern: 'id=', path: '/repo/src' }),
      completed('edit-1', 'edit', { path: '/repo/a.ts' }),
    ]);
    expect(grouped.map((item) => item.type)).toEqual(['contextGroup', 'toolCall']);
    expect(grouped[0]).toMatchObject({
      type: 'contextGroup',
      parts: [{ id: 'read-1' }, { id: 'grep-1' }],
    });
  });

  it('groups consecutive ls with read on the same context-tool path', () => {
    const grouped = groupAssistantWorkItems([
      completed('ls-1', 'ls', { path: '/repo' }),
      completed('read-1', 'read', { path: '/repo/README.md' }),
      completed('bash-1', 'bash', { command: 'ls' }),
    ]);
    expect(grouped.map((item) => item.type)).toEqual(['contextGroup', 'commandGroup']);
    expect(grouped[0]).toMatchObject({
      type: 'contextGroup',
      parts: [{ id: 'ls-1' }, { id: 'read-1' }],
    });
  });

  it('drops empty Gemini text parts from the work area', () => {
    const grouped = groupAssistantWorkItems([
      { type: 'text', id: 'empty', text: '' },
      completed('ls-1', 'ls', { path: '/repo' }),
      { type: 'text', id: 'status', text: '检查工作区文件与任务上下文。' },
    ]);
    expect(grouped.map((item) => item.type)).toEqual(['contextGroup', 'text']);
    expect(grouped[1]).toMatchObject({ id: 'status' });
  });

  it('folds Metis ls/find into the same context group as OpenCode list/glob names', () => {
    const grouped = groupAssistantWorkItems([
      completed('ls-1', 'ls', { path: '/repo/desktop' }),
      completed('find-1', 'find', { pattern: '**/*.tsx', path: '/repo/desktop' }),
      completed('bash-1', 'bash', { command: 'ls desktop' }),
    ]);
    expect(grouped.map((item) => item.type)).toEqual(['contextGroup', 'commandGroup']);
    expect(grouped[0]).toMatchObject({
      type: 'contextGroup',
      parts: [{ id: 'ls-1' }, { id: 'find-1' }],
    });
    expect(contextToolSummary((grouped[0] as { parts: ReturnType<typeof completed>[] }).parts)).toEqual({
      read: 0,
      search: 1,
      list: 1,
    });
    expect(contextToolTrigger(completed('ls-1', 'ls', { path: '/repo/desktop' }), {
      read: 'Read',
      list: 'List',
      glob: 'Glob',
      grep: 'Grep',
      find: 'Find',
    })).toEqual({ title: 'List', subtitle: 'desktop', args: [] });
  });

  it('folds consecutive shell tools into a command group like context lists', () => {
    const grouped = groupAssistantWorkItems([
      completed('bash-1', 'bash', { command: 'ls' }),
      completed('bash-2', 'exec', { command: 'pwd' }),
      completed('edit-1', 'edit', { path: '/repo/a.ts' }),
      completed('bash-3', 'bash', { command: 'git status' }),
    ]);
    expect(grouped.map((item) => item.type)).toEqual(['commandGroup', 'toolCall', 'commandGroup']);
    expect(grouped[0]).toMatchObject({
      type: 'commandGroup',
      parts: [{ id: 'bash-1' }, { id: 'bash-2' }],
    });
    expect(grouped[2]).toMatchObject({
      type: 'commandGroup',
      parts: [{ id: 'bash-3' }],
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

  it('maps grep trigger fields like read, keeping the pattern visible', () => {
    const part = completed('grep', 'grep', { pattern: 'id=', path: '/repo/src', glob: '*.svg' });
    expect(openCodeToolTitleKey('grep')).toBe('toolTitleGrep');
    expect(toolTriggerFields(part, 'Completed')).toMatchObject({
      title: 'Grep',
      subtitle: 'src',
      args: ['pattern=id=', 'glob=*.svg'],
    });
    expect(contextToolTrigger(part, {
      read: 'Read',
      list: 'List',
      glob: 'Glob',
      grep: 'Grep',
    })).toEqual({
      title: 'Grep',
      subtitle: 'src',
      args: ['pattern=id=', 'glob=*.svg'],
    });
  });

  it('clips huge shell commands and skips file-body arguments on collapsed rows', () => {
    const command = `cat <<'EOF' > pelican.svg\n${'path '.repeat(80)}\nEOF`;
    const part = completed('bash-1', 'bash', { command, timeout: 30 });
    const fields = toolTriggerFields(part, 'Completed');
    expect(fields.subtitle).toBeDefined();
    expect(fields.subtitle!.length).toBeLessThanOrEqual(96);
    expect(fields.subtitle).toContain('…');
    expect(fields.subtitle).not.toContain('\n');
    expect(toolTriggerFields(completed('write-1', 'write', {
      path: '/repo/huge.svg',
      content: '<svg>' + 'A'.repeat(5000) + '</svg>',
    }), 'Completed').args?.some((arg) => arg.startsWith('content='))).toBeFalsy();
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
    const commands = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/CommandToolGroup.tsx'), 'utf8');
    expect(turn).toContain('<AssistantWork');
    expect(work).toContain('<ToolCard');
    expect(work).toContain('<ContextToolGroup');
    expect(work).toContain('<CommandToolGroup');
    expect(work).not.toContain('<ToolGroup');
    expect(card).toContain('BasicTool');
    expect(card).toContain('tool-details-body');
    expect(card).toContain('buildToolExpandedView');
    expect(card).toContain('flush');
    expect(card).toContain('variant="Diff"');
    expect(card).not.toContain('Arguments:');
    expect(card).not.toContain('Output:');
    expect(card).toContain('data-scrollable');
    expect(card).toContain('openCodeToolTitleKey');
    expect(card).toContain("t(titleKey)");
    expect(card).toContain('bash-output');
    expect(card).toContain('tool-transcript');
    expect(basic).toContain('data-component="tool-trigger"');
    expect(context).toContain('data-component="context-tool-group-trigger"');
    expect(context).toContain('data-component="context-tool-group-list"');
    expect(context).toContain('useState(false)');
    expect(context).not.toContain('if (pending && !manualRef.current)');
    expect(work).toContain('lastContextGroupLive');
    expect(work).toContain('lastCommandGroupLive');
    expect(work).toContain('isToolCallFinished');
    expect(work).toContain('busy={lastContextGroupLive && item.id === lastContextGroupId}');
    expect(work).toContain('busy={lastCommandGroupLive && item.id === lastCommandGroupId}');
    expect(work).toContain('areVisibleAssistantWorkItemsEqual');
    expect(card).toContain('areToolCardPropsEqual');
    expect(card).toContain('expandedView.truncated');
    expect(context).toContain('areToolPartRefsEqual');
    expect(commands).toContain('areToolPartRefsEqual');
    expect(card).toContain('toolTitlePerformanceAdmit');
    expect(card).toContain('toolTitleBrowserNavigate');
    expect(card).toContain('clipToolTranscript');
    expect(card).toContain('clipToolTriggerText');
    expect(card).toContain('hasDetails={expandable}');
    expect(card).toContain('expanded && expandedView && !hideDetails');
    expect(card).toContain('expanded && expandable ? buildToolExpandedView(part)');
    expect(card).not.toContain("defer={expandedView?.kind === 'bash' || expandedView?.kind === 'diff'}");
    expect(basic).toContain('defer = false');
    expect(basic).toContain('hasDetails = false');
    expect(basic).toContain('mountDetails');
    expect(basic).toContain('data-defer={defer ? \'true\' : undefined}');
    expect(context).toContain("CONTEXT_GROUP_TOOLS = new Set(['read', 'glob', 'grep', 'list', 'ls', 'find'])");
    expect(card).toContain("grep: 'toolTitleGrep'");
    expect(commands).toContain('data-component="command-tool-group"');
    expect(commands).toContain('useState(false)');
    expect(commands).toContain('<ToolCard');
    expect(commands).toContain('isShellTool');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/styles/beautifului/opencode-session.css'), 'utf8');
    expect(css).toContain('[data-component="command-tool-group-list"]');
  });

  it('maps remaining built-in tools onto i18n title keys', () => {
    expect(openCodeToolTitleKey('performance_admit')).toBe('toolTitlePerformanceAdmit');
    expect(openCodeToolTitleKey('browser_navigate')).toBe('toolTitleBrowserNavigate');
    expect(openCodeToolTitleKey('browser_take_screenshot')).toBe('toolTitleBrowserScreenshot');
    expect(openCodeToolTitleKey('browser_snapshot')).toBe('toolTitleBrowserSnapshot');
    expect(openCodeToolTitleKey('find')).toBe('toolTitleFind');
    expect(openCodeToolTitleKey('grep')).toBe('toolTitleGrep');
    expect(openCodeToolTitleKey('ls')).toBe('toolTitleList');
    expect(openCodeToolTitle('performance_admit')).toBe('Performance Admit');
    expect(openCodeToolTitle('browser_navigate')).toBe('Browser Navigate');
  });

  it('renders consecutive shells as a collapsed command group without mounting output', () => {
    const html = renderToStaticMarkup(React.createElement(AssistantWork, {
      items: [
        completed('bash-1', 'bash', { command: 'ls -la' }),
        completed('bash-2', 'bash', { command: 'git status' }),
      ],
    }));
    expect(html).toContain('data-component="command-tool-group"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain('Ran commands');
    expect(html).toContain('2 commands');
    expect(html).not.toContain('data-component="command-tool-group-list"');
    expect(html).not.toContain('bash-output');
    expect(html).not.toContain('ls -la');
  });

  it('expands a command group into collapsed shell rows without mounting transcripts', () => {
    const html = renderToStaticMarkup(React.createElement(CommandToolGroup, {
      parts: [
        completed('bash-1', 'bash', { command: 'ls -la' }),
        completed('bash-2', 'bash', { command: 'git status' }),
      ],
      open: true,
    }));
    expect(html).toContain('data-component="command-tool-group-list"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('ls -la');
    expect(html).toContain('git status');
    expect(html).toContain('data-tool-name="bash"');
    expect(html).not.toContain('bash-output');
  });

  it('ignores streamed thinking tokens when comparing the live tool tree', () => {
    const tools = [
      completed('read-1', 'read', { path: '/repo/a.ts' }),
      completed('edit-1', 'edit', { path: '/repo/a.ts' }),
    ];
    const prev: AssistantContentPart[] = [
      { type: 'thinking', id: 'thought', thinking: 'Inspecting files' },
      ...tools,
    ];
    const nextThought: AssistantContentPart[] = [
      { type: 'thinking', id: 'thought', thinking: 'Inspecting files and tools' },
      ...tools,
    ];
    expect(areVisibleAssistantWorkItemsEqual(prev, nextThought)).toBe(true);
    expect(areVisibleAssistantWorkItemsEqual(prev, [...prev, completed('bash-1', 'bash', { command: 'ls' })])).toBe(false);
  });
});
