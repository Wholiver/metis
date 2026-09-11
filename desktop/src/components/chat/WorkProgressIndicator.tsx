import React from 'react';
import { WorkProgressState } from '../../lib/work-progress';

interface WorkProgressIndicatorProps {
  progress: WorkProgressState;
  idle?: boolean;
}

export const WorkProgressIndicator: React.FC<WorkProgressIndicatorProps> = ({
  progress,
  idle = false,
}) => {
  const markerState = idle
    ? 'idle'
    : progress.status === 'error'
      ? 'error'
      : progress.status === 'waiting'
        ? 'waiting'
        : 'active';

  return (
    <div
      className="work-progress-indicator"
      role="status"
      aria-live="polite"
      data-work-progress
      data-progress-phase={progress.phase}
      data-progress-status={progress.status}
      data-progress-idle={idle ? 'true' : undefined}
      data-progress-marker={markerState}
      {...(progress.actor ? { 'data-progress-actor': progress.actor } : {})}
    >
      <span
        className={`work-progress-marker work-progress-marker-${markerState}`}
        aria-hidden="true"
        data-progress-marker-visual=""
      />
      <span className="work-progress-label" data-work-progress-label>
        {progress.label}
      </span>
    </div>
  );
};
