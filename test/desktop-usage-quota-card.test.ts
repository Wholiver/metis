import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('desktop usage quota card', () => {
  it('keeps UsageQuotaCard component capabilities without Inspector footer wiring', () => {
    const inspector = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/Inspector.tsx'), 'utf8');
    const quotaCard = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/UsageQuotaCard.tsx'), 'utf8');

    expect(inspector).not.toContain('UsageQuotaCard');
    expect(inspector).not.toContain('data-usage-panel');
    expect(inspector).not.toContain('h-[108px]');
    expect(quotaCard).toContain('isOAuth');
    expect(quotaCard).toContain('totalCost');
    expect(quotaCard).toContain('quota5h');
    expect(quotaCard).toContain('quota7d');
  });

  it('contains dual-mode API Key spend and OAuth hollow circular rings', () => {
    const quotaCard = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/UsageQuotaCard.tsx'), 'utf8');

    // OAuth Hollow circular rings
    expect(quotaCard).toContain('HollowRingProgress');
    expect(quotaCard).toContain('strokeDasharray');
    expect(quotaCard).toContain('strokeDashoffset');
    expect(quotaCard).toContain('5h');
    expect(quotaCard).toContain('7d');
    expect(quotaCard).toContain('isCritical');
    expect(quotaCard).toContain('text-red');

    // API Key total spend and breakdown bars
    expect(quotaCard).toContain('data-usage-card="api_key"');
    expect(quotaCard).toContain('data-usage-card="oauth"');
    expect(quotaCard).toContain('inputRatio');
    expect(quotaCard).toContain('cacheRatio');
    expect(quotaCard).toContain('outputRatio');
  });

  it('supports initial 0% unconsumed state and critical 95% threshold', () => {
    const quotaCard = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/UsageQuotaCard.tsx'), 'utf8');

    expect(quotaCard).toContain('unconsumed');
    expect(quotaCard).toContain('clampedPercent >= 95');
  });

  it('keeps compact UsageQuotaCard height for potential reuse outside Inspector', () => {
    const quotaCard = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/UsageQuotaCard.tsx'), 'utf8');
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    const inspector = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/Inspector.tsx'), 'utf8');

    // UsageQuotaCard container height
    expect(quotaCard).toContain('h-[72px]');
    // Composer default height
    expect(composer).toContain('<ComposerUsageFooter');
    // Inspector no longer hosts the 108px usage footer
    expect(inspector).not.toContain('h-[108px]');
    expect(inspector).not.toContain('UsageQuotaCard');
    expect(inspector).not.toContain('divide-y');
  });

  it('renders a 7-day usage sparkline line chart with Catmull-Rom curve and gradient in API Key mode', () => {
    const quotaCard = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/UsageQuotaCard.tsx'), 'utf8');

    // Sparkline SVG structure
    expect(quotaCard).toContain('apiKeySparklineGrad');
    expect(quotaCard).toContain('viewBox="0 0 160 28"');
    expect(quotaCard).toContain('data-usage-side="trend"');
    expect(quotaCard).toContain('usageTrend');

    // Smooth Bezier path calculation
    expect(quotaCard).toContain('linePath');
    expect(quotaCard).toContain('areaPath');
    expect(quotaCard).toContain('hoveredPointIndex');
  });
});
