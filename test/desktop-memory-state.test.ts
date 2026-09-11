import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Desktop unified memory state', () => {
  const settings = read('desktop/src/components/settings/SettingsDialog.tsx');
  const hook = read('desktop/src/hooks/useMetisServer.ts');

  it('connects session defaults and retry controls to typed Server state', () => {
    expect(settings).toContain("props.request<Record<string, any>>('/settings/defaults')");
    expect(settings).toContain("props.request('/session/settings', 'PUT'");
    expect(settings).toContain('autoRetryEnabled');
    expect(settings).toContain('setDefaults(nextDefaults || {})');
  });

  it('keeps project trust and Provider credentials connected', () => {
    expect(settings).toContain("command: '/trust'");
    expect(settings).toContain("command(`/trust ${e.target.value || 'clear'}`)");
    expect(settings).toContain('handleApiKeyLogin');
    expect(settings).toContain('handleOAuthLogin');
    expect(settings).toContain('handleRemoveCredential');
  });

  it('uses typed MemoryState without a persistent chat indicator', () => {
    expect(hook).toContain("type === 'memory_state_changed'");
    expect(hook).toContain('setMemoryState(nextMemoryState)');
    expect(settings).toContain('memoryState?: MemoryState');
    expect(read('desktop/src/components/chat/ChatArea.tsx')).not.toContain('renderDreamCardPresentation');
  });

  it('keeps memory controls with explicit in-app destructive approval', () => {
    expect(settings).toContain("props.request('/memory/settings', 'PUT'");
    expect(settings).toContain("props.request('/memory/run', 'POST'");
    expect(settings).toContain("props.request('/memory/reset', 'POST', { confirm: 'RESET_MEMORY' })");
    expect(settings).toContain('<ApprovalDialog');
    expect(settings).not.toMatch(/window\.(confirm|prompt)\(/);
  });

  it('keeps manual extraction single-flight and renders failures', () => {
    expect(settings).toContain("currentMemory.phase === 'extracting'");
    expect(settings).toContain('disabled={disabled || isConsolidating}');
    expect(settings).toContain('currentMemory.error');
    expect(settings).toContain('Last failure:');
  });
});
