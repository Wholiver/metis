import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { ReviewFileDiff } from '../../hooks/useWorkspaceReview';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function kindMark(status?: ReviewFileDiff['status']): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: FileTreeNode[];
  file?: ReviewFileDiff;
  totalAdditions: number;
  totalDeletions: number;
}

function buildFileTree(files: ReviewFileDiff[]): FileTreeNode[] {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isFolder: true,
    children: [],
    totalAdditions: 0,
    totalDeletions: 0,
  };

  for (const file of files) {
    const parts = file.file.replace(/\\/g, '/').split('/').filter(Boolean);
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isLast) {
        current.children.push({
          name: part,
          path: file.file,
          isFolder: false,
          children: [],
          file,
          totalAdditions: file.additions,
          totalDeletions: file.deletions,
        });
      } else {
        let folder = current.children.find((c) => c.isFolder && c.name === part);
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            isFolder: true,
            children: [],
            totalAdditions: 0,
            totalDeletions: 0,
          };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  function processNode(node: FileTreeNode) {
    let adds = 0;
    let dels = 0;
    for (const child of node.children) {
      processNode(child);
      adds += child.totalAdditions;
      dels += child.totalDeletions;
    }
    node.totalAdditions += adds;
    node.totalDeletions += dels;
    node.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  processNode(root);
  return root.children;
}

export function ReviewFileList({
  files,
  activeFile,
  onSelect,
  viewMode = 'tree',
}: {
  files: ReviewFileDiff[];
  activeFile?: string | null;
  onSelect: (file: string) => void;
  viewMode?: 'tree' | 'list';
}) {
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});

  const toggleCollapse = (folderPath: string) => {
    setCollapsedPaths((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }));
  };

  const tree = useMemo(() => buildFileTree(files), [files]);

  if (viewMode === 'list') {
    return (
      <div data-slot="session-review-v2-file-list" role="listbox" aria-label={undefined}>
        {files.map((file) => {
          const active = file.file === activeFile;
          return (
            <button
              key={file.file}
              type="button"
              role="option"
              aria-selected={active}
              data-slot="session-review-v2-file"
              data-active={active ? 'true' : 'false'}
              data-review-file={file.file}
              title={file.file}
              onClick={() => onSelect(file.file)}
            >
              <span data-slot="session-review-v2-file-kind" data-kind={file.status || 'modified'}>
                {kindMark(file.status)}
              </span>
              <span data-slot="session-review-v2-file-name">{basename(file.file)}</span>
              <span className="shrink-0 tabular-nums text-[12px] text-green">+{file.additions}</span>
              <span className="shrink-0 tabular-nums text-[12px] text-red-500 dark:text-red-400">-{file.deletions}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const renderNodes = (nodes: FileTreeNode[], depth = 0) => {
    return nodes.map((node) => {
      if (node.isFolder) {
        const isCollapsed = Boolean(collapsedPaths[node.path]);
        return (
          <React.Fragment key={node.path}>
            <button
              type="button"
              onClick={() => toggleCollapse(node.path)}
              className="flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1 text-left text-[13px] text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] transition-colors cursor-pointer select-none"
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              data-slot="session-review-v2-folder"
              data-folder-path={node.path}
              data-collapsed={isCollapsed ? 'true' : 'false'}
              title={node.path}
            >
              {isCollapsed ? (
                <ChevronRight size={13} className="shrink-0 text-ink-3 stroke-[2]" />
              ) : (
                <ChevronDown size={13} className="shrink-0 text-ink-3 stroke-[2]" />
              )}
              {isCollapsed ? (
                <Folder size={14} className="shrink-0 text-ink-3 stroke-[1.8]" />
              ) : (
                <FolderOpen size={14} className="shrink-0 text-ink-3 stroke-[1.8]" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-ink text-[12.5px]">{node.name}</span>
              {node.totalAdditions > 0 && (
                <span className="shrink-0 tabular-nums text-[11px] text-green">+{node.totalAdditions}</span>
              )}
              {node.totalDeletions > 0 && (
                <span className="shrink-0 tabular-nums text-[11px] text-red-500 dark:text-red-400">-{node.totalDeletions}</span>
              )}
            </button>
            {!isCollapsed && renderNodes(node.children, depth + 1)}
          </React.Fragment>
        );
      }

      const active = node.path === activeFile;
      const file = node.file!;
      return (
        <button
          key={node.path}
          type="button"
          role="option"
          aria-selected={active}
          data-slot="session-review-v2-file"
          data-active={active ? 'true' : 'false'}
          data-review-file={node.path}
          title={node.path}
          onClick={() => onSelect(node.path)}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
        >
          <span data-slot="session-review-v2-file-kind" data-kind={file.status || 'modified'}>
            {kindMark(file.status)}
          </span>
          <span data-slot="session-review-v2-file-name">{node.name}</span>
          <span className="shrink-0 tabular-nums text-[12px] text-green">+{file.additions}</span>
          <span className="shrink-0 tabular-nums text-[12px] text-red-500 dark:text-red-400">-{file.deletions}</span>
        </button>
      );
    });
  };

  return (
    <div data-slot="session-review-v2-file-list" role="listbox" aria-label={undefined}>
      {renderNodes(tree)}
    </div>
  );
}
