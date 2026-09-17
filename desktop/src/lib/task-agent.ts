/** OpenCode-aligned agent title + color resolution for task/subagent chips. */

const BUILTIN_AGENT_TONES: Record<string, string> = {
  build: 'var(--task-agent-build)',
  explore: 'var(--task-agent-explore)',
  plan: 'var(--task-agent-plan)',
  review: 'var(--task-agent-review)',
  writer: 'var(--task-agent-writer)',
};

const AGENT_PALETTE = [
  'var(--task-agent-palette-0)',
  'var(--task-agent-palette-1)',
  'var(--task-agent-palette-2)',
  'var(--task-agent-palette-3)',
  'var(--task-agent-palette-4)',
  'var(--task-agent-palette-5)',
  'var(--task-agent-palette-6)',
  'var(--task-agent-palette-7)',
] as const;

export function formatAgentTitle(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Agent';
  const name = raw.trim();
  return `${name[0]!.toUpperCase()}${name.slice(1)}`;
}

function hashTone(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return AGENT_PALETTE[hash % AGENT_PALETTE.length]!;
}

/** Resolve CSS color for the nested-square subagent icon. */
export function resolveTaskAgentColor(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'var(--task-agent-palette-0)';
  const key = raw.trim().toLowerCase();
  return BUILTIN_AGENT_TONES[key] ?? hashTone(key);
}
