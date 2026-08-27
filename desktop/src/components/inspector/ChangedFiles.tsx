import React from 'react';
import { FileCode2 } from 'lucide-react';
import { TurnFileChange } from '../../lib/turn-files';

interface ChangedFilesProps {
  files: TurnFileChange[];
}

function fileParts(path: string): { name: string; parent: string } {
  const segments = path.split('/');
  return {
    name: segments.at(-1) || path,
    parent: segments.slice(0, -1).join('/'),
  };
}

export const ChangedFiles: React.FC<ChangedFilesProps> = ({ files }) => {
  if (files.length === 0) {
    return <p className="px-3 py-2 text-[13px] leading-5 text-slate-400" data-changed-files-empty="">No files changed yet</p>;
  }

  return (
    <div className="flex flex-col" data-changed-files-list="">
      {files.map((file) => {
        const { name, parent } = fileParts(file.path);
        return (
          <div
            key={file.path}
            className="flex min-h-8 min-w-0 items-center gap-2 rounded-[8px] px-3 py-0.5 text-[13px] text-slate-700"
            title={file.path}
            data-changed-file=""
            data-changed-file-path={file.path}
          >
            <FileCode2 size={16} strokeWidth={1.8} className="shrink-0 text-blue-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
            {parent && <span className="max-w-[88px] shrink truncate text-slate-400">{parent}</span>}
            <span className="shrink-0 tabular-nums text-[12px] text-emerald-600">+{file.additions}</span>
            <span className="shrink-0 tabular-nums text-[12px] text-red-500">-{file.deletions}</span>
          </div>
        );
      })}
    </div>
  );
};

