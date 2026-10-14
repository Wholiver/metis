import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from '../desktop/src/i18n-catalogs.cjs';

describe('desktop react self learning badge and tooltip', () => {
  it('provides bilingual self-learning beta badge and tooltip in i18n catalogs', () => {
    expect(i18n['zh-CN'].selfLearningBetaBadge).toBe('测试');
    expect(i18n['zh-CN'].selfLearningBetaTooltip).toBe('测试功能，可能存在不稳定性');
    expect(i18n.en.selfLearningBetaBadge).toBe('Beta');
    expect(i18n.en.selfLearningBetaTooltip).toBe('Experimental feature, may be unstable');
  });

  it('defines SelfLearningBadge component with Info icon and floating tooltip', () => {
    const component = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/atoms/SelfLearningBadge.tsx'),
      'utf8',
    );
    expect(component).toContain('export function SelfLearningBadge');
    expect(component).toContain('selfLearningBetaBadge');
    expect(component).toContain('selfLearningBetaTooltip');
    expect(component).toContain('role="tooltip"');
    expect(component).toContain('data-self-learning-badge');
    expect(component).toContain('Info');
  });

  it('integrates SelfLearningBadge in RoutinesManager for learned routines', () => {
    const manager = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/routines/RoutinesManager.tsx'),
      'utf8',
    );
    expect(manager).toContain('SelfLearningBadge');
    expect(manager).toContain("routine.source === 'self_learning'");
    expect(manager).toContain('data-routine-source="self_learning"');
  });

  it('integrates SelfLearningBadge in RoutineEditModal when editing learned routine', () => {
    const modal = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/routines/RoutineEditModal.tsx'),
      'utf8',
    );
    expect(modal).toContain('SelfLearningBadge');
    expect(modal).toContain("editingRoutine?.source === 'self_learning'");
  });

  it('integrates SelfLearningBadge across all self-learning sections in SettingsDialog', () => {
    const settings = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/settings/SettingsDialog.tsx'),
      'utf8',
    );
    expect(settings).toContain('SelfLearningBadge');
    // 1. Sidebar tab navigation for Self-Learning
    expect(settings).toContain("item.id === 'adaptations'");
    // 2. Main self-learning header row
    expect(settings).toContain("translate('selfLearning')");
    // 3. User Preferences Profile card and traits
    expect(settings).toContain("translate('selfLearningPreferences')");
    // 4. Agent Architecture Evolution header and items (Playbooks, Workflows, Tools)
    expect(settings).toContain("translate('selfLearningArchitecture')");
    expect(settings).toContain('pb.name');
    expect(settings).toContain('mw.name');
    expect(settings).toContain('tool.name');
    // 5. Learned Adaptations list header and cards
    expect(settings).toContain("translate('learnedAdaptations')");
    expect(settings).toContain('getAdaptationDisplayName(item)');
  });

  it('integrates SelfLearningBadge in ChatHeader when learned summary notification appears', () => {
    const chatHeader = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/ChatHeader.tsx'),
      'utf8',
    );
    expect(chatHeader).toContain('SelfLearningBadge');
    expect(chatHeader).toContain('learningProgress.learnedSummary');
  });

  it('integrates SelfLearningBadge in Onboarding for Self-Learning feature card', () => {
    const onboarding = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/onboarding/Onboarding.tsx'),
      'utf8',
    );
    expect(onboarding).toContain('SelfLearningBadge');
    expect(onboarding).toContain("translateExact('Self-Learning', language)");
  });
});
