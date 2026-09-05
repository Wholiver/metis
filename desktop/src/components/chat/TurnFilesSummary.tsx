import React, { useState } from 'react';
import { ChevronDown, FilePenLine } from 'lucide-react';
import { TurnFileChange } from '../../lib/turn-files';

interface TurnFilesSummaryProps {
  files: TurnFileChange[];
}

export const TurnFilesSummary: React.FC<TurnFilesSummaryProps> = ({ files }) => {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const hiddenCount = files.length - visibleFiles.length;

  return (
    <div
      className="mt-4 w-full min-w-0 rounded-[10px] border border-slate-200 bg-white p-3"
      data-turn-files-summary
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[8px] bg-slate-100 text-slate-600">
          <FilePenLine size={21} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-5 text-slate-900">已编辑 {files.length} 个文件</p>
          <p className="mt-0.5 flex items-baseline gap-1.5 text-[13px] leading-5 tabular-nums">
            <span className="text-emerald-600">+{additions}</span>
            <span className="text-red-500">-{deletions}</span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-1.5 px-1">
        {visibleFiles.map((file) => (
          <div key={file.path} className="flex min-w-0 items-baseline gap-2 text-[13px] leading-5">
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={file.path}>{file.path}</span>
            <span className="shrink-0 tabular-nums text-emerald-600">+{file.additions}</span>
            <span className="shrink-0 tabular-nums text-red-500">-{file.deletions}</span>
          </div>
        ))}
      </div>

      {files.length > 3 && (
        <button
          type="button"
          className="mt-2 flex min-h-10 items-center gap-1 rounded-[10px] px-1 text-[13px] font-medium text-slate-700 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 active:scale-[0.96]"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? '收起文件' : `再显示 ${hiddenCount} 个文件`}
          <ChevronDown
            size={16}
            strokeWidth={2}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
};

