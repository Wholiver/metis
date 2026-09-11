import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop OpenCode Review V2 wiring', () => {
  it('exposes git review IPC through main and preload', () => {
    const main = source('desktop/main.cjs');
    const preload = source('desktop/preload.cjs');
    expect(main).toContain('workspace-git.cjs');
    expect(main).toContain('workspace:git-info');
    expect(main).toContain('workspace:git-status');
    expect(main).toContain('workspace:git-diff');
    expect(main).toContain('workspace:git-init');
    expect(main).toContain('isGitRepo');
    expect(preload).toContain('gitInfo:');
    expect(preload).toContain('gitStatus:');
    expect(preload).toContain('gitDiff:');
    expect(preload).toContain('gitInit:');
  });

  it('renders ReviewPanel with OpenCode session-review-v2 slots', () => {
    const panel = source('desktop/src/components/inspector/ReviewPanel.tsx');
    const preview = source('desktop/src/components/inspector/ReviewDiffPreview.tsx');
    const sidebar = source('desktop/src/components/inspector/ReviewSidebar.tsx');
    const empty = source('desktop/src/components/inspector/ReviewEmpty.tsx');
    const css = source('desktop/src/styles/beautifului/opencode-review.css');
    const indexCss = source('desktop/src/index.css');
    expect(panel).toContain('data-component="session-review-v2"');
    expect(panel).toContain('rows={review.rows}');
    expect(sidebar).toContain('data-slot="session-review-v2-sidebar"');
    expect(sidebar).toContain('filterFiles');
    expect(sidebar).toContain('reviewModeTurn');
    expect(empty).toContain('reviewEmptyNoGitTitle');
    expect(empty).toContain('data-review-init-git');
    expect(preview).toContain('flush');
    expect(preview).toContain('variant="Diff"');
    expect(preview).toContain('data-review-diff-flush');
    expect(preview).not.toContain('rounded-card');
    expect(css).toContain('[data-slot="session-review-v2-sidebar-header"]');
    expect(css).toContain('padding-inline: 8px 16px');
    expect(css).toContain('[data-review-diff-flush]');
    expect(css).toContain('[data-code-block][data-flush]');
    expect(indexCss).toContain('opencode-review.css');
  });

  it('stops legacy workspace:diff from fabricating clean tracked source as context', () => {
    const main = source('desktop/main.cjs');
    expect(main).toContain('if (!isUntracked)');
    expect(main).toContain('return { path: normalized, diff: "", truncated: false }');
    expect(main).not.toContain('${isUntracked ? "+" : " "}');
  });
});
