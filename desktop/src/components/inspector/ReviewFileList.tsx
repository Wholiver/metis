import React from 'react';
import type { ReviewFileDiff } from '../../hooks/useWorkspaceReview';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function kindMark(status?: ReviewFileDiff['status']): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

export function ReviewFileList({
  files,
  activeFile,
  onSelect,
}: {
  files: ReviewFileDiff[];
  activeFile?: string | null;
  onSelect: (file: string) => void;
}) {
  return (
    <div data-slot="session-review-v2-file-list" role="listbox" aria-label={undefined}>
      {files.map((file) => {
        const active = file.file === activeFile;
        return (
          <button
            key={file.file}
            type="button"
            role="option"
            aria-selected={active}
            data-slot="session-review-v2-file"
            data-active={active ? 'true' : 'false'}
            data-review-file={file.file}
            title={file.file}
            onClick={() => onSelect(file.file)}
          >
            <span data-slot="session-review-v2-file-kind" data-kind={file.status || 'modified'}>
              {kindMark(file.status)}
            </span>
            <span data-slot="session-review-v2-file-name">{basename(file.file)}</span>
            <span className="shrink-0 tabular-nums text-[12px] text-green">+{file.additions}</span>
            <span className="shrink-0 tabular-nums text-[12px] text-red-500 dark:text-red-400">-{file.deletions}</span>
          </button>
        );
      })}
    </div>
  );
}
