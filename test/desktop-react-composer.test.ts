import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  composerTextareaHeight,
  hasComposerLineBreak,
  IDLE_COMPOSER_ACTIVITY,
  reduceComposerActivity,
} from '../desktop/src/lib/composer';
import { filterSkills } from '../desktop/src/components/chat/SkillPicker';
import { parseToken } from '../desktop/src/components/primitives/PromptBar';

describe('desktop React multiline composer', () => {
  it('routes at tokens to composer actions and slash tokens to commands', () => {
    expect(parseToken('@')).toEqual({ kind: 'at', query: '', start: 0 });
    expect(parseToken('@bu')).toEqual({ kind: 'at', query: 'bu', start: 0 });
    expect(parseToken('/')).toEqual({ kind: 'slash', query: '', start: 0 });
    expect(parseToken('run /pdf')).toEqual({ kind: 'slash', query: 'pdf', start: 4 });
    expect(parseToken('email@example.com')).toBeNull();
  });

  it('enters multiline mode only after an explicit line break', () => {
    expect(hasComposerLineBreak('First line')).toBe(false);
    expect(hasComposerLineBreak('First line\nSecond line')).toBe(true);
    expect(hasComposerLineBreak('First line\r\nSecond line')).toBe(true);
  });

  it('clamps textarea height for normal and expanded multiline modes', () => {
    expect(composerTextareaHeight(20, false)).toBe(48);
    expect(composerTextareaHeight(180, false)).toBe(112);
    expect(composerTextareaHeight(180, true)).toBe(180);
    expect(composerTextareaHeight(400, true)).toBe(240);
  });

  it('uses a textarea, sends on Enter, and preserves Shift+Enter for line breaks', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/primitives/PromptBar.tsx'),
      'utf8',
    );
    expect(source).toContain('<textarea');
    expect(source).toContain('event.key === "Enter" && !event.shiftKey');
    expect(source).toContain('data-prompt-bar');
    expect(source).toContain('data-composer-input');
    expect(source).toContain('shadow-card');
    expect(source).toContain('type="submit"');
    expect(source).toContain('data-send-icon');
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    expect(composer).toContain('composeAttachmentPayload(draftText, draftAttachments)');
    expect(composer).toContain("(!text.trim() && attachments.length === 0)");
    expect(composer).toContain('data-attachment-input');
    expect(composer).toContain("fileInputRef.current?.click()");
    expect(composer).not.toContain('<Mic');
    expect(composer).not.toContain('Voice Input');
    expect(source).not.toContain('transition-all');
  });

  it('wires compact usage footer below the composer input', () => {
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    const footer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ComposerUsageFooter.tsx'), 'utf8');
    const chatArea = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    const chatHeader = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatHeader.tsx'), 'utf8');

    expect(footer).toContain('data-composer-usage-footer');
    expect(footer).toContain('5h ${formatQuotaPercent(quota5h?.percent)}');
    expect(footer).toContain('7d ${formatQuotaPercent(quota7d?.percent)}');
    expect(footer).toContain('formatTokenCount(usedTokens)');
    expect(composer).toContain('contextUsage={contextUsage}');
    expect(composer).toContain('isOAuth={isOAuth}');
    expect(composer).toContain('!isHomeEmpty ? (');
    expect(composer).toContain('<ComposerUsageFooter');
    expect(chatArea).toContain('totalCost={totalCost}');
    expect(chatArea).toContain('quota5h={quota5h}');
    expect(app).toContain('costActivity');
    expect(app).toContain('isOAuth={isOAuthModel}');
    expect(app).toContain('totalCost={aggregateCost}');
    expect(chatHeader).not.toContain('TokenUsageBar');
  });

  it('uses a tall centered home shell and docks after the first message', () => {
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    const chatArea = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'), 'utf8');
    expect(chatArea).toContain('isHomeEmpty={isHomeEmpty}');
    expect(composer).toContain('tall={isHomeEmpty}');
    expect(composer).toContain("inset-0 justify-center");
    expect(composer).toContain("inset-x-0 bottom-0");
    expect(composer).toContain('data-composer-dock-stack');
    expect(composer).toContain('transform 320ms');
  });

  it('starts output progress locally before the server streaming state arrives', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'),
      'utf8',
    );
    expect(source).toContain("type: 'send-started'");
    expect(source).toContain('const result = await onSendMessage(text, options)');
    expect(source).toContain('composerActivity.localTaskPending || isStreaming');
    expect(source).toContain('isStreaming={showActiveProgress}');
    expect(source).toContain('onAbort={onAbort}');
    expect(source).toContain('disabled={showActiveProgress || isLoading || isCompacting}');
    expect(source.indexOf("type: 'send-started'"))
      .toBeLessThan(source.indexOf('await onSendMessage(text, options)'));

    const composerSource = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/primitives/PromptBar.tsx'),
      'utf8',
    );
    expect(composerSource).toContain('data-stop-button');
    expect(composerSource).toContain('onStop?.()');
  });

  it('unlocks the composer when a successful send settles before streaming is observed', () => {
    const pending = reduceComposerActivity(IDLE_COMPOSER_ACTIVITY, { type: 'send-started' });
    const settled = reduceComposerActivity(pending, { type: 'send-settled' });

    expect(pending.localTaskPending).toBe(true);
    expect(settled).toEqual(IDLE_COMPOSER_ACTIVITY);
  });

  it('unlocks the composer after normal streaming completion and rejected sends', () => {
    const pending = reduceComposerActivity(IDLE_COMPOSER_ACTIVITY, { type: 'send-started' });
    const streaming = reduceComposerActivity(pending, {
      type: 'server-streaming-changed',
      streaming: true,
    });
    const completed = reduceComposerActivity(streaming, {
      type: 'server-streaming-changed',
      streaming: false,
    });
    const rejected = reduceComposerActivity(pending, { type: 'send-settled' });

    expect(streaming).toEqual({ localTaskPending: true, sawServerStreaming: true });
    expect(completed).toEqual(IDLE_COMPOSER_ACTIVITY);
    expect(rejected).toEqual(IDLE_COMPOSER_ACTIVITY);
  });

  it('keeps a repeatable Desktop capture for the settled-send unlock state', () => {
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');

    expect(app).toContain("captureParams.has('capture-send-settled')");
    expect(app).toContain('captureSettledSend\n          ? async () => true');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND_SETTLED');
    expect(main).toContain('[capture:composer-send-settled]');
  });

  it('filters skill commands after slash and inserts them with keyboard selection support', () => {
    expect(filterSkills([
      { name: 'make-interfaces-feel-better', description: 'Polish interface details' },
      { name: 'pdf', description: 'Inspect PDFs' },
    ], 'interface')).toEqual([{ name: 'make-interfaces-feel-better', description: 'Polish interface details' }]);

    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    const promptBar = readFileSync(resolve(process.cwd(), 'desktop/src/components/primitives/PromptBar.tsx'), 'utf8');
    expect(promptBar).toContain('kind: "at" | "slash"');
    expect(promptBar).toContain('menu === "slash"');
    expect(promptBar).toContain('event.key === "ArrowDown" || event.key === "ArrowUp"');
    expect(promptBar).toContain('pick(rows[active])');
    expect(composer).toContain('setText(`/${skill.name} `)');

    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    expect(app).toContain("request<{ commands?: Array<{ name?: string; description?: string; source?: string }> }>('/commands')");
    expect(app).toContain("command.source === 'skill'");
  });

  it('limits plus and at menus to Metis modes and file attachment actions', () => {
    const promptBar = readFileSync(resolve(process.cwd(), 'desktop/src/components/primitives/PromptBar.tsx'), 'utf8');
    expect(promptBar).toContain('key: "plan"');
    expect(promptBar).toContain('key: "build"');
    expect(promptBar).toContain('key: "attach"');
    expect(promptBar).toContain('onSelectCollaborationMode?.(source.mode)');
    expect(promptBar).not.toContain('Scoop Data');
    expect(promptBar).not.toContain('Flavor records');
    expect(promptBar).not.toContain('Web search');
    expect(promptBar).not.toContain('name: "Figma"');
    expect(promptBar).not.toContain('name: "Slack"');
    expect(promptBar).not.toContain('name: "Gmail"');
    const main = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PLUS_MENU');
    expect(main).toContain('[capture:plus-menu]');
  });

  it('keeps the scrollable message lane centered with the composer', () => {
    const messages = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MessageList.tsx'),
      'utf8',
    );
    expect(messages).toContain("scrollbarGutter: 'stable both-edges'");
    expect(messages).toContain("overflowAnchor: 'none'");
    expect(messages).toContain('data-message-scroll');
    expect(messages).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(messages).toContain('data-message-lane');
    expect(messages).toContain('min-w-0 max-w-[620px]');
    expect(messages).toContain('data-composer-clearance');
    expect(messages).toContain("calc(var(--composer-overlay-height, 100px) + 16px)");

    const composer = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'),
      'utf8',
    );
    expect(composer).toContain('pointer-events-auto relative flex w-full max-w-[620px]');
    expect(composer).toContain('new ResizeObserver(updateOverlayHeight)');
    expect(composer).toContain("main.style.setProperty(");
    expect(composer).toContain("'--composer-overlay-height'");
    expect(composer).toContain("closest<HTMLElement>('[data-purpose=\"main-chat\"]')");
    expect(composer).toContain('pointer-events-none absolute z-20');
    expect(composer).toContain("inset-x-0 bottom-0");
    expect(composer).toContain('data-composer-dock-stack');
    const modeSwitcher = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/ModeSwitcher.tsx'),
      'utf8',
    );
    expect(modeSwitcher).toContain('pointer-events-auto relative inline-flex');

    const desktopMain = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(desktopMain).toContain('scrollExtendsBehindComposer');
    expect(desktopMain).toContain('composerShellPointerEvents');
    expect(desktopMain).toContain('composerClearanceHeight');

    const markdown = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MarkdownContent.tsx'),
      'utf8',
    );
    expect(markdown).toContain('w-full min-w-0 max-w-full');
    expect(markdown).toContain('[overflow-wrap:anywhere]');
  });

  it('keeps collapsed prompt-bar controls on one vertical centerline', async () => {
    const promptBar = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/primitives/PromptBar.tsx'),
      'utf8',
    );
    const switcher = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/ModelSwitcher.tsx'),
      'utf8',
    );
    expect(promptBar).toContain('wide ? "items-end" : "items-center"');
    expect(promptBar).toContain('h-7 min-h-7 px-1 py-0 text-[14px] font-normal leading-7');
    expect(promptBar).not.toContain('py-[5px]');
    expect(switcher).toContain('text-[13px] font-medium leading-7');

    const desktop = resolve(process.cwd(), 'desktop');
    const requireDesktop = createRequire(join(desktop, 'package.json'));
    const directory = await mkdtemp(join(tmpdir(), 'metis-composer-align-'));
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
        </head><body class="p-8">
          <div data-controls class="grid w-[560px] items-center gap-x-1 grid-cols-[28px_minmax(0,1fr)_auto_28px_28px]">
            <button data-plus class="flex size-7 items-center justify-center rounded-[8px] text-ink-3">+</button>
            <textarea data-input class="h-7 min-h-7 w-full resize-none bg-transparent px-1 py-0 text-[14px] font-normal leading-7 text-ink outline-none" placeholder="写一条消息..."></textarea>
            <button data-model class="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[13px] font-medium leading-7 text-ink-2">GPT-5.6 Luna · 低</button>
            <button data-mic class="flex size-7 items-center justify-center rounded-[8px] text-ink-3">m</button>
            <button data-send class="flex size-7 items-center justify-center rounded-[8px] bg-ink text-surface">^</button>
          </div>
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
            height: 500,
            webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
          });
          try {
            await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
            const results = await window.webContents.executeJavaScript(\`
              (() => {
                const midY = (selector) => {
                  const el = document.querySelector(selector);
                  const box = el.getBoundingClientRect();
                  return { top: box.top, bottom: box.bottom, mid: box.top + box.height / 2, height: box.height, fontSize: getComputedStyle(el).fontSize, lineHeight: getComputedStyle(el).lineHeight };
                };
                return {
                  plus: midY('[data-plus]'),
                  input: midY('[data-input]'),
                  model: midY('[data-model]'),
                  mic: midY('[data-mic]'),
                  send: midY('[data-send]'),
                };
              })()
            \`);
            console.log('ALIGN_RESULTS=' + JSON.stringify(results));
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
      const resultLine = stdout.split('\n').find((line) => line.startsWith('ALIGN_RESULTS='));
      expect(resultLine).toBeDefined();
      const evidence = JSON.parse(resultLine!.slice('ALIGN_RESULTS='.length));

      expect(evidence.input.height).toBe(28);
      expect(evidence.plus.height).toBe(28);
      expect(evidence.model.height).toBe(28);
      expect(evidence.input.fontSize).toBe('14px');
      expect(evidence.model.fontSize).toBe('13px');

      const mids = [evidence.plus.mid, evidence.input.mid, evidence.model.mid, evidence.mic.mid, evidence.send.mid];
      const maxDelta = Math.max(...mids) - Math.min(...mids);
      expect(maxDelta).toBeLessThanOrEqual(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
