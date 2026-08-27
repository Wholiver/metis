import React from 'react';
import { Clock, PauseCircle } from 'lucide-react';
import { RoutineItem } from '../../types';

interface RoutinesProps {
  routines?: RoutineItem[];
}

const DEFAULT_ROUTINES: RoutineItem[] = [
  {
    id: 'r-1',
    title: 'Morning briefing',
    scheduleText: 'Every day at 8:00 AM',
    status: 'active',
  },
  {
    id: 'r-2',
    title: 'Inbox cleanup',
    scheduleText: 'Weekdays at 6:00 PM',
    status: 'active',
  },
  {
    id: 'r-3',
    title: 'Weekly team update',
    scheduleText: 'Paused',
    status: 'paused',
  },
];

export const Routines: React.FC<RoutinesProps> = ({ routines = DEFAULT_ROUTINES }) => {
  return (
    <div className="flex flex-col gap-2.5 pt-2">
      <h2 className="text-[12px] font-semibold text-[#94a3b8] uppercase tracking-wider">
        Routines
      </h2>

      <div className="flex flex-col gap-3">
        {routines.map((routine) => (
          <div key={routine.id} className="flex items-center gap-3">
            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
              {routine.status === 'active' ? (
                <Clock className="w-4 h-4 text-emerald-500 stroke-[2]" />
              ) : (
                <PauseCircle className="w-4 h-4 text-slate-400 stroke-[1.8]" />
              )}
            </div>

            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-[#1e293b]">
                {routine.title}
              </span>
              <span className="text-[11.5px] text-[#64748b] tabular-nums">
                {routine.scheduleText}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

