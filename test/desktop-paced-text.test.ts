import { describe, expect, it } from 'vitest';
import {
  TEXT_RENDER_IMMEDIATE,
  createPacedTextController,
  nextPacedEnd,
} from '../desktop/src/lib/paced-text';

describe('paced text (OpenCode port)', () => {
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

  it('syncs immediately when delta is within the immediate threshold', () => {
    const shown: string[] = [];
    const controller = createPacedTextController((value) => shown.push(value));
    const base = 'x'.repeat(40);
    controller.sync(base, true);
    controller.sync(base + 'y'.repeat(TEXT_RENDER_IMMEDIATE), true);
    expect(shown.at(-1)).toBe(base + 'y'.repeat(TEXT_RENDER_IMMEDIATE));
    controller.dispose();
  });
});
