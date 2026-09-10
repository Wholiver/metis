import React from 'react';
import { ListTodo } from 'lucide-react';
import { WorkflowPlanStep } from '../../types';
import { useI18n } from '../../i18n';
import TaskRows, { type TaskRow } from '../primitives/TaskRows';

interface PlanPointsProps {
  points: WorkflowPlanStep[];
  compactEmpty?: boolean;
  /** Clamp the list to this many visible rows; additional rows scroll. */
  maxVisibleRows?: number;
}

export const PlanPoints: React.FC<PlanPointsProps> = ({
  points,
  compactEmpty = false,
  maxVisibleRows,
}) => {
  const { t } = useI18n();

  if (points.length === 0) {
    return (
      <div
        className={compactEmpty
          ? 'rounded-[12px] border border-dashed border-line px-3 py-3 text-center'
          : 'flex min-h-[240px] flex-1 flex-col items-center justify-center px-6 text-center'}
        data-plan-points-empty=""
      >
        {!compactEmpty ? (
          <ListTodo className="mb-2.5 h-6 w-6 stroke-[1.5] text-ink-3" aria-hidden="true" />
        ) : null}
        <p className={`font-semibold text-ink-2 text-balance ${compactEmpty ? 'text-[12px]' : 'text-[13px]'}`}>
          {t('noPlanPointsYet') || 'No plan points yet'}
        </p>
        <p className={`mt-1 text-[12px] leading-[1.55] text-ink-3 text-pretty ${compactEmpty ? 'max-w-none' : 'max-w-[210px]'}`}>
          Points created by update_plan will appear here.
        </p>
      </div>
    );
  }

  const rows: TaskRow[] = points.map((point, index) => {
    return {
      key: `${index}-${point.step}`,
      label: point.step,
      amount: '',
      status: point.status === 'completed'
        ? 'done'
        : point.status === 'in_progress'
          ? 'running'
          : 'pending',
      step: index + 1,
      details: [],
    };
  });

  return (
    <TaskRows
      variant="List"
      rows={rows}
      labels={{ completed: t('completedStatus') || 'Completed' }}
      maxVisibleRows={maxVisibleRows}
      expandable={false}
      className="plan-points-task-rows"
    />
  );
};
