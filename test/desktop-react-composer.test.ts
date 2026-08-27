import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  composerTextareaHeight,
  hasComposerLineBreak,
} from '../desktop/src/lib/composer';
import { filterSkills } from '../desktop/src/components/chat/SkillPicker';

describe('desktop React multiline composer', () => {
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
      resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'),
      'utf8',
    );
    expect(source).toContain('<textarea');
    expect(source).toContain("e.key === 'Enter' && !e.shiftKey");
    expect(source).toContain('grid-rows-[minmax(44px,auto)_30px]');
    expect(source).toContain("rounded-[22px] px-3 pt-2.5 pb-2.5");
    expect(source).toContain('col-span-4 row-start-1');
    expect(source).toContain('col-start-1 row-start-2 self-end');
    expect(source).toContain('col-start-4 row-start-2 self-end');
    expect(source).toContain('grid-cols-[30px_minmax(0,1fr)_auto_30px]');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('style={{ height: composerHeight }}');
    expect(source).toContain('transition-[height,border-radius,border-color]');
    expect(source).toContain('duration-200 ease-out motion-reduce:transition-none');
    expect(source).toContain('aria-label="Send message"');
    expect(source).toContain('title="Send"');
    expect(source).toContain('data-send-icon');
    expect(source).toContain('composeAttachmentPayload(draftText, draftAttachments)');
    expect(source).toContain("(!text.trim() && attachments.length === 0)");
    expect(source).toContain('data-attachment-input');
    expect(source).toContain("fileInputRef.current?.click()");
    expect(source).not.toContain('<Mic');
    expect(source).not.toContain('Voice Input');
    expect(source).not.toContain('transition-all');
  });

  it('starts output progress locally before the server streaming state arrives', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/ChatArea.tsx'),
      'utf8',
    );
    expect(source).toContain('setLocalTaskPending(true)');
    expect(source).toContain('const result = await onSendMessage(text, options)');
    expect(source).toContain('const showActiveProgress = localTaskPending || isStreaming');
    expect(source).toContain('isStreaming={showActiveProgress}');
    expect(source).toContain('onAbort={onAbort}');
    expect(source).toContain('disabled={showActiveProgress || isLoading || isCompacting}');
    expect(source.indexOf('setLocalTaskPending(true)'))
      .toBeLessThan(source.indexOf('await onSendMessage(text, options)'));

    const composerSource = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'),
      'utf8',
    );
    expect(composerSource).toContain('data-stop-button');
    expect(composerSource).toContain('onAbort?.()');
  });

  it('filters skill commands after slash and inserts them with keyboard selection support', () => {
    expect(filterSkills([
      { name: 'make-interfaces-feel-better', description: 'Polish interface details' },
      { name: 'pdf', description: 'Inspect PDFs' },
    ], 'interface')).toEqual([{ name: 'make-interfaces-feel-better', description: 'Polish interface details' }]);

    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    expect(composer).toContain("nextText.startsWith('/') && skills.length > 0");
    expect(composer).toContain("e.key === 'ArrowDown' || e.key === 'ArrowUp'");
    expect(composer).toContain('chooseSkill(matchingSkills[Math.min(activeSkillIndex, matchingSkills.length - 1)])');
    expect(composer).toContain('setText(`/${skill.name} `)');

    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    expect(app).toContain("request<{ commands?: Array<{ name?: string; description?: string; source?: string }> }>('/commands')");
    expect(app).toContain("command.source === 'skill'");
  });

  it('keeps the scrollable message lane centered with the composer', () => {
    const messages = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MessageList.tsx'),
      'utf8',
    );
    expect(messages).toContain("style={{ scrollbarGutter: 'stable both-edges' }}");
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
    expect(composer).toContain('pointer-events-none absolute inset-x-0 bottom-0 z-20');
    expect(composer).toContain("closest<HTMLElement>('[data-purpose=\"main-chat\"]')");
    expect(composer).toContain("main.style.setProperty(");
    expect(composer).toContain("'--composer-overlay-height'");
    expect(composer).toContain('new ResizeObserver(updateOverlayHeight)');
    expect(composer).toContain('pointer-events-auto relative w-full max-w-[620px]');

    const modeSwitcher = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/ModeSwitcher.tsx'),
      'utf8',
    );
    expect(modeSwitcher).toContain('pointer-events-auto inline-flex');

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
});
