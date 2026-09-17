import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatAgentTitle, resolveTaskAgentColor } from '../desktop/src/lib/task-agent';
import {
  collectSubagentItemsFromParts,
  resolveSubagentPath,
  resolveSubagentTrail,
  truncateValidSubagentPath,
  type SubagentItem,
} from '../desktop/src/lib/subagents';
import type { AssistantContentPart } from '../desktop/src/types';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function spawnPart(
  id: string,
  agent: string,
  task: string,
  nestedParts?: AssistantContentPart[],
): Extract<AssistantContentPart, { type: 'toolCall' }> {
  const payload = nestedParts
    ? JSON.stringify({ status: 'success', result: 'done', parts: nestedParts })
    : JSON.stringify({ status: 'success', result: `${agent} finished` });
  return {
    type: 'toolCall',
    id,
    name: 'spawn_agent',
    arguments: { agent, task, mode: 'sync' },
    result: { content: payload },
    progress: { jobId: id.slice(-6), state: 'completed', durationMs: 1000 },
  };
}

describe('desktop OpenCode subagent task chip', () => {
  it('formats agent titles and resolves builtin / hashed colors', () => {
    expect(formatAgentTitle('researcher')).toBe('Researcher');
    expect(formatAgentTitle('')).toBe('Agent');
    expect(resolveTaskAgentColor('build')).toBe('var(--task-agent-build)');
    expect(resolveTaskAgentColor('explore')).toBe('var(--task-agent-explore)');
    expect(resolveTaskAgentColor('writer')).toBe('var(--task-agent-writer)');
    expect(resolveTaskAgentColor('researcher')).toMatch(/^var\(--task-agent-palette-\d\)$/);
    expect(resolveTaskAgentColor('researcher')).toBe(resolveTaskAgentColor('Researcher'));
  });

  it('resolves infinitely nested spawn_agent paths from parent transcripts', () => {
    const grandchild = spawnPart('call-grandchild', 'scribe', 'Write section');
    const child = spawnPart('call-child', 'researcher', 'Research topic', [grandchild]);
    const parent = spawnPart('call-parent', 'coordinator', 'Coordinate work', [child]);

    const roots = collectSubagentItemsFromParts([parent]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.role).toBe('coordinator');

    const trail = resolveSubagentTrail(roots, ['call-parent', 'call-child', 'call-grandchild']);
    expect(trail.map((item) => item.role)).toEqual(['coordinator', 'researcher', 'scribe']);

    const leaf = resolveSubagentPath(roots, ['call-parent', 'call-child', 'call-grandchild']);
    expect(leaf?.task).toBe('Write section');

    expect(truncateValidSubagentPath(roots, ['call-parent', 'missing', 'call-grandchild']))
      .toEqual(['call-parent']);
  });

  it('navigates chip clicks through a nested main-pane stack', () => {
    const app = source('desktop/src/App.tsx');
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const header = source('desktop/src/components/chat/ChatHeader.tsx');
    const conversation = source('desktop/src/components/chat/SubagentConversation.tsx');
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    const lib = source('desktop/src/lib/subagents.ts');

    expect(app).toContain('viewingSubagentStack');
    expect(app).toContain('setViewingSubagentStack');
    expect(app).toContain('handleOpenRootSubagent');
    expect(app).toContain('handleNavigateBreadcrumb');
    expect(app).toContain('resolveSubagentTrail');
    expect(app).not.toContain("dispatchInspectorTabs({ type: 'openSubagentDetail'");

    expect(chatArea).toContain('<SubagentConversation');
    expect(chatArea).toContain('onOpenSubagent={onOpenSubagent}');
    expect(chatArea).toContain('collaborationMode={collaborationMode}');
    expect(chatArea).toContain('model={activeModel}');
    expect(chatArea).toContain('subagentTrail');
    expect(chatArea).toContain('data-back-to-parent');
    expect(header).toContain('data-chat-breadcrumb');
    expect(header).toContain('data-breadcrumb-ancestor');
    expect(header).toContain('data-breadcrumb-current');
    expect(conversation).toContain('onOpenSubagent={onOpenSubagent}');
    expect(conversation).toContain('<UserBubble');
    expect(conversation).toContain('<AssistantTurn');
    expect(conversation).not.toContain('<AssistantWork');

    expect(inspector).not.toContain('SubagentDetailView');
    expect(inspector).toContain('onOpenSubagent?.(item.id)');
    expect(lib).toContain('collectSubagentItemsFromParts');
    expect(lib).toContain('resolveSubagentPath');
  });

  it('renders spawn_agent through TaskToolChip markup and styles', () => {
    const card = source('desktop/src/components/chat/ToolCard.tsx');
    const chip = source('desktop/src/components/chat/TaskToolChip.tsx');
    const icon = source('desktop/src/components/chat/SubagentIcon.tsx');
    const css = source('desktop/src/styles/beautifului/chat.css');
    const work = source('desktop/src/components/chat/AssistantWork.tsx');

    expect(card).toContain('<TaskToolChip');
    expect(card).toContain('onOpenSubagent');
    expect(card).toContain('data-part-key={part.id}');
    expect(card).not.toContain('subagent-tool-status');
    expect(chip).toContain('data-component="task-tool-card"');
    expect(chip).toContain('data-component="task-tool-surface"');
    expect(chip).toContain('data-component="task-tool-title"');
    expect(chip).toContain('data-slot="basic-tool-tool-subtitle"');
    expect(chip).toContain('task-tool-spinner');
    expect(icon).toContain('data-icon="subagent"');
    expect(css).toContain('[data-component="task-tool-surface"]');
    expect(css).toContain('border-radius: 8px');
    expect(css).toContain('--task-agent-build');
    expect(work).toContain('onOpenSubagent={onOpenSubagent}');
  });
});
