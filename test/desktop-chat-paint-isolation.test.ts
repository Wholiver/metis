import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const desktop = resolve(root, 'desktop');
const requireDesktop = createRequire(join(desktop, 'package.json'));
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('desktop chat paint and scroll isolation', () => {
  it('scopes compositor-friendly scroll rules to the live chat containers', () => {
    const css = source('desktop/src/index.css');
    expect(css).toContain('[data-purpose="main-chat"]');
    expect(css).toContain('isolation: isolate');
    expect(css).toContain('[data-message-scroll]');
    expect(css).toContain('overflow-anchor: none');
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('contain: layout');
    expect(css).toContain('text-rendering: auto');
    expect(css).toContain('[data-composer-fade-mask]');
    expect(css).toContain('[data-shine-border]');
    expect(css).toMatch(/\[data-shine-border\]\s*\{[\s\S]*?contain:\s*paint/);
    expect(css).toContain('@import "streamdown/styles.css"');

    const chat = source('desktop/src/styles/beautifului/chat.css');
    expect(chat).toMatch(/\.tool-group-list\s*\{[\s\S]*?overflow-anchor:\s*none/);
    expect(chat).toMatch(/\.cot-text\s*\{[\s\S]*?text-wrap:\s*wrap/);
    expect(chat).toMatch(/\.cot-thinking-markdown\s*\{[\s\S]*?text-wrap:\s*wrap/);
    expect(chat).toMatch(/\.thinking-skeleton-line\s*\{[\s\S]*?contain:\s*paint/);

    const session = source('desktop/src/styles/beautifului/opencode-session.css');
    expect(session).not.toMatch(
      /\[data-component="tool-trigger"\]\s*\{[^}]*content-visibility:\s*auto/,
    );
    expect(session).not.toContain('will-change: background-position');
    expect(session).toMatch(/tool-output"\]\[data-scrollable\][\s\S]*?overflow-anchor:\s*none/);

    const foundation = source('desktop/src/styles/beautifului/foundation.css');
    expect(foundation).toContain('will-change: opacity, transform;');
    expect(foundation).not.toContain('will-change: opacity, transform, filter');
  });

  it('does not pin large always-on compositor layers on the composer or shine ring', () => {
    const composer = source('desktop/src/components/chat/Composer.tsx');
    expect(composer).toContain('data-composer-dock-stack');
    expect(composer).not.toContain('will-change-transform');

    const shine = source('desktop/src/components/ui/shine-border.tsx');
    expect(shine).toContain('data-shine-border=""');
    expect(shine).not.toContain('will-change-[background-position]');

    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    expect(settings).toContain('calc(100dvh-40px)');
    expect(settings).not.toContain('backdrop-blur-[6px]');
    expect(settings).toContain('bg-surface shadow-hairline');

    const app = source('desktop/src/App.tsx');
    expect(app).not.toMatch(/role="status"[\s\S]{0,280}?backdrop-blur-md/);
  });

  it('proves isolation computed styles in Electron', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metis-chat-paint-'));
    try {
      const postcss = requireDesktop('postcss');
      const tailwind = requireDesktop('@tailwindcss/postcss');
      const { css } = await postcss([tailwind()]).process(
        await readFile(join(desktop, 'src/index.css'), 'utf8'),
        { from: join(desktop, 'src/index.css') },
      );
      await writeFile(join(directory, 'fixture.css'), css);
      // Streamdown styles still ship blurIn keyframes; live Desktop stream disables them.
      expect(css).toContain('@keyframes sd-blurIn');
      expect(css).toContain('[data-sd-animate]');
      await writeFile(
        join(directory, 'index.html'),
        `<!doctype html><html><head>
          <link rel="stylesheet" href="fixture.css">
        </head><body>
          <main data-purpose="main-chat" style="height:480px;display:flex;flex-direction:column">
            <div data-message-scroll class="min-h-0 flex-1 overflow-y-auto">
              <div data-message-lane>
                <div class="markdown-content"><p data-chat-copy>Streaming body copy that should wrap cheaply.</p>
                <span data-stream-token>word</span>
                </div>
                <div class="cot-text">Work item</div>
                <div data-user-bubble class="text-pretty">User bubble</div>
              </div>
            </div>
            <div data-composer-fade-mask></div>
          </main>
          <div data-outside-chat class="markdown-content"><p data-outside-copy>Pretty wrapping stays outside chat.</p></div>
          <div data-component="tool-trigger">tool</div>
          <div data-shine-border></div>
        </body></html>`,
      );
      await writeFile(
        join(directory, 'main.cjs'),
        `
        const { app, BrowserWindow } = require('electron');
        app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
        app.whenReady().then(async () => {
          const window = new BrowserWindow({
            show: false,
            width: 900,
            height: 700,
            webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
          });
          try {
            await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
            const results = await window.webContents.executeJavaScript(\`
              (() => {
                const styleOf = (selector) => {
                  const el = document.querySelector(selector);
                  if (!el) return null;
                  const s = getComputedStyle(el);
                  return {
                    isolation: s.isolation,
                    overflowAnchor: s.overflowAnchor,
                    overscrollBehavior: s.overscrollBehavior,
                    textRendering: s.textRendering,
                    contain: s.contain,
                    textWrap: s.textWrap || s.overflowWrap,
                    contentVisibility: s.contentVisibility,
                  };
                };
                const chatCopy = document.querySelector('[data-chat-copy]');
                const outsideCopy = document.querySelector('[data-outside-copy]');
                const userBubble = document.querySelector('[data-user-bubble]');
                const streamToken = document.querySelector('[data-stream-token]');
                return {
                  main: styleOf('[data-purpose="main-chat"]'),
                  scroll: styleOf('[data-message-scroll]'),
                  lane: styleOf('[data-message-lane]'),
                  chatCopy: {
                    textWrap: getComputedStyle(chatCopy).textWrap,
                    textRendering: getComputedStyle(chatCopy).textRendering,
                  },
                  outsideCopy: { textWrap: getComputedStyle(outsideCopy).textWrap },
                  userBubble: { textWrap: getComputedStyle(userBubble).textWrap },
                  streamToken: {
                    animationName: getComputedStyle(streamToken).animationName,
                    filter: getComputedStyle(streamToken).filter,
                  },
                  trigger: styleOf('[data-component="tool-trigger"]'),
                  shine: styleOf('[data-shine-border]'),
                  fade: styleOf('[data-composer-fade-mask]'),
                  boxes: {
                    main: document.querySelector('[data-purpose="main-chat"]').getBoundingClientRect().toJSON(),
                    scroll: document.querySelector('[data-message-scroll]').getBoundingClientRect().toJSON(),
                  },
                };
              })()
            \`);
            console.log('PAINT_RESULTS=' + JSON.stringify(results));
            app.exit(0);
          } catch (error) {
            console.error(error);
            app.exit(1);
          }
        });
      `,
      );

      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const { stdout } = await promisify(execFile)(requireDesktop('electron'), [join(directory, 'main.cjs')], {
        env,
        timeout: 25_000,
        maxBuffer: 1024 * 1024,
      });
      const resultLine = stdout.split('\n').find((line) => line.startsWith('PAINT_RESULTS='));
      expect(resultLine).toBeDefined();
      const evidence = JSON.parse(resultLine!.slice('PAINT_RESULTS='.length));

      expect(evidence.main.isolation).toBe('isolate');
      expect(evidence.main.textRendering).toBe('auto');
      expect(evidence.scroll.overflowAnchor).toBe('none');
      expect(evidence.scroll.overscrollBehavior).toMatch(/contain/);
      expect(evidence.scroll.contain).toMatch(/layout/);
      expect(evidence.lane.contain).toMatch(/layout/);
      expect(evidence.chatCopy.textWrap).toBe('wrap');
      expect(evidence.userBubble.textWrap).toBe('wrap');
      expect(evidence.outsideCopy.textWrap).toBe('pretty');
      // Live stream tokens are plain text — no per-word blurIn compositor layers.
      expect(evidence.streamToken.animationName).toMatch(/none|^$/);
      expect(evidence.streamToken.filter).toMatch(/none|^$/);
      expect(evidence.trigger.contentVisibility).not.toBe('auto');
      expect(evidence.shine.contain).toMatch(/paint/);
      expect(evidence.fade.contain).toMatch(/paint/);
      expect(evidence.boxes.scroll.height).toBeGreaterThan(100);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
