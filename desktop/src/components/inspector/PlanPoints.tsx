import React from 'react';
import { Circle, CircleCheckBig, CircleDot, ListTodo } from 'lucide-react';
import { WorkflowPlanStep } from '../../types';

interface PlanPointsProps {
  points: WorkflowPlanStep[];
}

const STATUS_LABELS: Record<WorkflowPlanStep['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};

function StatusIcon({ status }: { status: WorkflowPlanStep['status'] }) {
  if (status === 'completed') {
    return <CircleCheckBig className="h-[18px] w-[18px] stroke-[1.8]" aria-hidden="true" />;
  }
  if (status === 'in_progress') {
    return <CircleDot className="h-[18px] w-[18px] stroke-[1.8]" aria-hidden="true" />;
  }
  return <Circle className="h-[18px] w-[18px] stroke-[1.6]" aria-hidden="true" />;
}

export const PlanPoints: React.FC<PlanPointsProps> = ({ points }) => {
  if (points.length === 0) {
    return (
      <div
        className="flex min-h-[240px] flex-1 flex-col items-center justify-center px-6 text-center"
        data-plan-points-empty=""
      >
        <ListTodo className="mb-2.5 h-6 w-6 stroke-[1.5] text-[#94a3b8]" aria-hidden="true" />
        <p className="text-[13px] font-semibold text-[#334155] text-balance">No plan points yet</p>
        <p className="mt-1 max-w-[210px] text-[12px] leading-[1.55] text-[#94a3b8] text-pretty">
          Points created by update_plan will appear here.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-0.5" data-plan-points-list="">
      {points.map((point, index) => (
        <li
          key={`${index}-${point.step}`}
          className="group flex min-h-9 gap-2.5 rounded-[10px] px-2.5 py-1.5"
          data-plan-point=""
          data-plan-status={point.status}
        >
          <span
            className={`mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center ${
              point.status === 'completed'
                ? 'text-emerald-500'
                : point.status === 'in_progress'
                  ? 'text-blue-600'
                  : 'text-[#b0b7c3]'
            }`}
          >
            <StatusIcon status={point.status} />
          </span>
          <div className="min-w-0 flex-1">
            <p data-plan-point-text="" className={`text-[13px] leading-5 text-pretty ${
              point.status === 'completed' ? 'text-[#64748b]' : 'font-medium text-[#1e293b]'
            }`}>
              {point.step}
            </p>
            <span className="sr-only">{STATUS_LABELS[point.status]}</span>
          </div>
        </li>
      ))}
    </ol>
  );
};

