import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatExactNumber, formatTokenCount } from '../desktop/src/components/chat/TokenUsageBar';
import { toMessage } from '../desktop/src/hooks/useMetisServer';

describe('desktop token usage bar and formatting', () => {
  it('formats token counts with appropriate suffixes', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(-50)).toBe('0');
    expect(formatTokenCount(450)).toBe('450');
    expect(formatTokenCount(1200)).toBe('1.2K');
    expect(formatTokenCount(29300)).toBe('29.3K');
    expect(formatTokenCount(100000)).toBe('100K');
    expect(formatTokenCount(1048576)).toBe('1.0M');
    expect(formatTokenCount(2500000)).toBe('2.5M');
    expect(formatTokenCount(12000000)).toBe('12M');
  });

  it('formats exact numbers with comma separators', () => {
    expect(formatExactNumber(0)).toBe('0');
    expect(formatExactNumber(29300)).toMatch(/29[,.]?300/);
    expect(formatExactNumber(1000000)).toMatch(/1[,.]?000[,.]?000/);
  });

  it('extracts token usage correctly from assistant message in toMessage', () => {
    const rawAssistant = {
      id: 'asst-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Task completed.' }],
      usage: {
        input: 18200,
        output: 3100,
        cacheRead: 8000,
        cacheWrite: 0,
        totalTokens: 29300,
        cost: 0.045,
      },
    };

    const message = toMessage(rawAssistant);
    expect(message).toBeDefined();
    expect(message?.usage).toEqual({
      input: 18200,
      output: 3100,
      cacheRead: 8000,
      cacheWrite: 0,
      totalTokens: 29300,
      cost: 0.045,
    });
  });

  it('wires TokenUsageBar into Inspector and desktop component tree', () => {
    const inspector = readFileSync(resolve(process.cwd(), 'desktop/src/components/inspector/Inspector.tsx'), 'utf8');
    const tokenBar = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/TokenUsageBar.tsx'), 'utf8');

    expect(inspector).toContain('<TokenUsageBar');
    expect(inspector).toContain('contextUsage={contextUsage}');
    expect(inspector).toContain('tokenBreakdown={tokenBreakdown}');

    expect(tokenBar).toContain('formatTokenCount');
    expect(tokenBar).toContain('isHighLoad');
    expect(tokenBar).toContain('bg-blue-500');
    expect(tokenBar).toContain('bg-emerald-500');
    expect(tokenBar).toContain('bg-orange-400');
  });
});
