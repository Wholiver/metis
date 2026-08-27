export function estimateThinkingDurationMs(thinking: string): number {
  return Math.max(1200, Math.min(30000, (thinking.length / 120) * 1000));
}

export function formatThinkingDuration(durationMs: number): string {
  const safeDuration = Math.max(0, Number(durationMs) || 0);
  if (safeDuration < 60000) {
    return `${Math.max(0.1, safeDuration / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(safeDuration / 60000);
  const seconds = Math.floor((safeDuration % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

