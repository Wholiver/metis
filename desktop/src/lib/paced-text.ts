/**
 * OpenCode `createPacedValue` algorithm (MIT) — framework-agnostic.
 * Streams large text growth in readable steps while live; syncs immediately otherwise.
 */

export const TEXT_RENDER_PACE_MS = 24;
export const TEXT_RENDER_IMMEDIATE = 512;
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/;

function step(size: number): number {
  if (size <= 12) return 2;
  if (size <= 48) return 4;
  if (size <= 96) return 8;
  return Math.min(256, Math.ceil(size / 4));
}

export function nextPacedEnd(text: string, start: number): number {
  const end = Math.min(text.length, start + step(text.length - start));
  const max = Math.min(text.length, end + 8);
  for (let i = end; i < max; i += 1) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? '')) return i + 1;
  }
  return end;
}

export interface PacedTextController {
  getShown: () => string;
  sync: (text: string, live: boolean) => void;
  dispose: () => void;
}

export function createPacedTextController(
  onChange: (shown: string) => void,
): PacedTextController {
  let shown = '';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let latest = '';
  let live = false;

  const clear = () => {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = undefined;
  };

  const publish = (text: string) => {
    shown = text;
    onChange(shown);
  };

  const run = () => {
    timeout = undefined;
    if (!live) {
      publish(latest);
      return;
    }
    if (!latest.startsWith(shown) || latest.length <= shown.length) {
      publish(latest);
      return;
    }
    if (latest.length - shown.length <= TEXT_RENDER_IMMEDIATE) {
      publish(latest);
      return;
    }
    const end = nextPacedEnd(latest, shown.length);
    publish(latest.slice(0, end));
    if (end < latest.length) timeout = setTimeout(run, TEXT_RENDER_PACE_MS);
  };

  return {
    getShown: () => shown,
    sync: (text: string, nextLive: boolean) => {
      latest = text;
      live = nextLive;
      if (!live) {
        clear();
        publish(text);
        return;
      }
      if (!text.startsWith(shown) || text.length < shown.length) {
        clear();
        publish(text);
        return;
      }
      if (text.length - shown.length <= TEXT_RENDER_IMMEDIATE) {
        clear();
        publish(text);
        return;
      }
      if (text.length === shown.length || timeout) return;
      timeout = setTimeout(run, TEXT_RENDER_PACE_MS);
    },
    dispose: clear,
  };
}
