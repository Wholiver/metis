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

  it('performs full git lifecycle (init, status, stage, commit, history) in a real temp directory', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-git-test-'));

    try {
      expect(workspaceGit.isGitRepoSync(tempDir)).toBe(false);

      // 1. Init
      await workspaceGit.initGitRepo(tempDir);
      expect(workspaceGit.isGitRepoSync(tempDir)).toBe(true);

      // 2. Add an untracked file
      fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'Hello world\n');
      const status1 = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status1.files.length).toBe(1);
      expect(status1.files[0].file).toBe('hello.txt');
      expect(status1.files[0].status).toBe('added');

      // 3. Stage
      await workspaceGit.stageFiles(tempDir, ['hello.txt']);
      const status2 = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status2.files[0].staged).toBe(true);

      // 4. Commit
      await workspaceGit.commit(tempDir, 'feat: initial test commit', 'Test body description');
      const status3 = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status3.files.length).toBe(0);

      // 5. Read history
      const history = await workspaceGit.readCommitHistory(tempDir, 10);
      expect(history.length).toBe(1);
      expect(history[0].message).toContain('feat: initial test commit');

      // 6. Read branches
      const branches = await workspaceGit.readBranches(tempDir);
      expect(branches.branches.length).toBeGreaterThan(0);

      // 7. Modify and unstage
      fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'Hello world modified\n');
      await workspaceGit.stageFiles(tempDir, ['hello.txt']);
      const status4 = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status4.files[0].staged).toBe(true);

      await workspaceGit.unstageFiles(tempDir, ['hello.txt']);
      const status5 = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status5.files[0].unstaged).toBe(true);

      // 8. Discard changes
      await workspaceGit.discardFiles(tempDir, ['hello.txt']);
      const status6 = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status6.files.length).toBe(0);
      expect(fs.readFileSync(path.join(tempDir, 'hello.txt'), 'utf8')).toBe('Hello world\n');

      // 9. Force staging an ignored file
      fs.writeFileSync(path.join(tempDir, '.gitignore'), 'ignored.txt\n');
      fs.writeFileSync(path.join(tempDir, 'ignored.txt'), 'ignored content\n');
      await workspaceGit.stageFiles(tempDir, ['ignored.txt']);
      const statusIgnored = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(statusIgnored.files.some((f: any) => f.file === 'ignored.txt' && f.staged)).toBe(true);

      // 10. Discarding a newly added staged file deletes it cleanly
      fs.writeFileSync(path.join(tempDir, 'staged_new.txt'), 'staged new content\n');
      await workspaceGit.stageFiles(tempDir, ['staged_new.txt']);
      expect(fs.existsSync(path.join(tempDir, 'staged_new.txt'))).toBe(true);
      await workspaceGit.discardFiles(tempDir, ['staged_new.txt']);
      expect(fs.existsSync(path.join(tempDir, 'staged_new.txt'))).toBe(false);

      // 11. Clean commit diff format without commit log headers
      const diffClean = await workspaceGit.readCommitFileDiff(tempDir, history[0].hash, 'hello.txt');
      expect(diffClean).not.toContain('commit ' + history[0].hash);
      expect(diffClean).not.toContain('Author:');
      expect(diffClean).toContain('diff --git');

      // 12. In-flight deduplication: concurrent calls share the exact same promise
      const p1 = workspaceGit.readGitStatus(tempDir, 'git');
      const p2 = workspaceGit.readGitStatus(tempDir, 'git');
      expect(p1).toBe(p2);
      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(res2);

      const infoP1 = workspaceGit.readGitInfo(tempDir);
      const infoP2 = workspaceGit.readGitInfo(tempDir);
      expect(infoP1).toBe(infoP2);
      const [infoRes1, infoRes2] = await Promise.all([infoP1, infoP2]);
      expect(infoRes1).toBe(infoRes2);

      // 13. Combined staged and unstaged line count verification
      fs.writeFileSync(path.join(tempDir, 'combo.txt'), 'base\n');
      await workspaceGit.stageFiles(tempDir, ['combo.txt']);
      await workspaceGit.commit(tempDir, 'add combo');
      fs.writeFileSync(path.join(tempDir, 'combo.txt'), 'base\nstaged1\nstaged2\n');
      await workspaceGit.stageFiles(tempDir, ['combo.txt']);
      fs.writeFileSync(path.join(tempDir, 'combo.txt'), 'base\nstaged1\nstaged2\nunstaged1\n');
      const comboStatus = await workspaceGit.readGitStatus(tempDir, 'git');
      const comboFile = comboStatus.files.find((f: any) => f.file === 'combo.txt');
      expect(comboFile?.additions).toBe(3);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('limits untracked file inspection without hanging on large sets', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-git-large-'));

    try {
      await workspaceGit.initGitRepo(tempDir);
      // Create 60 untracked files
      for (let i = 0; i < 60; i++) {
        fs.writeFileSync(path.join(tempDir, `file_${i}.txt`), `line1\nline2\n`);
      }

      const status = await workspaceGit.readGitStatus(tempDir, 'git');
      expect(status.files.length).toBe(60);
      const counted = status.files.filter((f: any) => f.additions === 2);
      expect(counted.length).toBe(50);
      const uncounted = status.files.filter((f: any) => f.additions === 0);
      expect(uncounted.length).toBe(10);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

