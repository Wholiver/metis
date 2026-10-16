import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Sidebar } from '../desktop/src/components/sidebar/Sidebar';
import { RemotePathModal } from '../desktop/src/components/workspace/RemotePathModal';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

describe('desktop Remote Workspace & Web UI integration', () => {
  it('renders Remote pill badge on remote projects in Sidebar', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agents: [],
        activeAgentId: '',
        width: 240,
        onSelectAgent: () => undefined,
        projects: [
          { id: '/local/path', name: 'Local App', path: '/local/path', isRemote: false },
          { id: '/remote/linux/srv', name: 'Linux Server', path: '/remote/linux/srv', isRemote: true },
        ],
        activeProjectId: '/remote/linux/srv',
      })
    );

    expect(markup).toContain('Linux Server');
    expect(markup).toContain('Remote');
    expect(markup).toContain('Local App');
  });

  it('renders RemotePathModal when open', () => {
    const markup = renderToStaticMarkup(
      React.createElement(RemotePathModal, {
        isOpen: true,
        onClose: () => undefined,
        onSelect: () => undefined,
        initialPath: '/home/ubuntu/project',
      })
    );

    expect(markup).toContain('data-remote-path-modal=""');
    expect(markup).toContain('/home/ubuntu/project');
  });

  it('does not render RemotePathModal when closed', () => {
    const markup = renderToStaticMarkup(
      React.createElement(RemotePathModal, {
        isOpen: false,
        onClose: () => undefined,
        onSelect: () => undefined,
      })
    );

    expect(markup).toBe('');
  });

  it('mounts RemotePathModal in App.tsx and guards workspace actions when remote', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(appSource).toContain("import { RemotePathModal } from './components/workspace/RemotePathModal'");
    expect(appSource).toContain('<RemotePathModal');
    expect(appSource).toContain('isRemoteModalOpen');
    expect(appSource).toContain('isRemoteServer');
    expect(appSource).toContain('if (isRemoteServer) {');
    expect(appSource).toContain('setIsRemoteModalOpen(true)');
  });

  it('provides web-bridge shim in desktop/src/lib/web-bridge.ts', () => {
    const bridgeSource = readFileSync(resolve(process.cwd(), 'desktop/src/lib/web-bridge.ts'), 'utf8');

    expect(bridgeSource).toContain('export function initWebDesktopBridge');
    expect(bridgeSource).toContain('isRemote: async () => true');
    expect(bridgeSource).toContain('validate: async');
  });

  it('forwards workspace operations to server API when remote in main.cjs', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');

    expect(mainSource).toContain('ipcMain.handle("workspace:is-remote"');
    expect(mainSource).toContain('ipcMain.handle("workspace:validate"');
    expect(mainSource).toContain('metisRequest("/workspace/validate"');
    expect(mainSource).toContain('metisRequest(`/workspace/tree');
    expect(mainSource).toContain('metisRequest(`/workspace/file');
    expect(mainSource).toContain('metisRequest(`/workspace/git-info');
    expect(mainSource).toContain('metisRequest(`/workspace/git-status');
    expect(mainSource).toContain('metisRequest(`/workspace/git-diff');
  });
});
