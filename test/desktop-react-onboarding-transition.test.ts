import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('desktop React onboarding completion cinematic transition', () => {
  it('implements OnboardingTransition coordinator and required visual elements', () => {
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/onboarding/OnboardingTransition.tsx'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/onboarding/OnboardingTransition.css'))).toBe(true);

    const transitionSource = source('desktop/src/components/onboarding/OnboardingTransition.tsx');
    expect(transitionSource).toContain('export const OnboardingTransition');
    expect(transitionSource).toContain('data-onboarding-transition');
    expect(transitionSource).toContain('data-transition-cloud');
    expect(transitionSource).toContain('onboarding-cloud-aura');
    expect(transitionSource).toContain('onboarding-landing-ripple');
    expect(transitionSource).toContain('data-tour-card="sidebar"');
    expect(transitionSource).toContain('data-tour-card="composer"');
    expect(transitionSource).toContain('data-tour-card="inspector"');
    expect(transitionSource).toContain('onboardingTourSidebarTitle');
    expect(transitionSource).toContain('onboardingTourComposerTitle');
    expect(transitionSource).toContain('onboardingTourInspectorTitle');
  });

  it('wires clearing and source rect measurement in Onboarding.tsx', () => {
    const onboardingSource = source('desktop/src/components/onboarding/Onboarding.tsx');
    expect(onboardingSource).toContain('data-onboarding-cloud');
    expect(onboardingSource).toContain('isClearing');
    expect(onboardingSource).toContain('const cloudEl = document.querySelector(');
    expect(onboardingSource).toContain('onComplete(rect)');
  });

  it('coordinates staged unveiling in App.tsx via data-onboarding-tour-stage', () => {
    const appSource = source('desktop/src/App.tsx');
    expect(appSource).toContain('OnboardingTransition');
    expect(appSource).toContain('onboardingTransitionActive');
    expect(appSource).toContain('onboardingSourceRect');
    expect(appSource).toContain('data-onboarding-tour-stage');
    expect(appSource).toContain('<OnboardingTransition');
  });

  it('defines panel entrance and exit CSS keyframes and transitions in OnboardingTransition.css', () => {
    const cssSource = source('desktop/src/components/onboarding/OnboardingTransition.css');
    expect(cssSource).toContain('[data-onboarding-tour-stage="clearing"]');
    expect(cssSource).toContain('[data-onboarding-tour-stage="flying"]');
    expect(cssSource).toContain('[data-onboarding-tour-stage="sidebar"]');
    expect(cssSource).toContain('[data-onboarding-tour-stage="composer"]');
    expect(cssSource).toContain('[data-onboarding-tour-stage="inspector"]');
    expect(cssSource).toContain('[data-onboarding-tour-stage="settling"]');
    expect(cssSource).toContain('onboarding-landing-ripple');
    expect(cssSource).toContain('onboarding-tour-card');
    expect(cssSource).toContain('[data-chat-header]');
    expect(cssSource).toContain('[data-message-scroll]');
  });

  it('includes bilingual translations in generated i18n catalogs', () => {
    const catalogs = source('desktop/src/i18n-catalogs.cjs');
    expect(catalogs).toContain('onboardingTourSidebarTitle');
    expect(catalogs).toContain('onboardingTourComposerTitle');
    expect(catalogs).toContain('onboardingTourInspectorTitle');
    expect(catalogs).toContain('侧边栏 · 导航与管理');
    expect(catalogs).toContain('对话中心 · 智能双脑');
    expect(catalogs).toContain('审查面板 · 实时协同');
  });
});
