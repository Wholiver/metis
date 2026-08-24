import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  formatToolDisplayName,
  ToolPart,
  ToolStatus,
  toolStatus,
} from './ToolCard';
import { computeToolDiffStats } from '../../lib/turn-files';

interface ToolGroupProps {
  parts: ToolPart[];
  streaming?: boolean;
  preserveExistingItems?: boolean;
}

function toolKind(name: string): 'memory' | 'read' | 'edit' | 'command' | 'search' | 'agent' | 'other' {
  const normalized = name.toLowerCase();
  if (/memory/.test(normalized)) return 'memory';
  if (normalized === 'read_plan' || normalized === 'read' || /read_file|view_file|read_resource/.test(normalized)) return 'read';
  if (normalized === 'write' || normalized === 'edit' || /write_to_file|replace_file|edit_file|apply_patch/.test(normalized)) return 'edit';
  if (normalized === 'bash' || normalized === 'exec' || /run_command|exec_command/.test(normalized)) return 'command';
  if (/search|find|grep/.test(normalized)) return 'search';
  if (/agent|subagent/.test(normalized)) return 'agent';
  return 'other';
}

function groupPhrase(kind: ReturnType<typeof toolKind>, active: boolean): string {
  if (kind === 'memory') return active ? 'Querying memory' : 'Queried memory';
  if (kind === 'read') return active ? 'Reading files' : 'Read files';
  if (kind === 'edit') return active ? 'Editing files' : 'Edited files';
  if (kind === 'command') return active ? 'Running commands' : 'Ran commands';
  if (kind === 'search') return active ? 'Searching code' : 'Searched code';
  if (kind === 'agent') return active ? 'Coordinating agents' : 'Coordinated agents';
  return active ? 'Using tools' : 'Used tools';
}

export function formatToolGroupSummary(parts: ToolPart[], streaming = false): string {
  const phrases: string[] = [];
  const seen = new Set<string>();
  parts.forEach((part, index) => {
    const kind = toolKind(part.name);
    if (seen.has(kind)) return;
    seen.add(kind);
    const status = toolStatus(part, streaming && index === parts.length - 1);
    phrases.push(groupPhrase(kind, status === 'Running' || status === 'Pending'));
  });
  return phrases.join(' · ') || 'Used tools';
}

function argumentRecord(part: ToolPart): Record<string, unknown> {
  return part.arguments && typeof part.arguments === 'object'
    ? part.arguments as Record<string, unknown>
    : {};
}

function fileName(value: unknown): string {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

export function formatToolGroupItem(part: ToolPart, status: ToolStatus): string {
  const args = argumentRecord(part);
  const kind = toolKind(part.name);
  const failed = status === 'Error' || status === 'Denied';
  if (failed) return formatToolDisplayName(part.name, status, part.arguments);

  if (kind === 'command') {
    const command = args.command ?? args.cmd;
    if (command) return `${status === 'Running' || status === 'Pending' ? 'Running' : 'Ran'} ${String(command)}`;
  }
  if (kind === 'read' || kind === 'edit') {
    const target = fileName(args.path ?? args.file_path ?? args.filePath ?? args.target);
    if (target) {
      const verb = kind === 'read'
        ? status === 'Running' || status === 'Pending' ? 'Reading' : 'Read'
        : status === 'Running' || status === 'Pending' ? 'Editing' : 'Edited';
      return `${verb} ${target}`;
    }
  }
  return formatToolDisplayName(part.name, status, part.arguments);
}

export const ToolGroup: React.FC<ToolGroupProps> = ({ parts, streaming = false, preserveExistingItems = false }) => {
  const contentId = useId();
  const [expanded, setExpanded] = useState(streaming);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const wasStreaming = useRef(streaming);
  const userOverrideRef = useRef(false);
  const updateKey = useMemo(() => parts.map((part) => [
    part.id,
    part.progress?.state || '',
    part.result?.timestamp || '',
    part.result?.content.length || 0,
  ].join(':')).join('|'), [parts]);

  useEffect(() => {
    if (!userOverrideRef.current) {
      if (streaming) setExpanded(true);
      else if (wasStreaming.current) setExpanded(false);
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  useLayoutEffect(() => {
    if (!expanded || !listRef.current) return;
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) {
        list.scrollTop = list.scrollHeight;
        setHasOverflow(list.scrollHeight > list.clientHeight + 1);
        setScrolledFromTop(list.scrollTop > 1);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, updateKey]);

  const [revealedPartCount, setRevealedPartCount] = useState(() => (
    streaming && !preserveExistingItems ? Math.min(1, parts.length) : parts.length
  ));

  useEffect(() => {
    if (!streaming || preserveExistingItems) {
      setRevealedPartCount(parts.length);
      return;
    }
    if (revealedPartCount < parts.length) {
      const timer = window.setTimeout(() => {
        setRevealedPartCount((prev) => Math.min(prev + 1, parts.length));
      }, 80);
      return () => window.clearTimeout(timer);
    }
  }, [preserveExistingItems, streaming, parts.length, revealedPartCount]);

  const visibleParts = streaming ? parts.slice(0, revealedPartCount) : parts;

  return (
    <section
      className={`tool-group ${expanded ? '' : 'collapsed'} ${hasOverflow ? 'has-overflow' : ''} ${scrolledFromTop ? 'scrolled-from-top' : ''}`}
      data-tool-group=""
      data-tool-count={parts.length}
      data-tool-group-overflow={hasOverflow ? 'true' : 'false'}
      data-tool-group-scrolled-from-top={scrolledFromTop ? 'true' : 'false'}
    >
      <button
        type="button"
        className="tool-group-header"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => {
          userOverrideRef.current = true;
          setExpanded((value) => !value);
        }}
      >
        <span className="tool-group-summary">{formatToolGroupSummary(parts, streaming)}</span>
        <ChevronRight aria-hidden="true" className="tool-group-chevron" strokeWidth={1.7} />
      </button>
      <div className="tool-group-body" aria-hidden={!expanded}>
        <div className="tool-group-collapse-wrapper">
          <div
            ref={listRef}
            id={contentId}
            className="tool-group-list min-h-0"
            data-tool-group-scroll=""
            onScroll={(event) => setScrolledFromTop(event.currentTarget.scrollTop > 1)}
          >
            {visibleParts.map((part, index) => {
              const status = toolStatus(part, streaming && index === visibleParts.length - 1);
              const diffStats = computeToolDiffStats(part, status);
              const itemTitle = formatToolGroupItem(part, status);
              const fullTitle = diffStats
                ? `${itemTitle} (+${diffStats.added} -${diffStats.removed})`
                : itemTitle;
              return (
                <div
                  key={part.id}
                  className={`tool-group-row ${status === 'Error' || status === 'Denied' ? 'failed' : ''} ${streaming && !preserveExistingItems ? 'tool-row-enter' : ''}`}
                  data-part-key={part.id}
                  data-part-type="toolCall"
                  data-tool-name={part.name}
                  data-tool-status={status}
                  title={fullTitle}
                >
                  <span className={`tool-group-row-label ${status === 'Running' || status === 'Pending' ? 'shimmering' : ''}`}>
                    {itemTitle}
                  </span>
                  {diffStats && (
                    <span className="tool-diff-stats" aria-label={`+${diffStats.added} -${diffStats.removed}`}>
                      {diffStats.added > 0 && <span className="tool-diff-added">+{diffStats.added}</span>}
                      {diffStats.removed > 0 && <span className="tool-diff-removed">-{diffStats.removed}</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
