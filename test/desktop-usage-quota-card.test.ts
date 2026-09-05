import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('desktop usage quota card', () => {
  it('wires UsageQuotaCard into Inspector directly above TokenUsageBar', () => {
    const inspector = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/Inspector.tsx'), 'utf8');

    expect(inspector).toContain('<UsageQuotaCard');
    expect(inspector).toContain('isOAuth={isOAuth}');
    expect(inspector).toContain('totalCost={totalCost}');
    expect(inspector).toContain('quota5h={quota5h}');
    expect(inspector).toContain('quota7d={quota7d}');

    const quotaIndex = inspector.indexOf('<UsageQuotaCard');
    const tokenBarIndex = inspector.indexOf('<TokenUsageBar');
    expect(quotaIndex).toBeGreaterThan(-1);
    expect(tokenBarIndex).toBeGreaterThan(-1);
    expect(quotaIndex).toBeLessThan(tokenBarIndex);
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
    expect(quotaCard).toContain('text-rose-600');

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

  it('uses compact h-[72px] height to align Inspector footer (72px + 8px gap + 28px bar = 108px) with Composer', () => {
    const quotaCard = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/UsageQuotaCard.tsx'), 'utf8');
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');

    // UsageQuotaCard container height
    expect(quotaCard).toContain('h-[72px]');
    // Composer default height
    expect(composer).toContain('108 + attachmentsHeight');
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
