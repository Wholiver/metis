import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { isShellTool } from '../../lib/tool-diff';
import { TextShimmer } from './TextShimmer';
import { ToolCard, type ToolPart, toolStatus } from './ToolCard';

export function isCommandGroupTool(part: ToolPart): boolean {
  return isShellTool(part.name);
}

function countLabel(count: number, one: string, other: string): string {
  return (count === 1 ? one : other).replace('{count}', String(count));
}

export function CommandToolGroup({
  parts,
  streaming = false,
  busy,
  open: openProp,
  onOpenChange,
}: {
  parts: ToolPart[];
  streaming?: boolean;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const pending = busy !== undefined
    ? busy
    : (streaming || parts.some((part, index) => {
      const status = toolStatus(part, streaming && index === parts.length - 1);
      return status === 'Running' || status === 'Pending';
    }));

  const setOpen = (value: boolean) => {
    if (openProp === undefined) setLocalOpen(value);
    onOpenChange?.(value);
  };

  return (
    <section
      className="context-tool-group tool-collapsible"
      data-component="command-tool-group"
      data-open={open ? 'true' : 'false'}
      data-busy={pending ? 'true' : 'false'}
      data-timeline-part-ids={parts.map((part) => part.id).join(',')}
    >
      <button
        type="button"
        className="context-tool-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <div data-component="context-tool-group-trigger">
          <span data-slot="context-tool-group-title">
            <span data-slot="context-tool-group-label">
              <TextShimmer
                text={pending ? t('runningCommands') : t('ranCommands')}
                active={pending}
              />
            </span>
            <span data-slot="context-tool-group-summary">
              {countLabel(parts.length, t('commandOne'), t('commandOther'))}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            data-slot="collapsible-arrow"
            className={open ? 'open' : ''}
            size={14}
            strokeWidth={1.7}
          />
        </div>
      </button>

      <div className={`context-tool-group-collapse ${open ? 'open' : ''}`} aria-hidden={!open}>
        {open ? (
          <div data-component="command-tool-group-list">
            {parts.map((part, index) => (
              <ToolCard
                key={part.id}
                part={part}
                streaming={streaming && index === parts.length - 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
