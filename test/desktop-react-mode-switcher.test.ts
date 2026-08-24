import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React collaboration mode switcher', () => {
  it('renders an accessible Plan and Build selector above the composer', () => {
    const switcher = source('desktop/src/components/chat/ModeSwitcher.tsx');
    const composer = source('desktop/src/components/chat/Composer.tsx');

    expect(switcher).toContain('role="radiogroup"');
    expect(switcher).toContain('role="radio"');
    expect(switcher).toContain('aria-checked={selected}');
    expect(switcher).toContain("label: 'Plan'");
    expect(switcher).toContain("label: 'Build'");
    expect(switcher).toContain('h-7 min-w-[64px]');
    expect(switcher).toContain('h-8 items-center gap-0 rounded-xl bg-[#eef2f6] p-0.5');
    expect(switcher).toContain('shadow-[0_0_0_1px_rgba(215,222,232,0.9),0_1px_2px_rgba(15,23,42,0.08)]');
    expect(switcher).toContain('rounded-[12px]');
    expect(switcher).toContain('before:h-10 before:w-full');
    expect(switcher).toContain("bg-[#5b7198] text-white");
    expect(switcher).toContain("text-[#586e90] hover:bg-white/70");
    expect(switcher).toContain("bg-[#567a70] text-white");
    expect(switcher).toContain("text-[#4f7068] hover:bg-white/70");
    expect(switcher).not.toContain("bg-[#172033]");
    expect(switcher).not.toContain("bg-[#f3f6f9]");
    expect(switcher).toContain('shadow-[0_1px_3px_rgba');
    expect(switcher).toContain('font-semibold');
    expect(switcher).not.toContain('transition-all');
    expect(composer.indexOf('<ModeSwitcher')).toBeLessThan(composer.indexOf('<form'));
    expect(composer).toContain('data-mode-switcher-row');
    expect(composer).toContain('max-w-[620px] justify-start" data-mode-switcher-row');
    expect(composer).toContain('data-composer-shell');
    expect(composer).toContain('overflow-hidden bg-white border');
    expect(composer).toContain("'border-slate-200/90'");
    expect(composer).toContain('w-full bg-transparent');
    expect(composer).not.toContain('shadow-[0_4px_18px');
    expect(composer).not.toContain('focus-within:shadow-md');
  });

  it('uses the authoritative Server snapshot and live mode event', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain("request<SessionState>('/session/collaboration-mode', 'PUT', { mode })");
    expect(hook).toContain('setCollaborationMode(state.collaborationMode || mode)');
    expect(hook).toContain("type === 'collaboration_mode_changed'");
    expect(hook).toContain('setCollaborationMode(event.mode)');
    expect(hook).toContain("if (!await selectCollaborationMode('build')) return false");
  });

  it('wires mode state and busy state through App, ChatArea, and Composer', () => {
    const app = source('desktop/src/App.tsx');
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const main = source('desktop/main.cjs');
    expect(app).toContain('onSelectCollaborationMode={selectCollaborationMode}');
    expect(app).toContain('isChangingCollaborationMode={isChangingCollaborationMode}');
    expect(chatArea).toContain('onSelectCollaborationMode={onSelectCollaborationMode}');
    expect(chatArea).toContain('disabled={showActiveProgress || isLoading || isCompacting}');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_MODE_SWITCHER');
    expect(main).toContain('[capture:mode-switcher]');
    expect(main).toContain('smallerThanComposer');
    expect(main).toContain('leftAlignedWithComposer');
    expect(main).toContain('optionBackgroundColors');
    expect(main).toContain('optionBorderColors');
  });
});
