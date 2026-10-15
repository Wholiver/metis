import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Desktop white-screen prevention & error recovery system', () => {
  it('implements GlobalErrorBoundary with Beautiful UI crash recovery screen', () => {
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/common/GlobalErrorBoundary.tsx'))).toBe(true);
    const boundary = source('desktop/src/components/common/GlobalErrorBoundary.tsx');

    expect(boundary).toContain('componentDidCatch');
    expect(boundary).toContain('getDerivedStateFromError');
    expect(boundary).toContain('data-metis-error-boundary="global"');
    // Provides reload, reset/recover, and copy error details
    expect(boundary).toContain('handleReload');
    expect(boundary).toContain('handleReset');
    expect(boundary).toContain('handleCopy');
    expect(boundary).toContain('handleOpenDevTools');
    // Safeguard safe copy resolver doesn't crash even if i18n is broken
    expect(boundary).toContain('resolveSafeCopy');
  });

  it('implements ComponentErrorBoundary for isolated module/turn error containment', () => {
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/common/ComponentErrorBoundary.tsx'))).toBe(true);
    const componentBoundary = source('desktop/src/components/common/ComponentErrorBoundary.tsx');

    expect(componentBoundary).toContain('componentDidCatch');
    expect(componentBoundary).toContain('getDerivedStateFromError');
    expect(componentBoundary).toContain('data-metis-error-boundary="compact"');
    expect(componentBoundary).toContain('data-metis-error-boundary="panel"');
    expect(componentBoundary).toContain('handleReset');
  });

  it('wraps root React app in GlobalErrorBoundary and registers window error listeners', () => {
    const main = source('desktop/src/main.tsx');
    expect(main).toContain('GlobalErrorBoundary');
    expect(main).toContain('<GlobalErrorBoundary>');
    expect(main).toContain('</GlobalErrorBoundary>');
    expect(main).toContain("window.addEventListener('error'");
    expect(main).toContain("window.addEventListener('unhandledrejection'");
  });

  it('provides bootstrap fallback script in desktop/index.html to prevent initial blank screen', () => {
    const html = source('desktop/index.html');
    expect(html).toContain("window.addEventListener('error'");
    expect(html).toContain('Metis 界面加载异常');
    expect(html).toContain('window.location.reload()');
  });

  it('handles render-process-gone and unresponsive events in Electron main.cjs', () => {
    const mainCjs = source('desktop/main.cjs');
    expect(mainCjs).toContain('render-process-gone');
    expect(mainCjs).toContain('mainWindow.webContents.on("render-process-gone"');
    expect(mainCjs).toContain('mainWindow.on("unresponsive"');
    expect(mainCjs).toContain('app.on("child-process-gone"');
    expect(mainCjs).toContain('METIS_DISABLE_GPU');
    expect(mainCjs).toContain('app.disableHardwareAcceleration()');
  });

  it('binds native keyboard reload and devtools shortcuts in before-input-event', () => {
    const mainCjs = source('desktop/main.cjs');
    expect(mainCjs).toContain('before-input-event');
    expect(mainCjs).toContain('mainWindow.webContents.reload()');
    expect(mainCjs).toContain('mainWindow.webContents.reloadIgnoringCache()');
    expect(mainCjs).toContain('mainWindow.webContents.toggleDevTools()');
  });

  it('exposes reload and openDevTools in IPC and preload.cjs', () => {
    const mainCjs = source('desktop/main.cjs');
    const preload = source('desktop/preload.cjs');

    expect(mainCjs).toContain('"app:reload"');
    expect(mainCjs).toContain('"app:open-devtools"');

    expect(preload).toContain('reload: () => ipcRenderer.invoke("app:reload")');
    expect(preload).toContain('openDevTools: () => ipcRenderer.invoke("app:open-devtools")');
  });

  it('adds viewMenu to macOS application menu template in main-menu.cjs', () => {
    const menu = source('desktop/main-menu.cjs');
    expect(menu).toContain('menuView');
    expect(menu).toContain('menuReload');
    expect(menu).toContain('menuForceReload');
    expect(menu).toContain('menuToggleDevTools');
  });

  it('protects chat message turns with ComponentErrorBoundary in MessageList', () => {
    const messageList = source('desktop/src/components/chat/MessageList.tsx');
    expect(messageList).toContain('ComponentErrorBoundary');
    expect(messageList).toContain('<ComponentErrorBoundary');
    expect(messageList).toContain('turnRenderError');
  });

  it('protects chat area with ComponentErrorBoundary in ChatArea', () => {
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    expect(chatArea).toContain('ComponentErrorBoundary');
    expect(chatArea).toContain('chatAreaErrorTitle');
  });

  it('protects inspector tabs with ComponentErrorBoundary in Inspector', () => {
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    expect(inspector).toContain('ComponentErrorBoundary');
    expect(inspector).toContain('panelRenderError');
  });
});
