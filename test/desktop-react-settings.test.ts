import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLocalizedSource, splitSurroundingWhitespace } from '../desktop/src/lib/i18n-state';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React settings', () => {
  it('opens the current React settings dialog from the sidebar', () => {
    const sidebar = source('desktop/src/components/sidebar/Sidebar.tsx');
    const app = source('desktop/src/App.tsx');
    expect(sidebar).toContain('onOpenSettings');
    expect(app).toContain('<SettingsDialog');
    expect(app).toContain('onOpenSettings={() => setIsSettingsOpen(true)}');
  });

  it('retains every former settings category and wires stateful options to the Server bridge', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    const main = source('desktop/main.cjs');
    for (const tab of ['general', 'model', 'agent', 'server', 'about']) {
      expect(settings).toContain(`id: '${tab}'`);
    }
    for (const legacyTab of ['shortcuts', 'security', 'session']) {
      expect(settings).toContain(`${legacyTab}:`);
    }
    for (const endpoint of ['/settings/defaults', '/session/settings', '/memory/settings', '/memory/run', '/memory/reset', '/session/name', '/session/compact']) {
      expect(settings).toContain(endpoint);
    }
    expect(settings).toContain("command('/reload')");
    expect(settings).toContain('providerConfig?.saveCustom');
    expect(settings).toContain('providerConfig?.discoverModels');
    expect(settings).toContain('role="dialog"');
    expect(settings).toContain("event.key === 'Escape'");
    expect(settings).toContain('requireDesktop');
    expect(settings).toContain("command: '/language'");
    expect(settings).toContain('languageOptions.map');
    expect(settings).toContain('role="switch"');
    expect(settings).not.toContain('onUpdateProject');
    expect(main).toContain('desktop-preferences.json');
    expect(main).toContain('saveDesktopPreferences()');
    expect(main).toContain('language: desktopLanguage');
    expect(main).toContain('theme: desktopTheme');
  });

  it('removes unsupported appearance controls and keeps Desktop-only settings usable while disconnected', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    expect(settings).not.toContain('label="Appearance"');
    expect(settings).not.toContain('desktop?.setUiTheme');
    expect(settings.indexOf('desktop?.appInfo?.()')).toBeLessThan(settings.indexOf('if (!props.isConnected) return'));
    expect(settings).toContain('disabled={desktopDisabled}>{languageOptions.map');
  });

  it('connects settings through authoritative React state and reconnects SSE for a changed Server', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    const app = source('desktop/src/App.tsx');
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    const preload = source('desktop/preload.cjs');
    const main = source('desktop/main.cjs');
    expect(preload).toContain('getConnection: () => ipcRenderer.invoke("metis:get-connection")');
    expect(main).toContain('ipcMain.handle("metis:get-connection"');
    expect(main).toContain('const health = await metisRequest("/global/health", {}, candidate)');
    expect(main).toContain('if (!health.ok) return health');
    expect(main).toContain('if (changed || !metisEventController');
    expect(hook).toContain('const connectServer = useCallback');
    expect(hook).toContain('setIsConnected(true)');
    expect(app).toContain('onConnectServer={connectServer}');
    expect(settings).toContain('await props.onConnectServer');
  });

  it('wires migrated Provider, OAuth, Memory, workspace, and transfer controls end to end', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    const app = source('desktop/src/App.tsx');
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    const main = source('desktop/main.cjs');
    expect(settings).toContain("command: '/logout'");
    expect(settings).toContain('providers={credentialProviders}');
    expect(settings).toContain('providerId: provider.providerId || provider.provider');
    expect(settings).toContain('value={providerForm.name || \'\'}');
    expect(settings).toContain('providerConfig.saveCustom(providerForm)');
    expect(settings).toContain('providerConfig.deleteCustom(providerForm.providerId!)');
    expect(settings).toContain("desktop.openExternal(result.url)");
    expect(settings).toContain("if (!file) return false");
    expect(settings).toContain("if (!target) return false");
    expect(settings).toContain('<option value="" disabled>Choose model</option>');
    expect(settings).not.toContain('<option value="">Off</option>');
    expect(settings).toContain("disabled={disabled || !sessionName.trim()}");
    expect(settings).toContain("disabled={!props.isConnected || saving || !providerForm.name?.trim()");
    expect(app).toContain('onChangeWorkspace={handleChangeWorkspace}');
    expect(hook).toContain("type === 'extension_ui_request'");
    expect(hook).toContain("request('/extension/ui-response', 'POST', response)");
    expect(main).toContain('["GET", "POST", "PUT", "DELETE"]');
  });

  it('advertises only implemented shortcuts', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    const app = source('desktop/src/App.tsx');
    expect(settings).toContain("['New task', '⌘ N']");
    expect(app).toContain("event.key.toLowerCase() !== 'n'");
    expect(app).toContain('void newConversation()');
  });

  it('refreshes the authoritative session snapshot after settings mutations', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain('const refresh = useCallback');
    expect(hook).toContain('request,');
    expect(hook).toContain('refresh,');
  });

  it('does not reuse a translated heading after React switches settings panels', () => {
    expect(resolveLocalizedSource('Server & workspace', { source: 'General', rendered: '常规' })).toBe('Server & workspace');
    expect(resolveLocalizedSource('General', { source: 'Server & workspace', rendered: '服务器与工作区' })).toBe('General');
    expect(resolveLocalizedSource('常规', { source: 'General', rendered: '常规' })).toBe('General');
    expect(splitSurroundingWhitespace(' of ')).toEqual({ leading: ' ', text: 'of', trailing: ' ' });
  });

  it('renders live memory progress, stop control, and connects ChatHeader memory pill to settings', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    const header = source('desktop/src/components/chat/ChatHeader.tsx');
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const app = source('desktop/src/App.tsx');
    const hook = source('desktop/src/hooks/useMetisServer.ts');

    // SettingsDialog progress and stop
    expect(settings).toContain("isConsolidating");
    expect(settings).toContain("props.request('/memory/abort', 'POST')");
    expect(settings).toContain("Extracting checkpoints");
    expect(settings).toContain("Consolidating & saving records…");
    expect(settings).toContain("progressPercent");

    // ChatHeader live pill
    expect(header).toContain("memoryState?.phase === 'extracting'");
    expect(header).toContain("onOpenMemorySettings");
    expect(chatArea).toContain("onOpenMemorySettings={onOpenMemorySettings}");
    expect(app).toContain("onOpenMemorySettings={handleOpenMemorySettings}");
    expect(app).toContain("setSettingsTab('agent')");

    // Hook SSE & abort method
    expect(hook).toContain("type === 'memory_state_changed'");
    expect(hook).toContain("request<MemoryState>('/memory/abort', 'POST')");
    expect(hook).toContain("metis:memory-finished");

    // Toast notification
    expect(app).toContain("metis:memory-finished");
    expect(app).toContain("Memory consolidation completed:");
  });

  it('renders Concurrency strategy options and binds them to session settings', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    expect(settings).toContain('label="Concurrency strategy"');
    expect(settings).toContain("value={session.concurrencyStrategy || 'tokensaver'}");
    expect(settings).toContain("concurrencyStrategy: e.target.value");
    expect(settings).toContain('value="tokensaver"');
    expect(settings).toContain('value="wide"');
    expect(settings).toContain('value="custom"');
    expect(settings).toContain('label="Concurrency limit"');
  });
});


