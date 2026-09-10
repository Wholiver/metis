import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React collaboration mode switching', () => {
  it('integrates Plan and Build mode switching through slash command menu and preserves clean composer layout', () => {
    const switcher = source('desktop/src/components/chat/ModeSwitcher.tsx');
    const composer = source('desktop/src/components/chat/Composer.tsx');
    const skillPicker = source('desktop/src/components/chat/SkillPicker.tsx');

    expect(switcher).toContain('role="radiogroup"');
    expect(switcher).toContain('role="radio"');
    expect(switcher).toContain('aria-checked={selected}');
    expect(switcher).toContain("label: 'Plan'");
    expect(switcher).toContain("label: 'Build'");
    expect(switcher).toContain('h-7 min-w-[64px]');
    expect(switcher).toContain('rounded-control bg-field p-0.5 shadow-inset-field');
    expect(switcher).toContain('before:h-10 before:w-full');
    expect(switcher).toContain("color: 'var(--orange)'");
    expect(switcher).toContain("color: 'var(--green)'");
    expect(switcher).toContain('shadow: \'var(--shadow-btn)\'');
    expect(switcher).toContain('font-medium');
    expect(switcher).not.toContain('font-[530]');
    expect(switcher).not.toContain('font-semibold');
    expect(switcher).not.toContain('transition-all');

    // ModeSwitcher button row positioned above form
    expect(composer.indexOf('<ModeSwitcher')).toBeLessThan(composer.indexOf('<PromptBar'));
    expect(composer).toContain('data-mode-switcher-row');
    expect(composer).toContain('max-w-[620px] justify-start" data-mode-switcher-row');

    // Skill picker is dedicated to skills; faint elevation below composer shadow
    expect(skillPicker).toContain('data-skill-picker');
    expect(skillPicker).toContain('Sparkles');
    expect(skillPicker).toContain('rounded-window bg-surface');
    expect(skillPicker).toContain('shadow-overlay');
    expect(skillPicker).not.toContain('shadow-none');

    // Composer container styling — soft floating shadow matches elevated input chrome
    expect(composer).toContain('data-composer-shell');
    expect(composer).toContain('<PromptBar');
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
