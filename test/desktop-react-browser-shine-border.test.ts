import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBrowserBeingControlled, isBrowserToolName, collectCurrentTurnToolParts, resolveBrowserShineActive } from '../desktop/src/lib/browser-control';
import { BROWSER_SHINE_COLORS } from '../desktop/src/components/ui/shine-border';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop Inspector shine border while the model controls the browser', () => {
  it('keeps control active for the live turn after any browser_* tool, not only while one is in flight', () => {
    expect(isBrowserToolName('browser_click')).toBe(true);
    expect(isBrowserToolName('bash')).toBe(false);

    const running = { type: 'toolCall', name: 'browser_navigate', progress: { state: 'running' } };
    const pending = { type: 'toolCall', name: 'browser_snapshot' };
    const done = { type: 'toolCall', name: 'browser_click', result: { content: 'ok' } };
    const shell = { type: 'toolCall', name: 'bash' };

    expect(isBrowserBeingControlled([running], false)).toBe(true);
    expect(isBrowserBeingControlled([pending], true)).toBe(true);
    expect(isBrowserBeingControlled([pending], false)).toBe(false);
    expect(isBrowserBeingControlled([done], true)).toBe(true);
    expect(isBrowserBeingControlled([done, shell], true)).toBe(true);
    expect(isBrowserBeingControlled([done], false)).toBe(false);
    expect(isBrowserBeingControlled([shell], true)).toBe(false);
    expect(isBrowserBeingControlled([], true)).toBe(false);
  });

  it('scopes browser tools to the current turn and latches shine until streaming ends', () => {
    const previous = { type: 'toolCall', name: 'browser_navigate', result: { content: 'ok' } };
    const currentShell = { type: 'toolCall', name: 'bash', result: { content: 'ok' } };
    const currentBrowser = { type: 'toolCall', name: 'browser_click', result: { content: 'ok' } };
    const messages = [
      { role: 'assistant', parts: [previous] },
      { role: 'user', parts: [] },
      { role: 'assistant', parts: [currentBrowser, currentShell] },
    ];

    expect(collectCurrentTurnToolParts(messages)).toEqual([currentBrowser, currentShell]);
    expect(isBrowserBeingControlled(collectCurrentTurnToolParts(messages), true)).toBe(true);
    expect(isBrowserBeingControlled(collectCurrentTurnToolParts([
      { role: 'assistant', parts: [previous] },
      { role: 'user', parts: [] },
      { role: 'assistant', parts: [currentShell] },
    ]), true)).toBe(false);

    expect(resolveBrowserShineActive({
      hostBusy: true,
      streaming: true,
      latched: false,
      toolParts: [],
    })).toEqual({ active: true, nextLatched: true });

    expect(resolveBrowserShineActive({
      hostBusy: false,
      streaming: true,
      latched: true,
      toolParts: [],
    })).toEqual({ active: true, nextLatched: true });

    expect(resolveBrowserShineActive({
      hostBusy: false,
      streaming: false,
      latched: true,
      toolParts: [currentBrowser],
    })).toEqual({ active: false, nextLatched: false });
  });

  it('wires ShineBorder onto the Inspector browser panel from App control state', () => {
    const app = source('desktop/src/App.tsx');
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    const panel = source('desktop/src/components/inspector/InspectorBrowserPanel.tsx');
    const shine = source('desktop/src/components/ui/shine-border.tsx');
    const css = source('desktop/src/index.css');

    expect(app).toContain('resolveBrowserShineActive');
    expect(app).toContain('browserHostBusy');
    expect(app).toContain('browserShineLatched');
    expect(app).toContain('desktop.browser.onBusy');
    expect(app).toContain('browserModelControlled={browserModelControlled}');

    expect(inspector).toContain('modelControlled={browserModelControlled}');
    expect(panel).toContain('data-browser-model-controlled');
    expect(panel).toContain('<ShineBorder');
    expect(panel).toContain('modelControlled ?');
    expect(panel).toContain('p-[2px]');

    expect(shine).toContain('data-shine-border=""');
    expect(shine).toContain('maskComposite');
    expect(shine).toContain('radial-gradient');
    expect(BROWSER_SHINE_COLORS).toEqual(['#A07CFE', '#FE8FB5', '#FFBE7B']);

    expect(css).toContain('@keyframes shine');
    expect(css).toContain('[data-shine-border]');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('background-position: 100% 0%');
  });
});
