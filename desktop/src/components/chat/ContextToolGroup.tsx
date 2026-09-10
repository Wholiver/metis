import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { TextShimmer } from './TextShimmer';
import { type ToolPart, toolStatus } from './ToolCard';

const CONTEXT_GROUP_TOOLS = new Set(['read', 'glob', 'grep', 'list']);

export function isContextGroupTool(part: ToolPart): boolean {
  return CONTEXT_GROUP_TOOLS.has(part.name.toLowerCase());
}

export type ContextToolSummary = {
  read: number;
  search: number;
  list: number;
};

export function contextToolSummary(parts: ToolPart[]): ContextToolSummary {
  return {
    read: parts.filter((part) => part.name.toLowerCase() === 'read').length,
    search: parts.filter((part) => /^(glob|grep)$/.test(part.name.toLowerCase())).length,
    list: parts.filter((part) => part.name.toLowerCase() === 'list').length,
  };
}

function inputRecord(part: ToolPart): Record<string, unknown> {
  return part.arguments && typeof part.arguments === 'object'
    ? part.arguments as Record<string, unknown>
    : {};
}

function basename(value: unknown): string {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function directoryLabel(value: unknown): string {
  const path = String(value || '').trim();
  if (!path) return '/';
  return path === '/' ? path : basename(path);
}

export type ContextToolTrigger = {
  title: string;
  subtitle: string;
  args: string[];
};

export function contextToolTrigger(part: ToolPart, labels: {
  read: string;
  list: string;
  glob: string;
  grep: string;
}): ContextToolTrigger {
  const input = inputRecord(part);
  const name = part.name.toLowerCase();
  const path = input.path ?? input.directory ?? '/';
  const filePath = input.filePath ?? input.file_path ?? input.path;
  const pattern = typeof input.pattern === 'string' ? input.pattern : undefined;
  const include = typeof input.include === 'string' ? input.include : undefined;
  const offset = typeof input.offset === 'number' ? input.offset : undefined;
  const limit = typeof input.limit === 'number' ? input.limit : undefined;

  if (name === 'read') {
    const args: string[] = [];
    if (offset !== undefined) args.push(`offset=${offset}`);
    if (limit !== undefined) args.push(`limit=${limit}`);
    return { title: labels.read, subtitle: basename(filePath), args };
  }
  if (name === 'list') {
    return { title: labels.list, subtitle: directoryLabel(path), args: [] };
  }
  if (name === 'glob') {
    return {
      title: labels.glob,
      subtitle: directoryLabel(path),
      args: pattern ? [`pattern=${pattern}`] : [],
    };
  }
  return {
    title: labels.grep,
    subtitle: directoryLabel(path),
    args: [
      ...(pattern ? [`pattern=${pattern}`] : []),
      ...(include ? [`include=${include}`] : []),
    ],
  };
}

function countLabel(
  count: number,
  one: string,
  other: string,
): string {
  return (count === 1 ? one : other).replace('{count}', String(count));
}

export function ContextToolGroup({
  parts,
  streaming = false,
  busy,
  open: openProp,
  onOpenChange,
}: {
  parts: ToolPart[];
  streaming?: boolean;
  /** OpenCode `busy`: drives Exploring shimmer, not open state. */
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  // OpenCode ContextToolGroup: localOpen starts false; open is user-controlled only.
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const pending = busy !== undefined
    ? busy
    : (streaming || parts.some((part, index) => {
      const status = toolStatus(part, streaming && index === parts.length - 1);
      return status === 'Running' || status === 'Pending';
    }));
  const summary = useMemo(() => contextToolSummary(parts), [parts]);
  const counts = [
    summary.read > 0
      ? countLabel(summary.read, t('contextReadOne'), t('contextReadOther'))
      : '',
    summary.search > 0
      ? countLabel(summary.search, t('contextSearchOne'), t('contextSearchOther'))
      : '',
    summary.list > 0
      ? countLabel(summary.list, t('contextListOne'), t('contextListOther'))
      : '',
  ].filter(Boolean);
  const labels = {
    read: t('agentRead'),
    list: t('contextListTool'),
    glob: 'Glob',
    grep: 'Grep',
  };

  const setOpen = (value: boolean) => {
    if (openProp === undefined) setLocalOpen(value);
    onOpenChange?.(value);
  };

  return (
    <section
      className="context-tool-group tool-collapsible"
      data-component="context-tool-group"
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
                text={pending ? t('contextExploring') : t('contextExplored')}
                active={pending}
              />
            </span>
            <span data-slot="context-tool-group-summary">
              {counts.join(', ')}
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
        <div data-component="context-tool-group-list">
          {parts.map((part, index) => {
            const trigger = contextToolTrigger(part, labels);
            const status = toolStatus(part, streaming && index === parts.length - 1);
            const running = status === 'Running' || status === 'Pending';
            return (
              <div
                key={part.id}
                data-slot="context-tool-group-item"
                data-part-key={part.id}
                data-part-type="toolCall"
                data-tool-name={part.name}
                data-tool-status={status}
              >
                <div data-component="tool-trigger">
                  <div data-slot="basic-tool-tool-trigger-content">
                    <div data-slot="basic-tool-tool-info">
                      <div data-slot="basic-tool-tool-info-structured">
                        <div data-slot="basic-tool-tool-info-main">
                          <span data-slot="basic-tool-tool-title">
                            <TextShimmer text={trigger.title} active={running} />
                          </span>
                          {trigger.subtitle && (
                            <span data-slot="basic-tool-tool-subtitle">{trigger.subtitle}</span>
                          )}
                          {trigger.args.map((arg) => (
                            <span key={arg} data-slot="basic-tool-tool-arg">{arg}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
