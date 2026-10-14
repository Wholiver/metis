import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatAgentTitle, resolveTaskAgentColor } from '../desktop/src/lib/task-agent';
import {
  collectSubagentItemsFromParts,
  decideSubagentFollow,
  listRunningSubagents,
  pickNextRunningSubagent,
  resolveSubagentPath,
  resolveSubagentTrail,
  truncateValidSubagentPath,
  type SubagentItem,
} from '../desktop/src/lib/subagents';
import type { AssistantContentPart } from '../desktop/src/types';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function runningPart(
  id: string,
  agent: string,
  task: string,
  startedAt: number,
  nestedParts?: AssistantContentPart[],
): Extract<AssistantContentPart, { type: 'toolCall' }> {
  const part = spawnPart(id, agent, task, nestedParts);
  part.progress = { jobId: id.slice(-6), state: 'running', startedAt };
  return part;
}

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

  it('follows the newest running subagent, then the next, then closes', () => {
    const child = runningPart('call-child', 'scribe', 'Write section', 20);
    const runningParent: SubagentItem = {
      id: 'call-parent',
      role: 'researcher',
      task: 'Research topic',
      status: 'running',
      startedAt: 10,
      parts: [child],
    };
    const roots = [runningParent];

    expect(listRunningSubagents(roots).map((item) => item.id)).toEqual(['call-child', 'call-parent']);

    const opened = decideSubagentFollow(roots, { seenIds: new Set(), followLive: false, focusedId: null });
    expect(opened).toMatchObject({ type: 'open', id: 'call-child' });

    const steady = decideSubagentFollow(roots, {
      seenIds: new Set(opened.seenIds),
      followLive: true,
      focusedId: 'call-child',
    });
    expect(steady.type).toBe('idle');

    const parentOnly: SubagentItem[] = [{
      id: 'call-parent',
      role: 'researcher',
      task: 'Research topic',
      status: 'running',
      startedAt: 10,
      parts: [],
    }];
    expect(pickNextRunningSubagent(roots, 'call-child')?.id).toBe('call-parent');
    const switched = decideSubagentFollow(parentOnly, {
      seenIds: new Set(['call-child', 'call-parent']),
      followLive: true,
      focusedId: 'call-child',
    });
    expect(switched).toMatchObject({ type: 'open', id: 'call-parent' });

    const finished: SubagentItem[] = [{
      id: 'call-parent',
      role: 'researcher',
      task: 'Research topic',
      status: 'completed',
      startedAt: 10,
      parts: [],
    }];
    const closed = decideSubagentFollow(finished, {
      seenIds: new Set(switched.seenIds),
      followLive: true,
      focusedId: 'call-parent',
    });
    expect(closed.type).toBe('close');

    const historical = decideSubagentFollow(finished, {
      seenIds: new Set(closed.seenIds),
      followLive: false,
      focusedId: 'call-parent',
    });
    expect(historical.type).toBe('idle');
  });

  it('opens subagent work in the inspector instead of replacing the main chat', () => {
    const app = source('desktop/src/App.tsx');
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const conversation = source('desktop/src/components/chat/SubagentConversation.tsx');
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    const detail = source('desktop/src/components/inspector/SubagentDetailView.tsx');
    const lib = source('desktop/src/lib/subagents.ts');

    expect(app).toContain('decideSubagentFollow');
    expect(app).toContain("dispatchInspectorTabs({ type: 'openSubagentDetail', selectedSubagentId: id })");
    expect(app).toContain('restoreTabId');
    expect(app).toContain('autoCreatedTab');
    expect(app).toContain('skipSubagentFollow');
    expect(app).not.toContain('viewingSubagentStack');

    expect(chatArea).not.toContain('<SubagentConversation');
    expect(chatArea).not.toContain('data-back-to-parent');
    expect(chatArea).toContain('onOpenSubagent={onOpenSubagent}');

    expect(conversation).toContain('onOpenSubagent={onOpenSubagent}');
    expect(conversation).toContain('<UserBubble');
    expect(conversation).toContain('<AssistantTurn');
    expect(conversation).not.toContain('<AssistantWork');

    expect(inspector).toContain('SubagentDetailView');
    expect(inspector).toContain('findSubagentById');
    expect(inspector).toContain('onOpenSubagent?.(item.id)');
    expect(detail).toContain('data-subagent-stop-button');
    expect(detail).toContain('<SubagentConversation');
    expect(detail).toContain('fullWidth');
    expect(conversation).toContain("fullWidth ? '' : 'max-w-[620px]'");
    expect(lib).toContain('decideSubagentFollow');
    expect(lib).toContain('pickNextRunningSubagent');
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
    expect(chip).toContain('task-tool-icon');
    expect(chip).toContain('SubagentIcon');
    expect(icon).toContain('data-icon="subagent"');
    expect(css).toContain('[data-component="task-tool-surface"]');
    expect(css).toContain('border-radius: 8px');
    expect(css).toContain('--task-agent-build');
    expect(work).toContain('onOpenSubagent={onOpenSubagent}');
  });
});
