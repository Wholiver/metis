import React from 'react';
import { formatAgentTitle, resolveTaskAgentColor } from '../../lib/task-agent';
import { SubagentIcon } from './SubagentIcon';

export interface TaskToolChipProps {
  agent?: string;
  task?: string;
  running?: boolean;
  onOpen?: () => void;
}

/** OpenCode new-layout `task-tool-card` pill: colored square icon + bold name + task. */
export function TaskToolChip({ agent, task, running = false, onOpen }: TaskToolChipProps) {
  const title = formatAgentTitle(agent);
  const subtitle = String(task || '').trim();
  const color = resolveTaskAgentColor(agent);
  const clickable = typeof onOpen === 'function';

  const body = (
    <div
      data-component="task-tool-card"
      style={{ ['--task-agent-color' as string]: color }}
    >
      <div data-component="task-tool-surface">
        <div data-slot="basic-tool-tool-info-main">
          {running ? (
            <span data-component="task-tool-spinner" aria-hidden="true">
              <span data-component="task-tool-spinner-dot" />
            </span>
          ) : (
            <span data-component="task-tool-icon">
              <SubagentIcon size={16} />
            </span>
          )}
          <span data-component="task-tool-title">{title}</span>
          {subtitle ? (
            <span data-slot="basic-tool-tool-subtitle">{subtitle}</span>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!clickable) return body;

  return (
    <button
      type="button"
      className="task-tool-chip-button"
      data-component="task-tool-chip-button"
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {body}
    </button>
  );
}
