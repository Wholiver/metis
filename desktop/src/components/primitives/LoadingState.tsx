/**
 * Source: https://www.beautifului.dev/r/loading-state.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';

export type LoadingStateProps = {
  label: string;
  startedAt?: number;
  className?: string;
};

export default function LoadingState({ label, startedAt = Date.now(), className }: LoadingStateProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  const delays = useMemo(() => Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return (column + Math.abs(row - 1)) * 90;
  }), []);
  return (
    <div role="status" className={cn('inline-flex w-fit items-center gap-2.5 text-[13px]', className)} data-beautiful-loading="">
      <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((delay, index) => (
          <span key={index} className="size-1 rounded-[1px] bg-ink opacity-15 motion-safe:animate-[pixel-on_650ms_ease-in-out_infinite]" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span className="beautiful-shimmer font-medium">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-ink-3">{`${Math.max(0, (now - startedAt) / 1000).toFixed(1)}s`}</span>
    </div>
  );
}
