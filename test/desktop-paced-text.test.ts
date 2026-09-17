import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TEXT_RENDER_IMMEDIATE,
  TEXT_RENDER_PACE_MS,
  createPacedTextController,
  nextPacedEnd,
} from '../desktop/src/lib/paced-text';

describe('paced text (OpenCode port)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('snaps paced ends near punctuation', () => {
    const text = 'Hello world. Next';
    expect(nextPacedEnd(text, 0)).toBeGreaterThan(0);
    expect(nextPacedEnd(text, 0)).toBeLessThanOrEqual(text.length);
  });

  it('syncs immediately when not live', () => {
    const shown: string[] = [];
    const controller = createPacedTextController((value) => shown.push(value));
    controller.sync('abcdef'.repeat(200), false);
    expect(shown.at(-1)).toBe('abcdef'.repeat(200));
    controller.dispose();
  });

  it('coalesces live drips to the pace interval instead of every token', () => {
    vi.useFakeTimers();
    const shown: string[] = [];
    const controller = createPacedTextController((value) => shown.push(value));
    const base = 'x'.repeat(40);
    controller.sync(base, true);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(TEXT_RENDER_PACE_MS);
    expect(shown.at(-1)).toBe(base);

    controller.sync(base + 'y'.repeat(TEXT_RENDER_IMMEDIATE), true);
    expect(shown.at(-1)).toBe(base);
    vi.advanceTimersByTime(TEXT_RENDER_PACE_MS);
    expect(shown.at(-1)).toBe(base + 'y'.repeat(TEXT_RENDER_IMMEDIATE));
    controller.dispose();
  });
});
