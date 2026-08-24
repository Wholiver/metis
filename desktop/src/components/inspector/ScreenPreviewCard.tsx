import React from 'react';
import { Agent } from '../../types';

interface ScreenPreviewCardProps {
  agent: Agent;
}

export const ScreenPreviewCard: React.FC<ScreenPreviewCardProps> = ({ agent }) => {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="w-full bg-[#f1f3f6] rounded-[16px] border border-slate-200/90 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-2">
        {/* Chrome Browser Window */}
        <div className="w-full rounded-[12px] overflow-hidden bg-white border border-slate-300/60 shadow-sm">
          {/* Chrome Header */}
          <div className="h-6 bg-[#f8fafc] border-b border-slate-200 flex items-center px-2.5 gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
            <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
            <span className="w-2 h-2 rounded-full bg-[#27c93f]" />

            <div className="flex-1 text-center pr-3">
              <span className="text-[9.5px] text-[#94a3b8] font-sans">
                calendar.google.com
              </span>
            </div>
          </div>

          {/* Calendar Canvas */}
          <div className="h-[145px] bg-white relative p-2 flex gap-2 overflow-hidden select-none">
            {/* Left mini sidebar calendar */}
            <div className="w-8 h-full bg-[#f8fafc] rounded p-1 flex flex-col gap-1 border border-slate-100">
              <div className="w-full h-1.5 bg-slate-300 rounded-[1px]" />
              <div className="grid grid-cols-3 gap-0.5 mt-0.5">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="w-1.5 h-1.5 bg-slate-200 rounded-[1px]" />
                ))}
              </div>
            </div>

            {/* Main Calendar Grid */}
            <div className="flex-1 h-full grid grid-cols-4 gap-1 relative border-l border-slate-100 pl-1.5">
              {/* Col 1 */}
              <div className="flex flex-col gap-1">
                <div className="h-6 bg-[#38bdf8] rounded-[3px] shadow-[0_1px_2px_rgba(56,189,248,0.3)]" />
                <div className="h-10 bg-[#0284c7] rounded-[3px] shadow-[0_1px_2px_rgba(2,132,199,0.3)]" />
                <div className="h-4 bg-[#38bdf8] rounded-[3px]" />
              </div>

              {/* Col 2 */}
              <div className="flex flex-col gap-1">
                <div className="h-8 bg-[#f87171] rounded-[3px] shadow-[0_1px_2px_rgba(248,113,113,0.3)]" />
                <div className="h-6 bg-[#38bdf8] rounded-[3px]" />
                <div className="h-7 bg-[#4ade80] rounded-[3px]" />
              </div>

              {/* Col 3 */}
              <div className="flex flex-col gap-1">
                <div className="h-14 bg-[#4ade80] rounded-[3px] shadow-[0_1px_2px_rgba(74,222,128,0.3)]" />
                <div className="h-6 bg-[#60a5fa] rounded-[3px]" />
              </div>

              {/* Col 4 */}
              <div className="flex flex-col gap-1">
                <div className="h-8 bg-[#38bdf8] rounded-[3px]" />
                <div className="h-10 bg-[#818cf8] rounded-[3px] shadow-[0_1px_2px_rgba(129,140,248,0.3)]" />
              </div>

              {/* Mouse Cursor */}
              <div className="absolute right-2 bottom-3 pointer-events-none">
                <svg width="13" height="17" viewBox="0 0 14 18" fill="none">
                  <path
                    d="M1 1L5.5 16L8.5 10.5L13 9L1 1Z"
                    fill="#000000"
                    stroke="#ffffff"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Caption */}
      <div className="text-center">
        <span className="text-[12px] font-medium text-[#64748b]">
          {agent.name}’s screen
        </span>
      </div>
    </div>
  );
};
