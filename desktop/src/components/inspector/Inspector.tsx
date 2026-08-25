import React, { useState } from 'react';
import { ChevronDown, PanelRightClose } from 'lucide-react';
import { WorkflowPlanState } from '../../types';
import { TurnFileChange } from '../../lib/turn-files';
import { SubagentItem } from '../../lib/subagents';
import { ChangedFiles } from './ChangedFiles';
import { PlanPoints } from './PlanPoints';
import { SubagentsList } from './SubagentsList';
import { SubagentDetailView } from './SubagentDetailView';

interface InspectorProps {
  workflowPlan?: WorkflowPlanState;
  fileChanges?: TurnFileChange[];
  subagents?: SubagentItem[];
  width?: number;
  onClose?: () => void;
  onCollapse?: () => void;
}

export const Inspector: React.FC<InspectorProps> = ({
  workflowPlan,
  fileChanges = [],
  subagents = [],
  width = 320,
  onClose,
  onCollapse,
}) => {
  const [filesExpanded, setFilesExpanded] = useState(true);
  const [planExpanded, setPlanExpanded] = useState(true);
  const [subagentsExpanded, setSubagentsExpanded] = useState(true);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);

  const selectedSubagent = selectedSubagentId
    ? subagents.find((item) => item.id === selectedSubagentId)
    : null;

  const runningSubagentsCount = subagents.filter((item) => item.status === 'running').length;

  return (
    <aside
      style={{ width: `${width}px` }}
      className="h-full min-w-[300px] shrink bg-[#ffffff] border-l border-slate-200/80 flex flex-col overflow-hidden select-none relative"
      aria-label="Workspace context"
      data-plan-inspector=""
    >
      {selectedSubagent ? (
        <SubagentDetailView
          subagent={selectedSubagent}
          onBack={() => setSelectedSubagentId(null)}
        />
      ) : (
        <>
          <div className="h-10 px-3.5 flex items-center justify-end flex-shrink-0 titlebar-drag">
            <button
              onClick={onCollapse || onClose}
              className="relative w-7 h-7 rounded-lg flex items-center justify-center text-[#8e95a2] hover:bg-black/5 hover:text-[#0f172a] no-drag before:absolute before:left-1/2 before:top-1/2 before:h-10 before:w-10 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] active:scale-[0.96] transition-[color,background-color,transform]"
              title="Collapse Inspector"
              aria-label="Collapse workspace context"
            >
              <PanelRightClose className="w-4 h-4 stroke-[1.8]" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3.5 pb-3.5 no-drag space-y-1">
            <section data-changed-files-section="">
              <button
                type="button"
                className="flex min-h-8 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[14px] font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
                onClick={() => setFilesExpanded((value) => !value)}
                aria-expanded={filesExpanded}
              >
                <span>Files Changed</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] leading-4 tabular-nums text-slate-500">{fileChanges.length}</span>
                <ChevronDown size={16} strokeWidth={2} className={`ml-auto transition-transform ${filesExpanded ? '' : '-rotate-90'}`} aria-hidden="true" />
              </button>
              {filesExpanded && <ChangedFiles files={fileChanges} />}
            </section>

            <section data-plan-section="">
              <button
                type="button"
                className="flex min-h-8 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[14px] font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
                onClick={() => setPlanExpanded((value) => !value)}
                aria-expanded={planExpanded}
              >
                <span data-plan-points-title="">Plan</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] leading-4 tabular-nums text-slate-500">{workflowPlan?.plan.length || 0}</span>
                <ChevronDown size={16} strokeWidth={2} className={`ml-auto transition-transform ${planExpanded ? '' : '-rotate-90'}`} aria-hidden="true" />
              </button>
              {planExpanded && <PlanPoints points={workflowPlan?.plan || []} />}
            </section>

            <section data-subagents-section="">
              <button
                type="button"
                className="flex min-h-8 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[14px] font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
                onClick={() => setSubagentsExpanded((value) => !value)}
                aria-expanded={subagentsExpanded}
              >
                <span data-subagents-title="">Subagents</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] leading-4 tabular-nums text-slate-500 flex items-center gap-1">
                  {runningSubagentsCount > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                  )}
                  {subagents.length}
                </span>
                <ChevronDown size={16} strokeWidth={2} className={`ml-auto transition-transform ${subagentsExpanded ? '' : '-rotate-90'}`} aria-hidden="true" />
              </button>
              {subagentsExpanded && (
                <SubagentsList
                  subagents={subagents}
                  onSelect={(item) => setSelectedSubagentId(item.id)}
                />
              )}
            </section>
          </div>
        </>
      )}
    </aside>
  );
};
