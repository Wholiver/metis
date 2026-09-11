import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const workspaceGit = require('../desktop/workspace-git.cjs');

describe('desktop workspace-git helpers', () => {
  it('parses porcelain rename paths and status kinds', () => {
    expect(workspaceGit.parsePorcelainPath('old.ts -> new.ts')).toBe('new.ts');
    expect(workspaceGit.parsePorcelainPath('"src/App.tsx"')).toBe('src/App.tsx');
    expect(workspaceGit.statusKind('??')).toBe('added');
    expect(workspaceGit.statusKind('A ')).toBe('added');
    expect(workspaceGit.statusKind(' D')).toBe('deleted');
    expect(workspaceGit.statusKind('M ')).toBe('modified');
  });

  it('detects git repos from .git presence', () => {
    expect(workspaceGit.isGitRepoSync(process.cwd())).toBe(true);
  });
});
