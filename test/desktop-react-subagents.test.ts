import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssistantWork } from '../desktop/src/components/chat/AssistantWork';
import {
  collectSubagentItems,
  formatSubagentDuration,
  mergeSubagentHistoryItems,
  parseSubagentHistory,
  parseSubagentOutputToParts,
  SUBAGENT_HISTORY_STORAGE_KEY,
} from '../desktop/src/lib/subagents';
import { Message } from '../desktop/src/types';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

describe('desktop React Subagents inspector and real-time work log viewer', () => {
  it('collects and normalizes subagents from session messages', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Please research and implement the changes.',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Launching subagents to handle this.',
        parts: [
          {
            type: 'toolCall',
            id: 'call-spawn-1',
            name: 'spawn_agent',
            arguments: {
              agent: 'planner',
              task: 'Create execution plan',
              context: 'Repository context',
              mode: 'sync',
            },
            result: {
              content: JSON.stringify({
                status: 'success',
                agent: 'planner',
                agentId: 'planner-abc123',
                result: '<thinking>Analyzing requirements</thinking>\n\nHere is the plan:\n1. Step 1\n2. Step 2',
              }),
            },
            progress: {
              jobId: 'abc123',
              state: 'completed',
              durationMs: 4200,
            },
          },
          {
            type: 'toolCall',
            id: 'call-spawn-2',
            name: 'subagent',
            arguments: {
              agent: 'implementer',
              task: 'Implement files',
              mode: 'async',
              worktree: 'auto',
            },
            progress: {
              jobId: 'def456',
              state: 'running',
              durationMs: 1500,
            },
          },
        ],
      },
    ];

    const subagents = collectSubagentItems(messages);
    expect(subagents).toHaveLength(2);

    // Reverse chronological order: newest (second toolCall) first
    expect(subagents[0].id).toBe('call-spawn-2');
    expect(subagents[0].role).toBe('implementer');
    expect(subagents[0].task).toBe('Implement files');
    expect(subagents[0].mode).toBe('async');
    expect(subagents[0].worktree).toBe('auto');
    expect(subagents[0].status).toBe('running');
    expect(subagents[0].durationMs).toBe(1500);

    expect(subagents[1].id).toBe('call-spawn-1');
    expect(subagents[1].role).toBe('planner');
    expect(subagents[1].status).toBe('completed');
    expect(subagents[1].durationMs).toBe(4200);
    expect(subagents[1].parts).toHaveLength(2);
    expect(subagents[1].parts[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Analyzing requirements',
    });
    expect(subagents[1].parts[1]).toMatchObject({
      type: 'text',
      text: 'Here is the plan:\n1. Step 1\n2. Step 2',
    });
  });

  it('formats subagent durations correctly', () => {
    expect(formatSubagentDuration(undefined)).toBe('');
    expect(formatSubagentDuration(500)).toBe('1s');
    expect(formatSubagentDuration(12000)).toBe('12s');
    expect(formatSubagentDuration(65000)).toBe('1m 5s');
    expect(formatSubagentDuration(120000)).toBe('2m');
  });

  it('parses mixed thinking and markdown chunks properly', () => {
    const raw = '<thinking>Investigating codebase</thinking>\nFound 3 matches.\n<thinking>Verifying matches</thinking>\nVerification complete.';
    const parts = parseSubagentOutputToParts('test-agent', raw);

    expect(parts).toHaveLength(4);
    expect(parts[0].type).toBe('thinking');
    expect((parts[0] as any).thinking).toBe('Investigating codebase');
    expect(parts[1].type).toBe('text');
    expect((parts[1] as any).text).toBe('Found 3 matches.');
    expect(parts[2].type).toBe('thinking');
    expect((parts[2] as any).thinking).toBe('Verifying matches');
    expect(parts[3].type).toBe('text');
    expect((parts[3] as any).text).toBe('Verification complete.');
  });

  it('keeps live spawn heartbeats as running and shows progress message', () => {
    const messages: Message[] = [
      {
        id: 'msg-live',
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'toolCall',
            id: 'call-spawn-live',
            name: 'spawn_agent',
            arguments: {
              agent: 'scope-coordinator',
              task: 'Coordinate README work',
              mode: 'sync',
            },
            result: {
              content: JSON.stringify({
                status: 'running',
                agent: 'scope-coordinator',
                agentId: 'scope-coordinator-9d3fc2',
                elapsedSec: 68,
                message: 'scope-coordinator still running (68s)…',
              }, null, 2),
            },
            progress: {
              jobId: '9d3fc2',
              state: 'running',
              durationMs: 68000,
            },
          },
        ],
      },
    ];

    const subagents = collectSubagentItems(messages);
    expect(subagents).toHaveLength(1);
    expect(subagents[0].status).toBe('running');
    expect(subagents[0].durationMs).toBe(68000);
    expect(subagents[0].parts.some((part) => part.type === 'text' && (part as any).text.includes('still running'))).toBe(true);
  });

  it('restores every existing Subagent work item without replaying its reveal animation', () => {
    const renderWorkLog = () => renderToStaticMarkup(React.createElement(AssistantWork, {
      streaming: true,
      durationMs: 68000,
      preserveExistingItems: true,
      items: [
        {
          type: 'toolCall',
          id: 'tool-existing-1',
          name: 'read',
          arguments: { path: 'README.md' },
          progress: { jobId: 'existing-1', state: 'completed' },
        },
        {
          type: 'toolCall',
          id: 'tool-existing-2',
          name: 'bash',
          arguments: { command: 'npm test' },
          progress: { jobId: 'existing-2', state: 'running' },
        },
        {
          type: 'toolCall',
          id: 'tool-existing-3',
          name: 'edit',
          arguments: { path: 'src/index.ts' },
          progress: { jobId: 'existing-3', state: 'completed' },
        },
      ],
    }));
    renderWorkLog();
    const html = renderWorkLog();

    expect(html).toContain('Working for 1m 8s');
    expect(html).toContain('data-part-key="tool-existing-1"');
    expect(html).toContain('data-part-key="tool-existing-2"');
    expect(html).toContain('data-part-key="tool-existing-3"');
    expect(html).not.toContain('cot-work-item-enter');
    expect(html).not.toContain('tool-row-enter');
  });

  it('keeps staged reveal enabled for normal live assistant work', () => {
    const html = renderToStaticMarkup(React.createElement(AssistantWork, {
      streaming: true,
      items: [
        { type: 'toolCall', id: 'chat-tool-1', name: 'read', arguments: {}, progress: { jobId: '1', state: 'completed' } },
        { type: 'toolCall', id: 'chat-tool-2', name: 'bash', arguments: {}, progress: { jobId: '2', state: 'running' } },
      ],
    }));

    expect(html).toContain('data-part-key="chat-tool-1"');
    expect(html).not.toContain('data-part-key="chat-tool-2"');
    expect(html).toContain('cot-work-item-enter');
    expect(html).toContain('tool-row-enter');
  });

  it('keeps richer Subagent history when a restored Server snapshot is sparse', () => {
    const cached = [{
      id: 'call-persisted',
      agentId: 'reviewer-123',
      role: 'reviewer',
      task: 'Review persistence',
      mode: 'sync' as const,
      status: 'running' as const,
      durationMs: 68000,
      rawOutput: 'Detailed live output',
      parts: [
        { type: 'thinking' as const, id: 'thinking-persisted', thinking: 'Inspecting session state' },
        { type: 'text' as const, id: 'text-persisted', text: 'Detailed live output' },
      ],
    }];
    const sparseSnapshot = [{
      id: 'call-persisted',
      agentId: 'reviewer-123',
      role: 'reviewer',
      task: 'Review persistence',
      mode: 'sync' as const,
      status: 'running' as const,
      rawOutput: 'Started',
      parts: [{ type: 'text' as const, id: 'text-started', text: 'Started' }],
    }];

    const restored = mergeSubagentHistoryItems(cached, sparseSnapshot);
    expect(restored).toHaveLength(1);
    expect(restored[0].durationMs).toBe(68000);
    expect(restored[0].rawOutput).toBe('Detailed live output');
    expect(restored[0].parts).toHaveLength(2);

    const completed = mergeSubagentHistoryItems(restored, [{
      ...sparseSnapshot[0],
      status: 'completed',
      durationMs: 71000,
      result: 'Review complete',
      rawOutput: 'Review complete',
      parts: [],
    }]);
    expect(completed[0].status).toBe('completed');
    expect(completed[0].durationMs).toBe(71000);
    expect(completed[0].result).toBe('Review complete');
    expect(completed[0].parts).toHaveLength(2);
  });

  it('parses only valid session-keyed Subagent history from persistent storage', () => {
    const parsed = parseSubagentHistory(JSON.stringify({
      'session-1': [{ id: 'call-1', role: 'planner', task: 'Plan', status: 'completed', parts: [] }],
      invalidSession: [{ role: 'missing-id' }],
      invalidValue: 'not-an-array',
    }));

    expect(parsed).toEqual({
      'session-1': [{ id: 'call-1', role: 'planner', task: 'Plan', status: 'completed', parts: [] }],
    });
  });

  it('migrates persisted raw lifecycle transcripts into structured work items', () => {
    const toolResult = {
      role: 'toolResult',
      toolCallId: 'call-cached-verifier',
      toolName: 'spawn_agent',
      content: [{
        type: 'text',
        text: JSON.stringify({ status: 'error', agent: 'verifier', error: 'Run unavailable.' }),
      }],
      isError: false,
    };
    const rawOutput = [
      JSON.stringify({ type: 'message_start', message: toolResult }),
      JSON.stringify({ type: 'message_end', message: toolResult }),
    ].join('\n');
    const parsed = parseSubagentHistory(JSON.stringify({
      'session-cached': [{
        id: 'call-cached',
        role: 'scope-coordinator',
        task: 'Coordinate work',
        status: 'completed',
        rawOutput,
        result: 'Final summary.',
        parts: [{ type: 'text', id: 'cached-raw', text: rawOutput }],
      }],
    }));

    expect(parsed['session-cached'][0].parts).toHaveLength(1);
    expect(parsed['session-cached'][0].parts[0]).toMatchObject({
      type: 'toolCall',
      id: 'call-cached-verifier',
      result: { isError: true },
      progress: { state: 'failed' },
    });
    expect(parsed['session-cached'][0].parts.some((part) => (
      part.type === 'text' && part.text.includes('message_start')
    ))).toBe(false);
  });

  it('wires session-scoped Subagent history into Desktop persistence', () => {
    const app = source('desktop/src/App.tsx');
    expect(app).toContain('SUBAGENT_HISTORY_STORAGE_KEY');
    expect(app).toContain('parseSubagentHistory');
    expect(app).toContain('mergeSubagentHistoryItems');
    expect(app).toContain(`localStorage.setItem(SUBAGENT_HISTORY_STORAGE_KEY`);
    expect(SUBAGENT_HISTORY_STORAGE_KEY).toBe('metis.desktop.subagentHistory.v1');
  });

  it('applies tool_execution_update partials into spawn_agent tool calls', async () => {
    const { applyToolExecutionUpdate } = await import('../desktop/src/lib/tool-execution-update');
    const messages: Message[] = [
      {
        id: 'msg-partial',
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'toolCall',
            id: 'call-spawn-partial',
            name: 'spawn_agent',
            arguments: { agent: 'reviewer', task: 'Review roadmap', mode: 'sync' },
          },
        ],
      },
    ];

    const updated = applyToolExecutionUpdate(messages, 'call-spawn-partial', {
      content: [{ type: 'text', text: JSON.stringify({ status: 'started', message: 'Spawned reviewer; waiting for progress…' }) }],
    });

    expect(updated[0].parts?.[0]).toMatchObject({
      type: 'toolCall',
      id: 'call-spawn-partial',
      progress: { state: 'running' },
      result: {
        content: expect.stringContaining('Spawned reviewer'),
      },
    });

    const items = collectSubagentItems(updated);
    expect(items[0].status).toBe('running');
    expect(items[0].parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Spawned reviewer') });
  });

  it('wires desktop SSE tool_execution_update into live Work Log updates', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain("type === 'tool_execution_update'");
    expect(hook).toContain('applyToolExecutionUpdate');
    expect(hook).not.toContain("['agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end']");
  });

  it('parses structured toolCalls and thinking parts from JSON payload stream', () => {
    const structuredPayload = {
      status: 'running',
      agent: 'scope-coordinator',
      agentId: 'scope-coordinator-123',
      parts: [
        {
          type: 'thinking',
          id: 'think-1',
          thinking: 'Planning out the roadmap audit',
          durationMs: 3200,
        },
        {
          type: 'toolCall',
          id: 'tool-call-1',
          name: 'read',
          arguments: { path: 'README.md' },
          result: { content: '# My Project\nExisting readme', isError: false },
          progress: { jobId: 'call-1', state: 'completed' },
        },
        {
          type: 'toolCall',
          id: 'tool-call-2',
          name: 'spawn_agent',
          arguments: { agent: 'scoper', task: 'Inspect repository' },
          progress: { jobId: 'call-2', state: 'running' },
        },
        {
          type: 'text',
          id: 'text-1',
          text: 'Audited README.md and dispatched scoper.',
        },
      ],
    };

    const parts = parseSubagentOutputToParts('subagent-1', JSON.stringify(structuredPayload));
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatchObject({
      type: 'thinking',
      id: 'think-1',
      thinking: 'Planning out the roadmap audit',
      durationMs: 3200,
    });
    expect(parts[1]).toMatchObject({
      type: 'toolCall',
      id: 'tool-call-1',
      name: 'read',
      arguments: { path: 'README.md' },
    });
    expect(parts[2]).toMatchObject({
      type: 'toolCall',
      id: 'tool-call-2',
      name: 'spawn_agent',
      arguments: { agent: 'scoper', task: 'Inspect repository' },
      progress: { state: 'running' },
    });
    expect(parts[3]).toMatchObject({
      type: 'text',
      id: 'text-1',
      text: 'Audited README.md and dispatched scoper.',
    });
  });

  it('parses JSON Lines stream and filters session scaffolding properly', () => {
    const jsonLines = [
      '{"type":"session","version":3,"id":"01a031ff-3e97-7dea-98cb-9ae50a7b928b","timestamp":"2026-08-24T04:20:06.424Z","cwd":"/tmp/worktree"}',
      '{"type":"workflow_state","model":{"provider":"openai-codex","id":"gpt-5.6-luna"},"thinkingLevel":"minimal","collaborationMode":"build"}',
      '{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Analyzing repository and existing README.md","durationMs":1400},{"type":"text","text":"I will now inspect the existing files."}]}}',
      '{"type":"tool_execution_start","toolName":"read","args":{"path":"README.md"},"toolCallId":"call-read-1"}',
      '{"type":"tool_execution_end","toolName":"read","result":"# Project Readme","toolCallId":"call-read-1"}',
    ].join('\n');

    const parts = parseSubagentOutputToParts('subagent-jsonl', jsonLines);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Analyzing repository and existing README.md',
      durationMs: 1400,
    });
    expect(parts[1]).toMatchObject({
      type: 'text',
      text: 'I will now inspect the existing files.',
    });
    expect(parts[2]).toMatchObject({
      type: 'toolCall',
      id: 'call-read-1',
      name: 'read',
      arguments: { path: 'README.md' },
      result: { content: '# Project Readme', isError: false },
    });
  });

  it('renders lifecycle tool results once instead of leaking duplicated JSON events into Work Log', () => {
    const failedToolResult = {
      role: 'toolResult',
      toolCallId: 'call-fresh-verifier',
      toolName: 'spawn_agent',
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          agent: 'fresh-verifier',
          error: 'Performance run is unavailable or no longer active.',
        }, null, 2),
      }],
      isError: false,
      timestamp: 1787545379671,
    };
    const finalAssistant = {
      role: 'assistant',
      content: [{ type: 'text', text: 'G2 marked as blocked pending verification.' }],
      timestamp: 1787545380000,
    };
    const jsonLines = [
      JSON.stringify({ type: 'message_start', message: failedToolResult }),
      JSON.stringify({ type: 'message_end', message: failedToolResult }),
      JSON.stringify({ type: 'message_start', message: finalAssistant }),
      JSON.stringify({ type: 'message_end', message: finalAssistant }),
    ].join('\n');

    const parts = parseSubagentOutputToParts('scope-coordinator', jsonLines);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({
      type: 'toolCall',
      id: 'call-fresh-verifier',
      name: 'spawn_agent',
      arguments: { agent: 'fresh-verifier' },
      result: {
        content: expect.stringContaining('Performance run is unavailable'),
        isError: true,
      },
      progress: { state: 'failed' },
    });
    expect(parts[1]).toMatchObject({
      type: 'text',
      text: 'G2 marked as blocked pending verification.',
    });
    expect(parts.filter((part) => part.type === 'text')).toHaveLength(1);
    expect(parts.some((part) => part.type === 'text' && part.text.includes('message_start'))).toBe(false);

    const html = renderToStaticMarkup(React.createElement(AssistantWork, {
      items: parts.filter((part) => part.type === 'toolCall'),
      streaming: false,
      preserveExistingItems: true,
    }));
    expect(html.match(/data-part-key="call-fresh-verifier"/g)).toHaveLength(1);
    expect(html).toContain('data-tool-status="Error"');
    expect(html).toContain('fresh-verifier: Subagent task');
    expect(html).toContain('subagent-tool-status failed">Failed');
    expect(html).not.toContain('message_start');
    expect(html).not.toContain('message_end');
  });

  it('verifies SubagentDetailView uses AssistantWork and WorkProgressIndicator', () => {
    const detailViewSource = source('desktop/src/components/inspector/SubagentDetailView.tsx');
    expect(detailViewSource).toContain("import { AssistantWork } from '../chat/AssistantWork'");
    expect(detailViewSource).toContain("import { WorkProgressIndicator } from '../chat/WorkProgressIndicator'");
    expect(detailViewSource).toContain('<AssistantWork');
    expect(detailViewSource).toContain('preserveExistingItems');
    expect(detailViewSource).toContain('<WorkProgressIndicator');
  });
});
