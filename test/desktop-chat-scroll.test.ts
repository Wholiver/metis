import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const desktop = resolve(process.cwd(), 'desktop');
const requireDesktop = createRequire(join(desktop, 'package.json'));

it('keeps the Electron chat at the bottom without interrupting history reading', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metis-chat-scroll-'));
  try {
    const { build } = requireDesktop('esbuild');
    await build({
      entryPoints: [resolve(process.cwd(), 'test/fixtures/desktop-chat-scroll.tsx')],
      outfile: join(directory, 'fixture.js'),
      bundle: true,
      platform: 'browser',
      nodePaths: [join(desktop, 'node_modules')],
      alias: {
        react: join(desktop, 'node_modules/react'),
        'react-dom': join(desktop, 'node_modules/react-dom'),
      },
      define: { 'process.env.NODE_ENV': '"development"' },
    });
    const postcss = requireDesktop('postcss');
    const tailwind = requireDesktop('tailwindcss');
    const { css } = await postcss([tailwind({
      content: [join(desktop, 'src/**/*.{js,ts,jsx,tsx}')],
    })]).process(await readFile(join(desktop, 'src/index.css'), 'utf8'), { from: undefined });
    await writeFile(join(directory, 'fixture.css'), css);
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head>
      <link rel="stylesheet" href="fixture.css">
      <style>*, *::before, *::after { animation: none !important; transition: none !important; }</style>
      </head><body><div id="root" style="height:600px"></div><script src="fixture.js"></script></body></html>`);
    await writeFile(join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, width: 1000, height: 900,
          webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
        window.webContents.on('console-message', (event) => console.error(event.message));
        try {
          await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
          const results = await window.webContents.executeJavaScript('window.runScrollChecks()');
          console.log('SCROLL_RESULTS=' + JSON.stringify(results));
          app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
      });
    `);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(requireDesktop('electron'), [join(directory, 'main.cjs')], {
      env, timeout: 25_000, maxBuffer: 1024 * 1024,
    });
    const resultLine = stdout.split('\n').find((line) => line.startsWith('SCROLL_RESULTS='));
    expect(resultLine).toBeDefined();
    const evidence = JSON.parse(resultLine!.slice('SCROLL_RESULTS='.length));
    expect(evidence.length).toBeGreaterThanOrEqual(20);
    console.log(JSON.stringify(evidence));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
