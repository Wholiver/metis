import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Sidebar } from '../desktop/src/components/sidebar/Sidebar';
import { CodeTreeManager } from '../desktop/src/components/codetree/CodeTreeManager';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

describe('desktop Code Tree manager & sidebar integration', () => {
  it('renders the Code Tree action button below Routines in the sidebar', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agents: [],
        activeAgentId: '',
        width: 240,
        onSelectAgent: () => undefined,
        isCodeTreeOpen: false,
      })
    );

    expect(markup).toContain('data-code-tree-action=""');
    expect(markup).toContain('data-routines-action=""');
    expect(markup).toContain('data-sidebar-projects=""');
  });

  it('renders CodeTreeManager in the main workspace area like RoutinesManager', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CodeTreeManager, {
        projects: [{ id: 'p-1', name: 'Metis Project', path: '/test/path' }],
        activeProjectId: 'p-1',
        onClose: () => undefined,
      })
    );

    expect(markup).toContain('data-code-tree-manager=""');
    expect(markup).toContain('Metis Project');
  });

  it('mounts CodeTreeManager in App.tsx when isCodeTreeOpen is true', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(appSource).toContain('import { CodeTreeManager }');
    expect(appSource).toContain('isCodeTreeOpen ? (');
    expect(appSource).toContain('<CodeTreeManager');
  });

  it('hides the right inspector shell when routines, code tree, or harness is open', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(appSource).toContain("isRoutinesViewActive || isCodeTreeOpen || isHarnessOpen ? 'hidden' : 'contents'");
  });

  it('exposes workspace:open-path and targetDir tree in main.cjs and preload.cjs', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    const preloadSource = readFileSync(resolve(process.cwd(), 'desktop/preload.cjs'), 'utf8');

    expect(mainSource).toContain('"workspace:open-path"');
    expect(mainSource).toContain('"workspace:read-file"');
    expect(mainSource).toContain('shell.openPath');
    expect(mainSource).toContain('readWorkspaceTree(targetDir)');
    expect(preloadSource).toContain('openPath: (relativePath, targetDir) => ipcRenderer.invoke("workspace:open-path", relativePath, targetDir)');
    expect(preloadSource).toContain('readFile: (relativePath, targetDir) => ipcRenderer.invoke("workspace:read-file", relativePath, targetDir)');
    expect(preloadSource).toContain('tree: (targetDir) => ipcRenderer.invoke("workspace:tree", targetDir)');
  });

  it('has i18n keys for code tree, filter placeholder, and context actions', () => {
    const i18nSource = readFileSync(resolve(process.cwd(), 'desktop/i18n-source.cjs'), 'utf8');

    expect(i18nSource).toContain('"codeTree": "Code Tree"');
    expect(i18nSource).toContain('"codeTree": "代码树"');
    expect(i18nSource).toContain('"gitManager": "Git Manager"');
    expect(i18nSource).toContain('"gitManager": "Git 管理"');
    expect(i18nSource).toContain('"switchBranch": "Switch branch"');
    expect(i18nSource).toContain('"switchBranch": "切换分支"');
    expect(i18nSource).toContain('"dragToResize": "Drag to resize"');
    expect(i18nSource).toContain('"dragToResize": "拖动调整大小"');
    expect(i18nSource).toContain('"treeFilterPlaceholder": "Filter files..."');
    expect(i18nSource).toContain('"treeFilterPlaceholder": "筛选文件..."');
    expect(i18nSource).toContain('"openInEditor": "Open in Editor"');
    expect(i18nSource).toContain('"openInEditor": "在编辑器中打开"');
    expect(i18nSource).toContain('"copyRelativePath": "Copy Relative Path"');
    expect(i18nSource).toContain('"copyRelativePath": "复制相对路径"');
    expect(i18nSource).toContain('"allFiles": "All"');
    expect(i18nSource).toContain('"allFiles": "全部"');
    expect(i18nSource).toContain('"changedFilesOnly": "Modified"');
    expect(i18nSource).toContain('"changedFilesOnly": "仅看改动"');
    expect(i18nSource).toContain('"binaryDiffTitle": "Binary file changed"');
    expect(i18nSource).toContain('"binaryDiffTitle": "二进制文件变动"');
  });

  it('renders tree view controls, scope filters, and commit timeline in CodeTreeManager', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CodeTreeManager, {
        projects: [
          { id: 'p-1', name: 'Metis Project', path: '/test/p1' },
          { id: 'p-2', name: 'Other Project', path: '/test/p2' },
        ],
        activeProjectId: 'p-1',
        onClose: () => undefined,
      })
    );

    // Header project title
    expect(markup).toContain('Metis Project');
    // Scope filter buttons in Tree view
    expect(markup.includes('Modified') || markup.includes('仅改动') || markup.includes('仅看改动')).toBe(true);
    expect(markup.includes('All') || markup.includes('全部')).toBe(true);
    // Commit history timeline
    expect(markup.includes('History') || markup.includes('提交历史')).toBe(true);
  });

  it('unifies control dimensions to standard h-8/w-8 without dark border outlines', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CodeTreeManager, {
        projects: [
          { id: 'p-1', name: 'Metis Project', path: '/test/p1' },
        ],
        activeProjectId: 'p-1',
        onClose: () => undefined,
      })
    );

    // Project switcher matches the add-button pill; icon buttons stay h-8 / w-8
    expect(markup).toContain('data-code-tree-project-switcher=""');
    expect(markup).toContain('rounded-full');
    expect(markup).toContain('w-8 h-8 rounded-chip');
    // Column 1 search input is h-8 pl-8 pr-3
    expect(markup).toContain('h-8 pl-8 pr-3 rounded-full bg-field');
    // Column 1 view mode toggle and expand/collapse buttons are unified w-8 h-8 rounded-[8px]
    expect(markup).toContain('w-8 h-8 shrink-0 rounded-[8px]');
    expect(markup).toContain('w-8 h-8 rounded-[8px] flex items-center justify-center');
    expect(markup).not.toContain('w-7 h-7 rounded-[6px]');
    // Column 1 scope pill toggle uses h-7.5 and h-6.5
    expect(markup).toContain('inline-flex h-7.5 items-center bg-field');
    expect(markup).toContain('h-6.5 px-3 rounded-[5px]');
    // Column 2 search input is unified h-8
    expect(markup).toContain('w-full h-8 pl-8 pr-3 rounded-full bg-field');

    // Controls must NOT have darkened edge borders
    expect(markup).not.toContain('rounded-full border border-line');
    expect(markup).not.toContain('w-7 h-7 shrink-0 rounded-[6px] border border-line');
    expect(markup).not.toContain('bg-field p-0.5 rounded-[5px] border border-line-subtle');
  });

  it('renders circular spinning loader animation during loading state in Column 1', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CodeTreeManager, {
        projects: [
          { id: 'p-1', name: 'Metis Project', path: '/test/p1' },
        ],
        activeProjectId: 'p-1',
        onClose: () => undefined,
      })
    );

    expect(markup).toContain('data-code-tree-loading=""');
    expect(markup).toContain('animate-spin');
    expect(markup).toContain('lucide-loader-circle');
  });

  it('adopts ReviewFileList Image 2 style without tree branch guide lines', () => {
    const codeTreeSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/codetree/CodeTreeManager.tsx'), 'utf8');

    // Uses session-review-v2 contracts
    expect(codeTreeSource).toContain('data-slot="session-review-v2-folder"');
    expect(codeTreeSource).toContain('data-slot="session-review-v2-file"');
    expect(codeTreeSource).toContain('data-slot="session-review-v2-file-kind"');
    expect(codeTreeSource).toContain('data-slot="session-review-v2-file-name"');

    // Does not use TreeBranchGuides branching lines
    expect(codeTreeSource).toContain('data-code-tree-project-option=""');
    expect(codeTreeSource).not.toContain("t('close')");
    expect(codeTreeSource).not.toContain('TreeBranchGuides');
    // Does not use file type icons (FileCode / FileText / FileJson etc.) for tree nodes
    expect(codeTreeSource).not.toContain('getFileIcon');
  });

  it('includes clean error formatting and tooltip on action errors in CodeTreeManager', () => {
    const codeTreeSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/codetree/CodeTreeManager.tsx'), 'utf8');

    expect(codeTreeSource).toContain('function formatErrorMessage');
    expect(codeTreeSource).toContain('function mergeGitStatusIntoTree');
    expect(codeTreeSource).toContain('title={actionError}');
    expect(codeTreeSource).toContain('fileDeletedTitle');
    expect(codeTreeSource).toContain('restoreFile');
  });

  it('supports closing discard confirmation modal on backdrop click', () => {
    const codeTreeSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/codetree/CodeTreeManager.tsx'), 'utf8');

    expect(codeTreeSource).toContain('onClick={() => setDiscardConfirmFiles(null)}');
    expect(codeTreeSource).toContain('e.stopPropagation()');
  });
});

