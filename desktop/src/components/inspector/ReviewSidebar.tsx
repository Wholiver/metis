import React, { useCallback, useRef } from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { ReviewFileDiff, ReviewMode } from '../../hooks/useWorkspaceReview';
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../../hooks/useWorkspaceReview';
import { ReviewFileList } from './ReviewFileList';

export function ReviewSidebar({
  open,
  width,
  onWidthChange,
  mode,
  options,
  onModeChange,
  filter,
  onFilterChange,
  files,
  activeFile,
  onSelectFile,
  totals,
  loading,
}: {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  mode: ReviewMode;
  options: ReviewMode[];
  onModeChange: (mode: ReviewMode) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  files: ReviewFileDiff[];
  activeFile?: string | null;
  onSelectFile: (file: string) => void;
  totals: { additions: number; deletions: number };
  loading?: boolean;
}) {
  const { t } = useI18n();
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const modeLabel = (value: ReviewMode) => {
    if (value === 'git') return t('reviewModeGit') || 'Git changes';
    if (value === 'branch') return t('reviewModeBranch') || 'Branch changes';
    return t('reviewModeTurn') || 'Last turn changes';
  };

  const onResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
  }, [width]);

  const onResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const next = dragRef.current.startWidth + (event.clientX - dragRef.current.startX);
    onWidthChange(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, next)));
  }, [onWidthChange]);

  const onResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }, []);

  if (!open) return null;

  return (
    <div data-component="session-review-v2-sidebar-root">
      <aside
        data-slot="session-review-v2-sidebar"
        style={{ width }}
        aria-label={t('review') || 'Review'}
      >
        <div data-slot="session-review-v2-sidebar-header">
          <div data-slot="session-review-v2-sidebar-title">
            <select
              data-slot="session-review-v2-mode-select"
              value={mode}
              onChange={(event) => onModeChange(event.target.value as ReviewMode)}
              aria-label={t('reviewModeLabel') || 'Change review mode'}
            >
              {options.map((option) => (
                <option key={option} value={option}>{modeLabel(option)}</option>
              ))}
            </select>
          </div>
          {(totals.additions > 0 || totals.deletions > 0) && (
            <span data-slot="session-review-v2-stats">
              <span data-add>+{totals.additions}</span>
              <span data-del>-{totals.deletions}</span>
            </span>
          )}
        </div>

        <div data-slot="session-review-v2-sidebar-filter">
          <div data-slot="session-review-v2-sidebar-filter-wrap">
            <Search size={14} strokeWidth={1.8} data-slot="session-review-v2-sidebar-filter-icon" aria-hidden="true" />
            <input
              type="search"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t('filterFiles') || 'Filter files'}
              aria-label={t('filterFiles') || 'Filter files'}
              data-review-filter=""
            />
          </div>
        </div>

        <div data-slot="session-review-v2-sidebar-tree">
          {loading ? (
            <p className="px-2 py-2 text-[12px] text-ink-3">{t('reviewLoadingChanges') || 'Loading changes…'}</p>
          ) : (
            <ReviewFileList files={files} activeFile={activeFile} onSelect={onSelectFile} />
          )}
        </div>
      </aside>
      <div
        data-slot="session-review-v2-sidebar-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </div>
  );
}
