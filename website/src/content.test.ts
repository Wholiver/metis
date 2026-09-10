import { describe, expect, it } from 'vitest';
import { copy, INSTALL_COMMAND, LINKS } from './content';

describe('site content contracts', () => {
  it('keeps English and Chinese structures aligned', () => {
    expect(copy.en.harness.roles).toHaveLength(4);
    expect(copy.en.harness.roles).toHaveLength(copy['zh-CN'].harness.roles.length);
    expect(copy.en.choreography.flow).toHaveLength(7);
    expect(copy.en.choreography.flow).toHaveLength(copy['zh-CN'].choreography.flow.length);
  });

  it('publishes exact benchmark evidence', () => {
    expect(copy.en.benchmark).toMatchObject({
      metisSolved: '73 / 89', metisAccuracy: '82.02%', baselineSolved: '60 / 89',
      baselineAccuracy: '67.42%', delta: '+13', pointsDelta: '+14.6',
    });
  });

  it('uses canonical Metis destinations', () => {
    expect(LINKS.repository).toBe('https://github.com/Wholiver/metis');
    expect(LINKS.benchmark).toContain('#benchmark--comparison');
    expect(LINKS.releases).toContain('/Wholiver/metis/releases/latest');
    expect(LINKS.npm).toContain('@wholiver_hu/metis');
    expect(INSTALL_COMMAND).toBe('npm install -g @wholiver_hu/metis');
  });
});
