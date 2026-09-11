import React, { useMemo } from 'react';
import { AssistantContentPart } from '../../types';
import { useI18n } from '../../i18n';
import { useWorkspaceReview } from '../../hooks/useWorkspaceReview';
import { ReviewDiffPreview } from './ReviewDiffPreview';
import { ReviewEmptyChanges, ReviewEmptyNoGit } from './ReviewEmpty';
import { ReviewSidebar } from './ReviewSidebar';

export function ReviewPanel({
  sessionId,
  workspacePath,
  toolParts = [],
  enabled = true,
}: {
  sessionId?: string | null;
  workspacePath?: string;
  toolParts?: AssistantContentPart[];
  enabled?: boolean;
}) {
  const { t } = useI18n();
  const review = useWorkspaceReview({
    sessionId,
    workspacePath,
    toolParts,
    enabled,
  });

  const showNoGitEmpty = !review.info.isRepo && review.mode === 'turn' && review.files.length === 0;
  const showChangesEmpty = review.files.length === 0 && !showNoGitEmpty && !review.loadingList;

  const preview = useMemo(() => {
    if (review.loadingList) {
      return (
        <div data-slot="session-review-v2-empty" className="text-[12px] text-ink-3">
          {t('reviewLoadingChanges') || 'Loading changes…'}
        </div>
      );
    }
    if (showNoGitEmpty) {
      return <ReviewEmptyNoGit pending={review.initPending} onInitGit={() => void review.initGit()} />;
    }
    if (showChangesEmpty) {
      return <ReviewEmptyChanges />;
    }
    return (
      <ReviewDiffPreview
        file={review.selectedFile}
        patch={review.patch}
        rows={review.rows}
        loading={review.loadingPatch}
      />
    );
  }, [
    t,
    review.loadingList,
    review.initPending,
    review.initGit,
    review.selectedFile,
    review.patch,
    review.rows,
    review.loadingPatch,
    showNoGitEmpty,
    showChangesEmpty,
  ]);

  return (
    <section
      data-component="session-review-v2"
      data-review-panel=""
      data-review-mode={review.mode}
      data-review-repo={review.info.isRepo ? 'true' : 'false'}
      className="h-full min-h-0"
    >
      <div data-slot="session-review-v2-body">
        <ReviewSidebar
          open={review.sidebarOpened}
          width={review.sidebarWidth}
          onWidthChange={review.setSidebarWidth}
          mode={review.mode}
          options={review.options}
          onModeChange={review.setMode}
          filter={review.filter}
          onFilterChange={review.setFilter}
          files={review.filteredFiles}
          activeFile={review.selectedFile}
          onSelectFile={review.setSelectedFile}
          totals={review.totals}
          loading={review.loadingList}
        />
        <div data-slot="session-review-v2-preview" className="min-w-0 flex-1">
          {preview}
        </div>
      </div>
      {review.error ? (
        <p className="shrink-0 px-3 py-1 text-[12px] text-red-500" data-review-error="">{review.error}</p>
      ) : null}
    </section>
  );
}
