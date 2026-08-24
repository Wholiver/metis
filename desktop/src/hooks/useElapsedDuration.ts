import { useEffect, useState } from 'react';

export function useElapsedDuration(
  startedAt: number | undefined,
  durationMs: number | undefined,
  running: boolean,
): number | undefined {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!running || startedAt === undefined) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (!running || startedAt === undefined) return durationMs;
  const elapsedMs = Math.max(0, now - startedAt);
  return durationMs === undefined ? elapsedMs : Math.max(durationMs, elapsedMs);
}
