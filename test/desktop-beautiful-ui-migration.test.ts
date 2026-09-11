import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Desktop Beautiful UI migration', () => {
  it('uses one Beautiful UI token foundation with light and dark themes', () => {
    const foundation = source('desktop/src/styles/beautifului/foundation.css');
    for (const token of [
      '--page:', '--canvas:', '--surface:', '--ink:', '--line:', '--accent:', '--radius-card:', '--shadow-card:',
      '--color-background:', '--color-foreground:', '--color-card:', '--color-muted:', '--color-muted-foreground:', '--color-border:', '--color-ring:',
    ]) {
      expect(foundation).toContain(token);
    }
    expect(foundation).toContain('.dark {');
    expect(foundation).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('ships official registry-derived primitives locally', () => {
    const primitives = [
      'ApprovalCard', 'CodeBlock', 'ContextCards', 'GlideMenu', 'LoadingState',
      'PromptBar', 'RecommendationCard', 'SearchList', 'SidebarNav', 'StreamingText',
      'TaskRows', 'ThinkingState', 'ToolChips', 'AgentScreen',
    ];
    for (const name of primitives) {
      const file = source(`desktop/src/components/primitives/${name}.tsx`);
      expect(file).toContain('beautifului.dev/r/');
      expect(file).toContain('MIT License');
    }
  });

  it('routes active chat surfaces through selected Beautiful UI primitives', () => {
    expect(source('desktop/src/components/chat/Composer.tsx')).toContain('<PromptBar');
    expect(source('desktop/src/components/chat/AssistantTurn.tsx')).toContain('<AssistantWork');
    expect(source('desktop/src/components/chat/AssistantTurn.tsx')).toContain('<AgentBubble');
    expect(source('desktop/src/components/chat/PlanPreview.tsx')).toContain('<RecommendationCard');
    expect(source('desktop/src/components/inspector/PlanPoints.tsx')).toContain('<TaskRows');
    expect(source('desktop/src/components/inspector/PlanPoints.tsx')).toContain('expandable={false}');
    expect(source('desktop/src/components/chat/FileCard.tsx')).toContain('<ContextCards');
    expect(source('desktop/src/components/chat/MessageList.tsx')).toContain('<LoadingState');
  });

  it('keeps brand cloud on home empty and removes composer work-progress row', () => {
    const composer = source('desktop/src/components/chat/Composer.tsx');
    const ask = source('desktop/src/components/chat/UserInputCard.tsx');
    expect(composer).toContain('<MetisCloudMark');
    expect(composer).not.toContain('WorkProgressIndicator');
    expect(composer).not.toContain('data-composer-progress-slot');
    expect(ask).not.toContain('WorkProgressIndicator');
    expect(ask).not.toContain('data-composer-progress-slot');
    expect(existsSync(resolve(root, 'desktop/src/components/chat/CloudAvatar.tsx'))).toBe(false);
  });

  it('uses in-app approval panels instead of browser dialogs', () => {
    const desktopSources = [
      source('desktop/src/components/settings/SettingsDialog.tsx'),
      source('desktop/src/components/ExtensionUiDialog.tsx'),
    ].join('\n');
    expect(desktopSources).not.toMatch(/window\.(prompt|confirm|alert)\s*\(/);
    expect(source('desktop/src/components/settings/SettingsDialog.tsx')).toContain('<ApprovalDialog');
  });

  it('aligns Settings composition with Beautiful UI primitives', () => {
    const settings = source('desktop/src/components/settings/SettingsDialog.tsx');
    expect(settings).toContain('from \'../atoms/Button\'');
    expect(settings).toContain('from \'../atoms/ValuePill\'');
    expect(settings).toContain('from \'../primitives/GlideMenu\'');
    expect(settings).toContain('shadow-overlay');
    expect(settings).toContain('rounded-window');
    expect(settings).toContain('rounded-card');
    expect(settings).toContain('shadow-inset-field');
    expect(settings).not.toContain('positionIndicatorOnTab');
    expect(settings).not.toContain('ResizeObserver');
  });

  it('keeps stable message and inspector identities', () => {
    expect(source('desktop/src/components/chat/ToolCard.tsx')).toContain('data-part-key={part.id}');
    expect(source('desktop/src/components/chat/MessageList.tsx')).toContain('key: `turn-${message.id}`');
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    expect(inspector).toContain('data-inspector-tab-id={tab.id}');
    expect(inspector).toContain("event.key === 'ArrowLeft'");
    expect(inspector).toContain('draggable');
  });

  it('uses an opaque native shell synchronized to official surfaces', () => {
    const main = source('desktop/main.cjs');
    expect(main).toContain('transparent: false');
    expect(main).not.toContain('vibrancy:');
    expect(main).not.toContain('visualEffectState:');
    expect(main).toContain('mainWindow.setBackgroundColor(nextShell.page)');
    expect(main).toContain('color: nextShell.canvas');
  });

  it('removes obsolete duplicate and plain-script renderer sources', () => {
    for (const path of [
      'desktop/src/App 2.tsx', 'desktop/src/index 2.css', 'desktop/renderer/app.js',
      'desktop/renderer/styles.css', 'desktop/renderer/message-turns.js',
    ]) {
      expect(existsSync(resolve(root, path))).toBe(false);
    }
  });

  it('contains no transition surface bridge or legacy Tailwind palette in active TSX', () => {
    const files = [
      'desktop/src/components/chat/ChatArea.tsx',
      'desktop/src/components/chat/Composer.tsx',
      'desktop/src/components/sidebar/Sidebar.tsx',
      'desktop/src/components/inspector/Inspector.tsx',
      'desktop/src/components/settings/SettingsDialog.tsx',
    ];
    const active = files.map(source).join('\n');
    expect(source('desktop/src/index.css')).not.toContain('--surface-workspace');
    expect(active).not.toMatch(/(?:slate|gray|zinc|neutral|stone|emerald|blue|rose|indigo|sky|violet|amber)-[0-9]/);
  });
});
