import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { AttachmentFile } from '../../types';

interface FileCardProps {
  file: AttachmentFile;
  onOpen?: () => void;
}

export const FileCard: React.FC<FileCardProps> = ({ file, onOpen }) => {
  return (
    <div
      onClick={onOpen}
      className="inline-flex items-center gap-3 px-3 py-2 bg-white rounded-[10px] border border-slate-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 transition-colors cursor-pointer my-1 max-w-[320px]"
    >
      <div className="w-8 h-8 rounded-[6px] bg-red-50 border border-red-100/80 flex flex-col items-center justify-center flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="text-[7.5px] font-bold text-red-500 tracking-tight mt-0.5 leading-none">PDF</span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] font-semibold text-[#1e293b] truncate">
          {file.name}
        </span>
        <span className="text-[11px] text-[#64748b] tabular-nums">
          {file.pagesText ? `${file.pagesText} · ` : ''}{file.sizeText}
        </span>
      </div>

      <div className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 flex-shrink-0">
        <ArrowUpRight className="w-4 h-4 stroke-[1.8]" />
      </div>
    </div>
  );
};
