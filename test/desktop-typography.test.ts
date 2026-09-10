import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const desktop = resolve(root, 'desktop');
const requireDesktop = createRequire(join(desktop, 'package.json'));
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('desktop OpenCode production typography (14px BasicTool scale)', () => {
  it('bundles Inter variable font with OFL notice', () => {
    expect(existsSync(resolve(root, 'desktop/src/assets/fonts/InterVariable.woff2'))).toBe(true);
    expect(existsSync(resolve(root, 'desktop/src/assets/fonts/LICENSE.txt'))).toBe(true);

    const css = source('desktop/src/index.css');
    expect(css).toMatch(/@font-face\s*\{[\s\S]*?font-family:\s*"Inter"/);
    expect(css).toContain('InterVariable.woff2');
    expect(css).toContain('font-weight: 100 900');
    expect(css).toMatch(/--font-inter:\s*"Inter"/);

    const notices = source('desktop/THIRD_PARTY_NOTICES.md');
    expect(notices).toContain('## Inter');
    expect(notices).toContain('SIL Open Font License');
    expect(notices).toContain('src/assets/fonts/InterVariable.woff2');
  });

  it('exposes 14px UI baseline with 400/500 primary weights', () => {
    const css = source('desktop/src/index.css');
    expect(css).toContain('--font-size-ui: 14px');
    expect(css).toContain('--font-size-body: 14px');
    expect(css).toContain('--font-size-secondary: 13px');
    expect(css).toContain('--font-weight-regular: 400');
    expect(css).toContain('--font-weight-medium: 500');
    expect(css).toContain('--font-weight-semibold: 600');
    expect(css).toContain('--body-copy-size: var(--font-size-body)');
    expect(css).toContain('--body-copy-weight: 400');
    expect(css).toContain('--body-copy-line-height: var(--line-height-body)');

    const foundation = source('desktop/src/styles/beautifului/foundation.css');
    expect(foundation).toMatch(/body\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)/);
    expect(foundation).toContain('font-size: var(--font-size-ui, 14px)');
    expect(foundation).toContain('font-weight: var(--font-weight-regular, 400)');
  });

  it('aligns markdown, tools, composer, and sidebar to production BasicTool scale', () => {
    const css = source('desktop/src/index.css');
    expect(css).toMatch(/\.markdown-content h1\s*\{[\s\S]*?font-size:\s*17px;[\s\S]*?font-weight:\s*600/);
    expect(css).toMatch(/\.markdown-content h2\s*\{[\s\S]*?font-size:\s*15px;[\s\S]*?font-weight:\s*600/);
    expect(css).toMatch(/\.markdown-content h3\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?font-weight:\s*500/);
    expect(css).toMatch(/\.markdown-content strong\s*\{[\s\S]*?font-weight:\s*500/);
    expect(css).not.toMatch(/font-weight:\s*650/);

    const session = source('desktop/src/styles/beautifului/opencode-session.css');
    expect(session).toMatch(
      /basic-tool-tool-title"\]\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*500/,
    );
    expect(session).toMatch(
      /basic-tool-tool-subtitle"\],\n\[data-component="tool-trigger"\] \[data-slot="basic-tool-tool-arg"\]\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*400/,
    );
    expect(session).toMatch(
      /context-tool-group-title"\]\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*500/,
    );
    expect(session).toMatch(
      /context-tool-group-summary"\]\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*400/,
    );
    expect(session).toMatch(
      /session-turn-thinking"\]\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*500/,
    );
    expect(session).not.toMatch(/basic-tool-tool-subtitle"[\s\S]{0,200}?font-size:\s*11px/);

    const bubble = source('desktop/src/components/chat/AgentBubble.tsx');
    expect(bubble).toContain('text-[14px]');
    expect(bubble).not.toContain('text-[14.5px]');

    const prompt = source('desktop/src/components/primitives/PromptBar.tsx');
    expect(prompt).toContain('text-[14px] font-normal leading-7');
    expect(prompt).toContain('leading-[1.8]');
    expect(prompt).toContain('items-center');
    expect(prompt).not.toContain('text-[13px] font-[440]');
    expect(prompt).not.toContain('py-[5px]');

    const agentItem = source('desktop/src/components/sidebar/AgentItem.tsx');
    expect(agentItem).toContain('text-[14px]');
    expect(agentItem).toContain('font-medium');
    expect(agentItem).toContain('font-normal');
  });

  it('proves OpenCode production sizes via Electron getComputedStyle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metis-typography-'));
    try {
      const postcss = requireDesktop('postcss');
      const tailwind = requireDesktop('@tailwindcss/postcss');
      const { css } = await postcss([tailwind()]).process(
        await readFile(join(desktop, 'src/index.css'), 'utf8'),
        { from: join(desktop, 'src/index.css') },
      );
      await writeFile(join(directory, 'fixture.css'), css);
      await writeFile(
        join(directory, 'index.html'),
        `<!doctype html><html><head>
          <link rel="stylesheet" href="fixture.css">
          <style>*, *::before, *::after { animation: none !important; transition: none !important; }</style>
        </head><body>
          <div data-component="tool-trigger">
            <span data-slot="basic-tool-tool-title">写入</span>
            <span data-slot="basic-tool-tool-subtitle">README.md</span>
            <span data-slot="basic-tool-tool-arg">/</span>
          </div>
          <button data-component="context-tool-group-trigger">
            <span data-slot="context-tool-group-title">已探索</span>
            <span data-slot="context-tool-group-summary">3 次读取</span>
          </button>
          <div data-slot="session-turn-thinking">Thinking</div>
          <div class="markdown-content"><p>Body copy</p><h1>H1</h1><h2>H2</h2><h3>H3</h3><strong>Strong</strong></div>
          <textarea class="text-[14px] font-normal leading-[1.8]">composer</textarea>
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
                    fontSize: s.fontSize,
                    fontWeight: s.fontWeight,
                    lineHeight: s.lineHeight,
                    fontFamily: s.fontFamily,
                    letterSpacing: s.letterSpacing,
                  };
                };
                return {
                  body: styleOf('body'),
                  title: styleOf('[data-slot="basic-tool-tool-title"]'),
                  subtitle: styleOf('[data-slot="basic-tool-tool-subtitle"]'),
                  arg: styleOf('[data-slot="basic-tool-tool-arg"]'),
                  contextTitle: styleOf('[data-slot="context-tool-group-title"]'),
                  contextSummary: styleOf('[data-slot="context-tool-group-summary"]'),
                  thinking: styleOf('[data-slot="session-turn-thinking"]'),
                  markdown: styleOf('.markdown-content'),
                  h1: styleOf('.markdown-content h1'),
                  h2: styleOf('.markdown-content h2'),
                  h3: styleOf('.markdown-content h3'),
                  strong: styleOf('.markdown-content strong'),
                  composer: styleOf('textarea'),
                };
              })()
            \`);
            console.log('TYPO_RESULTS=' + JSON.stringify(results));
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
      const resultLine = stdout.split('\n').find((line) => line.startsWith('TYPO_RESULTS='));
      expect(resultLine).toBeDefined();
      const evidence = JSON.parse(resultLine!.slice('TYPO_RESULTS='.length));

      expect(evidence.body.fontSize).toBe('14px');
      expect(evidence.body.fontWeight).toBe('400');
      expect(evidence.body.fontFamily.toLowerCase()).toContain('inter');

      expect(evidence.title).toMatchObject({ fontSize: '14px', fontWeight: '500', lineHeight: '21px' });
      expect(evidence.subtitle).toMatchObject({ fontSize: '14px', fontWeight: '400', lineHeight: '21px' });
      expect(evidence.arg).toMatchObject({ fontSize: '14px', fontWeight: '400', lineHeight: '21px' });
      expect(evidence.contextTitle).toMatchObject({ fontSize: '14px', fontWeight: '500' });
      expect(evidence.contextSummary).toMatchObject({ fontSize: '14px', fontWeight: '400' });
      expect(evidence.thinking).toMatchObject({ fontSize: '14px', fontWeight: '500', lineHeight: '20px' });

      expect(evidence.markdown.fontSize).toBe('14px');
      expect(evidence.markdown.fontWeight).toBe('400');
      expect(evidence.h1).toMatchObject({ fontSize: '17px', fontWeight: '600' });
      expect(evidence.h2).toMatchObject({ fontSize: '15px', fontWeight: '600' });
      expect(evidence.h3).toMatchObject({ fontSize: '13px', fontWeight: '500' });
      expect(evidence.strong.fontWeight).toBe('500');
      expect(evidence.composer.fontSize).toBe('14px');
      expect(evidence.composer.fontWeight).toBe('400');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
