import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('desktop React starter prompts scaffolding', () => {
  it('creates StarterPrompts component with unboxed three-line action layout', () => {
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/chat/StarterPrompts.tsx'))).toBe(true);

    const starterPrompts = source('desktop/src/components/chat/StarterPrompts.tsx');
    expect(starterPrompts).toContain('data-starter-prompts');
    expect(starterPrompts).toContain('data-starter-prompt-item');
    // Ensure no heavy borders or card container styling
    expect(starterPrompts).not.toContain('border-line');
    expect(starterPrompts).not.toContain('shadow-card');
    // Supports 3 rows with dynamic git awareness
    expect(starterPrompts).toContain('hasGitChanges');
    expect(starterPrompts).toContain('starterPromptReviewTitle');
    expect(starterPrompts).toContain('starterPromptArchTitle');
    expect(starterPrompts).toContain('starterPromptBugsTitle');
    expect(starterPrompts).toContain('starterPromptTestsTitle');
    // Smooth fade transition when visible is toggled
    expect(starterPrompts).toContain('opacity-100');
    expect(starterPrompts).toContain('opacity-0 pointer-events-none');
  });

  it('wires StarterPrompts into Composer above input and binds select handler', () => {
    const composer = source('desktop/src/components/chat/Composer.tsx');
    expect(composer).toContain('<StarterPrompts');
    expect(composer).toContain('hasGitChanges={hasGitChanges}');
    expect(composer).toContain('visible={isHomeEmpty && text.trim().length === 0}');
    expect(composer).toContain('onSelectPrompt={handleSelectStarterPrompt}');

    // Located between cloud mark and composer dock stack
    expect(composer.indexOf('data-home-cloud-slot')).toBeLessThan(composer.indexOf('<StarterPrompts'));
    expect(composer.indexOf('<StarterPrompts')).toBeLessThan(composer.indexOf('data-composer-dock-stack'));

    // Focuses textarea and places cursor at end
    expect(composer).toContain('inputRef.current.setSelectionRange');
    expect(composer).toContain('workspace?.gitStatus');
  });

  it('includes i18n keys across all supported locales', () => {
    const i18nSource = source('desktop/i18n-source.cjs');
    expect(i18nSource).toContain('"starterPromptReviewTitle"');
    expect(i18nSource).toContain('"starterPromptArchTitle"');
    expect(i18nSource).toContain('"starterPromptBugsTitle"');
    expect(i18nSource).toContain('"starterPromptTestsTitle"');
  });
});
