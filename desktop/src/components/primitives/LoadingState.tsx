/**
 * Source: https://www.beautifului.dev/r/loading-state.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export type LoadingStateProps = {
  label: string;
  startedAt?: number;
  className?: string;
};

export default function LoadingState({ label, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center text-center text-ink-3', className)}
      data-beautiful-loading=""
    >
      <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
      <span className="text-[13px] text-ink-3 font-normal">{label}</span>
    </div>
  );
}
