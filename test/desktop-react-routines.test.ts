import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('desktop react routines feature', () => {
  it('exposes routines API in preload.cjs', () => {
    const preload = readFileSync(resolve(process.cwd(), 'desktop/preload.cjs'), 'utf8');
    expect(preload).toContain('routines: {');
    expect(preload).toContain('list: () => ipcRenderer.invoke("routine:list")');
    expect(preload).toContain('create: (payload) => ipcRenderer.invoke("routine:create", payload)');
    expect(preload).toContain('update: (id, patch) => ipcRenderer.invoke("routine:update", { id, patch })');
    expect(preload).toContain('delete: (id) => ipcRenderer.invoke("routine:delete", { id })');
    expect(preload).toContain('runNow: (id) => ipcRenderer.invoke("routine:run-now", { id })');
    expect(preload).toContain('onUpdated: (listener) =>');
  });

  it('renders Routines entry in Sidebar action bar', () => {
    const sidebar = readFileSync(resolve(process.cwd(), 'desktop/src/components/sidebar/Sidebar.tsx'), 'utf8');
    expect(sidebar).toContain('data-routines-action=""');
    expect(sidebar).toContain('onOpenRoutines');
    expect(sidebar).toContain("t('routines')");
  });

  it('wires RoutinesManager in App.tsx with projectPath navigation', () => {
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    expect(app).toContain('isRoutinesViewActive');
    expect(app).toContain('<RoutinesManager');
    expect(app).toContain('isRoutinesOpen={isRoutinesViewActive}');
    expect(app).toContain('onOpenRoutines={handleOpenRoutines}');
    expect(app).toContain('handleJumpToRoutineSession');
    expect(app).toContain('targetProject');
  });

  it('provides comprehensive RoutinesManager and RoutineEditModal components', () => {
    const manager = readFileSync(resolve(process.cwd(), 'desktop/src/components/routines/RoutinesManager.tsx'), 'utf8');
    expect(manager).toContain('data-routines-manager=""');
    expect(manager).toContain('data-new-routine-button=""');
    expect(manager).toContain('data-routines-empty=""');
    expect(manager).toContain('data-routine-templates=""');
    expect(manager).toContain('data-create-first-routine');
    expect(manager).toContain('handleRunNow');
    expect(manager).toContain('handleToggleStatus');
    expect(manager).toContain('handleDeleteRoutine');
    expect(manager).toContain('routine.projectPath');
    expect(manager).toContain('data-routine-source="self_learning"');
    expect(manager).toContain('routineSourceSelfLearning');
    expect(manager).toContain('useTemplate');
    expect(manager).toContain('availableTemplates');
    // Single primary CTA — empty body must not duplicate the header button
    expect(manager).not.toContain("data-create-first-routine=\"\"");
    expect(manager).toContain("data-create-first-routine': ''");
    // Quiet empty-state layout: no marketing 3-column template cards
    expect(manager).not.toContain('sm:grid-cols-3');
    expect(manager).not.toContain('shadow-card');
    expect(manager).toContain('max-w-[360px]');
    expect(manager).toContain('max-w-[720px]');
    expect(manager).toContain('stroke-[1.7] text-ink-3');

    const modal = readFileSync(resolve(process.cwd(), 'desktop/src/components/routines/RoutineEditModal.tsx'), 'utf8');
    expect(modal).toContain('CRON_PRESETS');
    expect(modal).toContain('cronValid');
    expect(modal).toContain('getNextRunTime');
    expect(modal).toContain('routineTitleRequired');
    expect(modal).toContain('routinePromptRequired');
    expect(modal).toContain('data-routine-edit-modal=""');
    expect(modal).toContain('data-save-routine=""');
    // No duplicate dismiss: header X only, no Cancel footer button
    expect(modal).not.toContain('cancelRoutine');
  });

  it('includes routines translations in i18n-source.cjs', () => {
    const i18n = readFileSync(resolve(process.cwd(), 'desktop/i18n-source.cjs'), 'utf8');
    expect(i18n).toContain('"routines": "例行任务"');
    expect(i18n).toContain('"newRoutine": "新建例行任务"');
    expect(i18n).toContain('"runNow": "立即运行"');
    expect(i18n).toContain('"routineTitleRequired": "任务名称不能为空"');
    expect(i18n).toContain('"routinePromptRequired": "任务指令不能为空"');
    expect(i18n).toContain('"pauseRoutine": "暂停排期"');
    expect(i18n).toContain('"resumeRoutine": "恢复排期"');
    expect(i18n).toContain('"useTemplate": "使用"');
    expect(i18n).toContain('"noRoutinesTitle": "还没有例行任务"');
    expect(i18n).toContain('"routineSourceSelfLearning": "AI 学习生成"');
    expect(i18n).toContain('"routines": "Routines"');
    expect(i18n).toContain('"newRoutine": "New routine"');
    expect(i18n).toContain('"runNow": "Run now"');
    expect(i18n).toContain('"noRoutinesTitle": "No routines yet"');
    expect(i18n).toContain('"routineTitleRequired": "Routine title is required"');
    expect(i18n).toContain('"routinePromptRequired": "Prompt instruction is required"');
    expect(i18n).toContain('"routineSourceSelfLearning": "AI Generated"');
  });

  it('keeps routines empty state quiet and vertically stacked like Review empty', async () => {
    const desktop = resolve(process.cwd(), 'desktop');
    const requireDesktop = createRequire(join(desktop, 'package.json'));
    const directory = await mkdtemp(join(tmpdir(), 'metis-routines-empty-'));
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
        </head><body class="bg-canvas">
          <div data-routines-manager class="flex h-[640px] w-[900px] flex-col">
            <div class="flex h-[50px] shrink-0 items-center justify-between px-6">
              <h1 class="text-[14px] font-medium text-ink">例行任务</h1>
              <button data-new-routine-button class="inline-flex h-[27px] items-center rounded-full bg-ink px-3 text-[13px] text-canvas">+ 新建例行任务</button>
            </div>
            <div data-routines-empty class="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div class="flex w-full max-w-[480px] flex-col items-center pb-16">
                <svg data-empty-icon width="24" height="24" class="text-ink-3" aria-hidden="true"></svg>
                <h2 data-empty-title class="mt-4 text-[14px] font-medium tracking-tight text-ink">还没有例行任务</h2>
                <p data-empty-desc class="mt-2 max-w-[360px] text-[14px] leading-6 text-ink-3">写好时间和要做的事，到点后 Metis 会自动开对话并执行。</p>
                <div class="mt-8 w-full text-left">
                  <div data-templates-label class="mb-1.5 px-3 text-[13px] text-ink-3">或从常用开始</div>
                  <div data-routine-templates class="flex flex-col">
                    <button data-routine-template="morning" class="flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left">早间</button>
                    <button data-routine-template="evening" class="flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left">下班</button>
                    <button data-routine-template="hourly" class="flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left">巡检</button>
                  </div>
                </div>
              </div>
            </div>
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
            width: 1000,
            height: 720,
            webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
          });
          try {
            await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
            const results = await window.webContents.executeJavaScript(\`
              (() => {
                const box = (selector) => {
                  const el = document.querySelector(selector);
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  const s = getComputedStyle(el);
                  return {
                    x: r.x, y: r.y, width: r.width, height: r.height,
                    fontSize: s.fontSize, fontWeight: s.fontWeight, textAlign: s.textAlign,
                    display: s.display, flexDirection: s.flexDirection,
                  };
                };
                const templates = [...document.querySelectorAll('[data-routine-template]')].map((el) => {
                  const r = el.getBoundingClientRect();
                  return { top: r.top, left: r.left, width: r.width, height: r.height };
                });
                const empty = box('[data-routines-empty]');
                const title = box('[data-empty-title]');
                const desc = box('[data-empty-desc]');
                const label = box('[data-templates-label]');
                return {
                  empty, title, desc, label, templates,
                  titleCentered: Math.abs((title.x + title.width / 2) - (empty.x + empty.width / 2)) <= 2,
                  descMaxWidth: desc.width <= 360.5,
                  templatesStacked: templates.length === 3
                    && templates[1].top > templates[0].top + 8
                    && templates[2].top > templates[1].top + 8
                    && Math.abs(templates[0].left - templates[1].left) <= 1
                    && Math.abs(templates[1].left - templates[2].left) <= 1,
                };
              })()
            \`);
            console.log('ROUTINES_EMPTY_RESULTS=' + JSON.stringify(results));
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
      const resultLine = stdout.split('\n').find((line) => line.startsWith('ROUTINES_EMPTY_RESULTS='));
      expect(resultLine).toBeDefined();
      const evidence = JSON.parse(resultLine!.slice('ROUTINES_EMPTY_RESULTS='.length));

      expect(evidence.title.fontSize).toBe('14px');
      expect(evidence.desc.fontSize).toBe('14px');
      expect(evidence.label.fontSize).toBe('13px');
      expect(evidence.titleCentered).toBe(true);
      expect(evidence.descMaxWidth).toBe(true);
      expect(evidence.templatesStacked).toBe(true);
      expect(evidence.empty.display).toBe('flex');
      expect(evidence.empty.flexDirection).toBe('column');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
