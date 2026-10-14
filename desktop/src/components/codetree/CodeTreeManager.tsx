import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  GitBranch,
  Search,
  RefreshCw,
  FolderOpen,
  Folder,
  FolderTree,
  List,
  ChevronRight,
  ChevronDown,
  FileCode,
  ExternalLink,
  Copy,
  Check,
  Plus,
  PanelLeftOpen,
  X,
  FileCode2,
  CheckCircle2,
  Minus,
  RotateCcw,
  GitCommit,
  History,
  AlertCircle,
  LoaderCircle,
} from 'lucide-react';
import { ProjectItem } from '../../types';
import { useI18n } from '../../i18n';
import { isMac } from '../../lib/platform';
import { pathsEqual } from '../../hooks/useMetisServer';
import { Button } from '../atoms/Button';
import CodeBlock, { DiffRow } from '../primitives/CodeBlock';
import { parseUnifiedDiff } from '../../lib/review-diff';

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: WorkspaceTreeNode[];
}

export interface GitFileStatus {
  file: string;
  status: 'added' | 'deleted' | 'modified' | 'untracked';
  additions?: number;
  deletions?: number;
  xy?: string;
  staged?: boolean;
  unstaged?: boolean;
}

export interface GitCommitItem {
  hash: string;
  shortHash: string;
  author: string;
  relativeDate: string;
  date: string;
  message: string;
}

export interface GitCommitDetail {
  hash: string;
  shortHash: string;
  author: string;
  relativeDate: string;
  date: string;
  subject: string;
  body: string;
  files: Array<{
    file: string;
    status: 'added' | 'deleted' | 'modified';
    additions: number;
    deletions: number;
  }>;
}

interface CodeTreeManagerProps {
  projects?: ProjectItem[];
  activeProjectId?: string;
  activeProjectPath?: string;
  onSelectProject?: (projectId: string) => void;
  onClose: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onSelectFile?: (relativePath: string, hasGitChanges: boolean) => void;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function kindMark(status?: GitFileStatus['status'], xy?: string): string {
  if (xy === '??' || status === 'untracked') return 'U';
  if (status === 'added' || xy?.includes('A')) return 'A';
  if (status === 'deleted' || xy?.includes('D')) return 'D';
  return 'M';
}

function formatErrorMessage(err: any): string {
  const raw = String(err?.message || err || '');
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim() || raw;
}

function mergeGitStatusIntoTree(
  rootNodes: WorkspaceTreeNode[],
  statusMap: Map<string, GitFileStatus>
): WorkspaceTreeNode[] {
  const knownPaths = new Set<string>();
  function collect(list: WorkspaceTreeNode[]) {
    for (const n of list) {
      knownPaths.add(normalizePath(n.path));
      if (n.children) collect(n.children);
    }
  }
  collect(rootNodes);

  const missingFiles: string[] = [];
  for (const filePath of statusMap.keys()) {
    if (!knownPaths.has(filePath)) {
      missingFiles.push(filePath);
    }
  }

  if (missingFiles.length === 0) return rootNodes;

  function cloneNodes(list: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
    return list.map((n) => ({
      ...n,
      children: n.children ? cloneNodes(n.children) : undefined,
    }));
  }

  const result = cloneNodes(rootNodes);

  for (const filePath of missingFiles) {
    const parts = filePath.split('/');
    let currentLevel = result;
    let accumulatedPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      let found = currentLevel.find((n) => normalizePath(n.path) === accumulatedPath);
      if (!found) {
        if (isFile) {
          found = {
            name: part,
            path: accumulatedPath,
            type: 'file',
          };
          currentLevel.push(found);
        } else {
          found = {
            name: part,
            path: accumulatedPath,
            type: 'directory',
            children: [],
          };
          currentLevel.push(found);
        }
      }
      if (!isFile && found.children) {
        currentLevel = found.children;
      }
    }
  }

  return result;
}


export const CodeTreeManager: React.FC<CodeTreeManagerProps> = memo(({
  projects = [],
  activeProjectId = '',
  activeProjectPath = '',
  onSelectProject,
  onClose: _onClose,
  isSidebarOpen = true,
  onToggleSidebar,
  onNewChat,
  onSelectFile,
}) => {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<WorkspaceTreeNode[]>([]);
  const [rootInfo, setRootInfo] = useState<{ name: string; path: string; isGitRepo: boolean } | null>(null);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [branchesList, setBranchesList] = useState<string[]>([]);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, GitFileStatus>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Column 1 selection (working tree)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileDiffPatch, setFileDiffPatch] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const [viewType, setViewType] = useState<'diff' | 'code'>('diff');

  // Column 2 (Commit History Timeline)
  const [historyCommits, setHistoryCommits] = useState<GitCommitItem[]>([]);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedCommitDetail, setSelectedCommitDetail] = useState<GitCommitDetail | null>(null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null);
  const [selectedCommitFileDiff, setSelectedCommitFileDiff] = useState<string | null>(null);
  const [isLoadingCommitDetail, setIsLoadingCommitDetail] = useState<boolean>(false);
  const [isLoadingCommitDiff, setIsLoadingCommitDiff] = useState<boolean>(false);

  // Commit box inputs
  const [commitSummary, setCommitSummary] = useState<string>('');
  const [commitDescription, setCommitDescription] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);

  // Widths & Resizing
  const [col1Width, setCol1Width] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('metis:git:col1-width'));
      if (Number.isFinite(saved) && saved >= 220 && saved <= 550) return saved;
    } catch {}
    return 310;
  });
  const [col2Width, setCol2Width] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('metis:git:col2-width'));
      if (Number.isFinite(saved) && saved >= 200 && saved <= 500) return saved;
    } catch {}
    return 280;
  });
  const drag1Ref = useRef<{ startX: number; startWidth: number } | null>(null);
  const drag2Ref = useRef<{ startX: number; startWidth: number } | null>(null);

  // Tree vs List Mode & Filters
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterScope, setFilterScope] = useState<'changes' | 'all'>('changes');
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');

  // Discard Confirmation Dialog State
  const [discardConfirmFiles, setDiscardConfirmFiles] = useState<string[] | null>(null);

  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) || projects[0] || null;
  }, [projects, activeProjectId]);

  const currentWorkspaceDir = activeProject?.path || activeProjectPath;

  const prevSelectedFileRef = useRef<string | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setIsBranchDropdownOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsProjectDropdownOpen(false);
        setIsBranchDropdownOpen(false);
        setDiscardConfirmFiles(null);
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const loadTreeAndGit = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setActionError(null);
    try {
      const desktop = (window as any).metisDesktop;
      if (!desktop?.workspace) {
        setIsLoading(false);
        return;
      }

      const targetPath = currentWorkspaceDir;
      const [treeResult, gitInfoResult, gitStatusResult, historyResult, branchesResult] = await Promise.all([
        desktop.workspace.tree(targetPath),
        desktop.workspace.gitInfo ? desktop.workspace.gitInfo(targetPath) : null,
        desktop.workspace.gitStatus ? desktop.workspace.gitStatus('git', targetPath).catch(() => null) : null,
        desktop.workspace.gitHistory ? desktop.workspace.gitHistory(50, targetPath).catch(() => []) : [],
        desktop.workspace.gitBranches ? desktop.workspace.gitBranches(targetPath).catch(() => null) : null,
      ]);

      if (gitInfoResult) {
        setGitBranch(gitInfoResult.branch || gitInfoResult.defaultBranch || (gitInfoResult.isRepo ? 'HEAD' : null));
      }

      if (branchesResult?.branches) {
        setBranchesList(branchesResult.branches);
      }

      if (Array.isArray(historyResult)) {
        setHistoryCommits(historyResult);
      }

      const statusMap = new Map<string, GitFileStatus>();
      let firstChangedFile: string | null = null;
      if (gitStatusResult?.files && Array.isArray(gitStatusResult.files)) {
        for (const file of gitStatusResult.files) {
          const norm = normalizePath(file.file);
          if (!firstChangedFile) firstChangedFile = norm;
          statusMap.set(norm, {
            file: norm,
            status: file.status || 'modified',
            additions: file.additions,
            deletions: file.deletions,
            xy: file.xy,
            staged: file.staged,
            unstaged: file.unstaged,
          });
        }
      }
      setGitStatusMap(statusMap);

      if (treeResult) {
        const mergedNodes = mergeGitStatusIntoTree(treeResult.nodes || [], statusMap);
        setNodes(mergedNodes);
        setRootInfo(treeResult.root || null);
      }

      // Auto-select first changed file if nothing is currently selected
      setSelectedFilePath((current) => {
        if (current && (statusMap.has(current) || current.length > 0)) {
          return current;
        }
        return firstChangedFile;
      });
    } catch (err: any) {
      setError(formatErrorMessage(err) || 'Failed to read workspace tree');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspaceDir]);

  const prevProjectDirRef = useRef<string>(currentWorkspaceDir);
  useEffect(() => {
    if (prevProjectDirRef.current !== currentWorkspaceDir) {
      prevProjectDirRef.current = currentWorkspaceDir;
      setIsLoading(true);
      setNodes([]);
      setGitStatusMap(new Map());
      setHistoryCommits([]);
      setSelectedFilePath(null);
      setFileDiffPatch(null);
      setFileContent(null);
      setSelectedCommitHash(null);
      setSelectedCommitDetail(null);
      setSelectedCommitFile(null);
      setSelectedCommitFileDiff(null);
      setActionError(null);
    }
  }, [currentWorkspaceDir]);

  useEffect(() => {
    loadTreeAndGit();
  }, [loadTreeAndGit]);

  // Load diff for working tree file
  const loadFileDiff = useCallback(async (filePath: string) => {
    setIsLoadingDiff(true);
    setFileDiffPatch(null);
    try {
      const desktop = (window as any).metisDesktop;
      if (desktop?.workspace?.gitDiff) {
        const diffRes = await desktop.workspace.gitDiff(filePath, 'git', currentWorkspaceDir);
        if (diffRes?.diff) {
          setFileDiffPatch(diffRes.diff);
        } else {
          setFileDiffPatch(null);
        }
      }
    } catch (err) {
      console.error('Failed to load file diff:', err);
      setFileDiffPatch(null);
    } finally {
      setIsLoadingDiff(false);
    }
  }, [currentWorkspaceDir]);

  // Load full content for working tree file
  const loadFileContent = useCallback(async (filePath: string) => {
    setIsLoadingContent(true);
    setFileContent(null);
    try {
      const desktop = (window as any).metisDesktop;
      if (desktop?.workspace?.readFile) {
        const content = await desktop.workspace.readFile(filePath, currentWorkspaceDir);
        setFileContent(typeof content === 'string' ? content : String(content || ''));
      }
    } catch (err) {
      console.warn('Failed to load file content:', err);
      setFileContent(null);
    } finally {
      setIsLoadingContent(false);
    }
  }, [currentWorkspaceDir]);

  useEffect(() => {
    if (selectedFilePath) {
      setSelectedCommitHash(null);
      setSelectedCommitDetail(null);
      const hasGit = gitStatusMap.has(selectedFilePath);
      const fileChanged = selectedFilePath !== prevSelectedFileRef.current;
      prevSelectedFileRef.current = selectedFilePath;

      if (hasGit) {
        loadFileDiff(selectedFilePath);
        loadFileContent(selectedFilePath);
        if (fileChanged) {
          setViewType('diff');
        }
      } else {
        setFileDiffPatch(null);
        loadFileContent(selectedFilePath);
        setViewType('code');
      }
    } else {
      setFileDiffPatch(null);
      setFileContent(null);
    }
  }, [selectedFilePath, gitStatusMap, loadFileDiff, loadFileContent]);

  // Load commit detail when commit in Column 2 is selected
  const handleSelectCommit = useCallback(async (commit: GitCommitItem) => {
    setSelectedFilePath(null);
    setSelectedCommitHash(commit.hash);
    setSelectedCommitDetail(null);
    setSelectedCommitFile(null);
    setSelectedCommitFileDiff(null);
    setIsLoadingCommitDetail(true);

    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitCommitDetail) {
      try {
        const detail: GitCommitDetail = await desktop.workspace.gitCommitDetail(commit.hash, currentWorkspaceDir);
        if (detail) {
          setSelectedCommitDetail(detail);
          if (detail.files && detail.files.length > 0) {
            const firstFile = detail.files[0].file;
            setSelectedCommitFile(firstFile);
            if (desktop.workspace.gitCommitFileDiff) {
              setIsLoadingCommitDiff(true);
              const d = await desktop.workspace.gitCommitFileDiff(commit.hash, firstFile, currentWorkspaceDir);
              setSelectedCommitFileDiff(d);
              setIsLoadingCommitDiff(false);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load commit detail:', err);
      } finally {
        setIsLoadingCommitDetail(false);
      }
    } else {
      setIsLoadingCommitDetail(false);
    }
  }, [currentWorkspaceDir]);

  const handleSelectCommitFile = useCallback(async (commitHash: string, file: string) => {
    setSelectedCommitFile(file);
    setSelectedCommitFileDiff(null);
    setIsLoadingCommitDiff(true);
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitCommitFileDiff) {
      try {
        const d = await desktop.workspace.gitCommitFileDiff(commitHash, file, currentWorkspaceDir);
        setSelectedCommitFileDiff(d);
      } catch (err) {
        console.error('Failed to load commit file diff:', err);
      } finally {
        setIsLoadingCommitDiff(false);
      }
    } else {
      setIsLoadingCommitDiff(false);
    }
  }, [currentWorkspaceDir]);

  // Git Actions: Stage, Unstage, Discard, Commit
  const handleStageFiles = useCallback(async (files: string[]) => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitStage) {
      try {
        await desktop.workspace.gitStage(files, currentWorkspaceDir);
        await loadTreeAndGit();
      } catch (e: any) {
        setActionError(formatErrorMessage(e) || 'Failed to stage files');
      }
    }
  }, [currentWorkspaceDir, loadTreeAndGit]);

  const handleUnstageFiles = useCallback(async (files: string[]) => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitUnstage) {
      try {
        await desktop.workspace.gitUnstage(files, currentWorkspaceDir);
        await loadTreeAndGit();
      } catch (e: any) {
        setActionError(formatErrorMessage(e) || 'Failed to unstage files');
      }
    }
  }, [currentWorkspaceDir, loadTreeAndGit]);

  const handleExecuteDiscard = useCallback(async (files: string[]) => {
    setDiscardConfirmFiles(null);
    if (!files || files.length === 0) return;
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitDiscard) {
      try {
        await desktop.workspace.gitDiscard(files, currentWorkspaceDir);
        await loadTreeAndGit();
      } catch (e: any) {
        setActionError(formatErrorMessage(e) || 'Failed to discard changes');
      }
    }
  }, [currentWorkspaceDir, loadTreeAndGit]);

  const handleCommit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!commitSummary.trim() || isCommitting) return;
    setIsCommitting(true);
    setActionError(null);
    try {
      const desktop = (window as any).metisDesktop;
      const fullMsg = commitDescription.trim()
        ? `${commitSummary.trim()}\n\n${commitDescription.trim()}`
        : commitSummary.trim();

      // If no files staged, stage all first (standard Git Desktop convention)
      const stagedList = Array.from(gitStatusMap.values()).filter((f) => f.staged);
      if (stagedList.length === 0) {
        await desktop.workspace.gitStage([], currentWorkspaceDir);
      }

      await desktop.workspace.gitCommit(fullMsg, currentWorkspaceDir);
      setCommitSummary('');
      setCommitDescription('');
      await loadTreeAndGit();
    } catch (err: any) {
      setActionError(`Commit failed: ${formatErrorMessage(err)}`);
    } finally {
      setIsCommitting(false);
    }
  }, [commitSummary, commitDescription, isCommitting, gitStatusMap, currentWorkspaceDir, loadTreeAndGit]);

  const handleCheckoutBranch = useCallback(async (branch: string) => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitCheckout) {
      try {
        setIsBranchDropdownOpen(false);
        setIsLoading(true);
        setNodes([]);
        setGitStatusMap(new Map());
        setHistoryCommits([]);
        setSelectedFilePath(null);
        setFileDiffPatch(null);
        setFileContent(null);
        await desktop.workspace.gitCheckout(branch, currentWorkspaceDir);
        await loadTreeAndGit();
      } catch (e: any) {
        setActionError(`Checkout failed: ${formatErrorMessage(e)}`);
      }
    }
  }, [currentWorkspaceDir, loadTreeAndGit]);

  const handleSelectFile = useCallback((relativePath: string) => {
    const norm = normalizePath(relativePath);
    setSelectedFilePath(norm);
    setFileDiffPatch(null);
    setFileContent(null);
    setIsLoadingDiff(true);
    setIsLoadingContent(true);
    const hasGit = gitStatusMap.has(norm);
    onSelectFile?.(norm, hasGit);
  }, [gitStatusMap, onSelectFile]);

  const handleOpenInEditor = useCallback(async (filePath: string) => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.openPath) {
      try {
        await desktop.workspace.openPath(filePath, currentWorkspaceDir);
      } catch (e) {
        console.error('Failed to open file in editor:', e);
      }
    }
  }, [currentWorkspaceDir]);

  const handleReveal = useCallback(async (filePath: string) => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.reveal) {
      try {
        await desktop.workspace.reveal(filePath, currentWorkspaceDir);
      } catch (e) {
        console.error('Failed to reveal file:', e);
      }
    }
  }, [currentWorkspaceDir]);

  const handleCopyPath = useCallback(async (filePath: string) => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopiedNotification(filePath);
      setTimeout(() => setCopiedNotification(null), 2000);
    } catch (e) {
      console.error('Failed to copy path:', e);
    }
  }, []);

  const handleInitGit = useCallback(async () => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.workspace?.gitInit) {
      try {
        await desktop.workspace.gitInit(currentWorkspaceDir);
        await loadTreeAndGit();
      } catch (e: any) {
        setActionError(formatErrorMessage(e) || 'Failed to initialize Git repository');
      }
    }
  }, [currentWorkspaceDir, loadTreeAndGit]);

  // Resizing logic for Column 1
  const onResize1Start = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    drag1Ref.current = { startX: event.clientX, startWidth: col1Width };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
  }, [col1Width]);

  const onResize1Move = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag1Ref.current) return;
    const next = drag1Ref.current.startWidth + (event.clientX - drag1Ref.current.startX);
    const clamped = Math.min(550, Math.max(220, next));
    setCol1Width(clamped);
    try { localStorage.setItem('metis:git:col1-width', String(clamped)); } catch {}
  }, []);

  const onResize1End = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag1Ref.current) return;
    drag1Ref.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }, []);

  // Resizing logic for Column 2
  const onResize2Start = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    drag2Ref.current = { startX: event.clientX, startWidth: col2Width };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
  }, [col2Width]);

  const onResize2Move = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag2Ref.current) return;
    const next = drag2Ref.current.startWidth + (event.clientX - drag2Ref.current.startX);
    const clamped = Math.min(500, Math.max(200, next));
    setCol2Width(clamped);
    try { localStorage.setItem('metis:git:col2-width', String(clamped)); } catch {}
  }, []);

  const onResize2End = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag2Ref.current) return;
    drag2Ref.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }, []);

  const handleToggleFolder = useCallback((folderPath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  // Compute folder stats recursively for Tree view
  const folderStats = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number; count: number; changedFiles: string[] }>();
    for (const [filePath, status] of gitStatusMap.entries()) {
      const parts = filePath.split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        const existing = map.get(cur) || { additions: 0, deletions: 0, count: 0, changedFiles: [] };
        existing.additions += status.additions || 0;
        existing.deletions += status.deletions || 0;
        existing.count += 1;
        existing.changedFiles.push(filePath);
        map.set(cur, existing);
      }
    }
    return map;
  }, [gitStatusMap]);

  // Expand / Collapse all folders in Tree View
  const handleExpandAll = useCallback(() => {
    setCollapsedPaths(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    const allDirs = new Set<string>();
    function collect(list: WorkspaceTreeNode[]) {
      for (const n of list) {
        if (n.type === 'directory') {
          allDirs.add(normalizePath(n.path));
          if (n.children) collect(n.children);
        }
      }
    }
    collect(nodes);
    setCollapsedPaths(allDirs);
  }, [nodes]);

  // Separate Staged vs Unstaged files for List View
  const stagedFiles = useMemo(() => {
    return Array.from(gitStatusMap.values()).filter((f) => f.staged);
  }, [gitStatusMap]);

  const unstagedFiles = useMemo(() => {
    return Array.from(gitStatusMap.values()).filter((f) => f.unstaged || (!f.staged && !f.unstaged));
  }, [gitStatusMap]);

  // Filtered Tree Structure for Tree View
  const filteredTreeNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    function filterNode(node: WorkspaceTreeNode): WorkspaceTreeNode | null {
      const normPath = normalizePath(node.path);
      const isFile = node.type === 'file';
      const hasGit = gitStatusMap.has(normPath);

      if (isFile) {
        if (filterScope === 'changes' && !hasGit) return null;
        if (q && !node.name.toLowerCase().includes(q) && !normPath.toLowerCase().includes(q)) return null;
        return node;
      }

      // Directory
      const fChildren: WorkspaceTreeNode[] = [];
      if (node.children) {
        for (const child of node.children) {
          const res = filterNode(child);
          if (res) fChildren.push(res);
        }
      }
      fChildren.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      if (filterScope === 'changes') {
        const stats = folderStats.get(normPath);
        if (!stats || stats.count === 0 || fChildren.length === 0) return null;
      } else if (q) {
        if (fChildren.length === 0 && !node.name.toLowerCase().includes(q)) return null;
      }

      return {
        ...node,
        children: fChildren,
      };
    }

    const res: WorkspaceTreeNode[] = [];
    for (const n of nodes) {
      const filtered = filterNode(n);
      if (filtered) res.push(filtered);
    }
    res.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return res;
  }, [nodes, filterScope, searchQuery, gitStatusMap, folderStats]);

  // Filter history commits
  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return historyCommits;
    const q = historySearch.trim().toLowerCase();
    return historyCommits.filter(
      (c) => c.message.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.shortHash.toLowerCase().includes(q)
    );
  }, [historyCommits, historySearch]);

  const isRepo = rootInfo?.isGitRepo ?? false;

  // Parsed Diff for working tree
  const parsedDiffRows = useMemo<DiffRow[]>(() => {
    return fileDiffPatch ? parseUnifiedDiff(fileDiffPatch) : [];
  }, [fileDiffPatch]);

  const diffCode = useMemo(() => {
    return parsedDiffRows.map((row) => row.pieces.map((p) => p.text).join('')).join('\n');
  }, [parsedDiffRows]);

  const diffAdditions = parsedDiffRows.filter((r) => r.type === 'add').length;
  const diffDeletions = parsedDiffRows.filter((r) => r.type === 'del').length;

  // Parsed Diff for historical commit file
  const parsedCommitDiffRows = useMemo<DiffRow[]>(() => {
    return selectedCommitFileDiff ? parseUnifiedDiff(selectedCommitFileDiff) : [];
  }, [selectedCommitFileDiff]);

  const commitDiffCode = useMemo(() => {
    return parsedCommitDiffRows.map((row) => row.pieces.map((p) => p.text).join('')).join('\n');
  }, [parsedCommitDiffRows]);

  // Recursive Tree Node Renderer matching ReviewFileList / Image 2 style
  const renderTreeNodes = useCallback((
    treeList: WorkspaceTreeNode[],
    depth = 0
  ) => {
    return treeList.map((node) => {
      const normPath = normalizePath(node.path);
      const isDirectory = node.type === 'directory';
      const isCollapsed = collapsedPaths.has(normPath);
      const gitStatus = gitStatusMap.get(normPath);
      const active = selectedFilePath ? pathsEqual(selectedFilePath, normPath) : false;
      const stats = isDirectory ? folderStats.get(normPath) : undefined;

      if (isDirectory) {
        return (
          <React.Fragment key={normPath}>
            <div
              className="group flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1 min-h-[28px] text-left text-[13px] text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] transition-colors cursor-pointer select-none"
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              onClick={(e) => handleToggleFolder(normPath, e)}
              title={normPath}
              data-slot="session-review-v2-folder"
              data-folder-path={normPath}
              data-collapsed={isCollapsed ? 'true' : 'false'}
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
              {stats && stats.additions > 0 && (
                <span className="shrink-0 tabular-nums text-[11px] text-green">+{stats.additions}</span>
              )}
              {stats && stats.deletions > 0 && (
                <span className="shrink-0 tabular-nums text-[11px] text-red-500 dark:text-red-400">-{stats.deletions}</span>
              )}

              {/* Folder Hover Actions: Stage all / Discard all in folder */}
              {stats && stats.changedFiles.length > 0 && (
                <span className="shrink-0 flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStageFiles(stats.changedFiles);
                    }}
                    className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors cursor-pointer"
                    title={t('stageAll') || '暂存目录下的更改'}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDiscardConfirmFiles(stats.changedFiles);
                    }}
                    className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-red-500 transition-colors cursor-pointer"
                    title={t('discardAll') || '放弃目录下的更改'}
                  >
                    <RotateCcw size={12} />
                  </button>
                </span>
              )}
            </div>

            {/* Recursive rendering of children when expanded */}
            {!isCollapsed && node.children && node.children.length > 0 && (
              renderTreeNodes(node.children, depth + 1)
            )}
          </React.Fragment>
        );
      }

      return (
        <div
          key={normPath}
          role="option"
          aria-selected={active}
          data-slot="session-review-v2-file"
          data-active={active ? 'true' : 'false'}
          data-review-file={normPath}
          title={normPath}
          onClick={() => handleSelectFile(normPath)}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
          className="group select-none"
        >
          {gitStatus ? (
            <span
              data-slot="session-review-v2-file-kind"
              data-kind={gitStatus.status}
              className="shrink-0 font-semibold text-[11px]"
            >
              {kindMark(gitStatus.status, gitStatus.xy)}
            </span>
          ) : (
            <span data-slot="session-review-v2-file-kind" className="shrink-0 font-semibold text-[11px]" />
          )}

          <span data-slot="session-review-v2-file-name">{node.name}</span>

          {gitStatus && (
            <>
              <span className="shrink-0 tabular-nums text-[12px] text-green">+{gitStatus.additions ?? 0}</span>
              <span className="shrink-0 tabular-nums text-[12px] text-red-500 dark:text-red-400">-{gitStatus.deletions ?? 0}</span>
            </>
          )}

          {/* File Hover Quick Actions */}
          {gitStatus && (
            <span className="shrink-0 flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {gitStatus.staged ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnstageFiles([normPath]);
                  }}
                  className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  title={t('unstageFile') || '取消暂存'}
                >
                  <Minus size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStageFiles([normPath]);
                  }}
                  className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  title={t('stageFile') || '暂存'}
                >
                  <Plus size={13} />
                </button>
              )}
              {gitStatus.unstaged && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDiscardConfirmFiles([normPath]);
                  }}
                  className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-red-500 transition-colors cursor-pointer"
                  title={t('discardFile') || '放弃更改'}
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </span>
          )}
        </div>
      );
    });
  }, [
    collapsedPaths,
    gitStatusMap,
    selectedFilePath,
    folderStats,
    handleToggleFolder,
    handleSelectFile,
    handleStageFiles,
    handleUnstageFiles,
    t,
  ]);

  return (
    <div
      data-component="session-review-v2"
      data-code-tree-manager=""
      className="flex h-full flex-1 min-h-0 select-none flex-col overflow-hidden bg-page text-ink"
    >
      {/* 1. Header Toolbar — Clean quiet titlebar with project & branch switchers */}
      <div
        className={`titlebar-drag flex h-[50px] shrink-0 items-center justify-between border-b border-line bg-page ${
          !isSidebarOpen ? 'px-3.5' : 'pl-6 pr-3.5'
        }`}
      >
        <div className="no-drag flex min-w-0 items-center gap-2">
          {!isSidebarOpen && (
            <>
              {isMac && <div className="h-[16px] w-[66px]" />}
              <button
                type="button"
                onClick={onToggleSidebar}
                className="flex h-8 w-8 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink cursor-pointer"
                title={t('reactUiOpenSidebar')}
              >
                <PanelLeftOpen className="h-4 w-4 stroke-[1.8]" />
              </button>
              {onNewChat && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="flex h-8 w-8 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink cursor-pointer"
                  title={t('reactUiNewChat')}
                >
                  <Plus className="h-4 w-4 stroke-[2]" />
                </button>
              )}
            </>
          )}

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="truncate text-[14px] font-semibold text-ink">
              {t('gitManager') || t('codeTree')}
            </h1>

            {/* Project Switcher Pill */}
            {activeProject?.name && (
              <div ref={projectDropdownRef} className="relative inline-flex items-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => projects.length > 1 && setIsProjectDropdownOpen((v) => !v)}
                  className="gap-1 rounded-full h-[28px] px-3 font-medium text-[12.5px]"
                  title={activeProject.path}
                  aria-expanded={isProjectDropdownOpen}
                  data-code-tree-project-switcher=""
                >
                  <Folder className="h-3.5 w-3.5 stroke-[1.8]" />
                  <span className="truncate max-w-[150px]">{activeProject.name}</span>
                  {projects.length > 1 && <ChevronDown className="h-3 w-3 stroke-[2] text-ink-3 ml-0.5" />}
                </Button>

                {isProjectDropdownOpen && projects.length > 1 && (
                  <div className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-[12px] bg-surface border border-line shadow-popover p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                    {projects.map((p) => {
                      const isActive = p.id === activeProjectId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setIsProjectDropdownOpen(false);
                            if (!isActive) {
                              setIsLoading(true);
                              setNodes([]);
                              setGitStatusMap(new Map());
                              setHistoryCommits([]);
                              setSelectedFilePath(null);
                              setFileDiffPatch(null);
                              setFileContent(null);
                              setSelectedCommitHash(null);
                              setSelectedCommitDetail(null);
                              setSelectedCommitFile(null);
                              setSelectedCommitFileDiff(null);
                              onSelectProject?.(p.id);
                            }
                          }}
                          title={p.path}
                          data-code-tree-project-option=""
                          className={`flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer rounded-[8px] ${
                            isActive ? 'bg-hover' : 'hover:bg-hover'
                          }`}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-inset text-ink-2">
                            <Folder className="h-3.5 w-3.5 stroke-[1.8]" />
                          </span>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-[13px] leading-tight text-ink truncate">
                              {p.name}
                            </span>
                            <span className="text-[11px] text-ink-3 leading-tight mt-0.5 truncate">
                              {p.path}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Branch Switcher Pill */}
            {isRepo && (
              <div ref={branchDropdownRef} className="relative inline-flex items-center">
                <button
                  type="button"
                  onClick={() => setIsBranchDropdownOpen((v) => !v)}
                  className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-[7px] text-[12.5px] font-mono text-ink hover:bg-hover transition-colors cursor-pointer"
                  title={t('switchBranch')}
                >
                  <GitBranch size={13.5} strokeWidth={1.8} className="text-ink-3" />
                  <span>{gitBranch || 'HEAD'}</span>
                  {branchesList.length > 1 && <ChevronDown size={12} className="text-ink-3" />}
                </button>

                {isBranchDropdownOpen && branchesList.length > 0 && (
                  <div
                    className="absolute left-0 top-full mt-1 z-50 w-48 rounded-[8px] bg-surface shadow-popover border border-line py-1 flex flex-col gap-0.5"
                    onMouseLeave={() => setIsBranchDropdownOpen(false)}
                  >
                    <div className="px-2.5 py-1 text-[11px] font-semibold text-ink-3 uppercase tracking-wider">
                      {t('localBranches')}
                    </div>
                    {branchesList.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => handleCheckoutBranch(b)}
                        className={`w-full px-2.5 py-1.5 text-left text-[12px] font-mono truncate flex items-center justify-between hover:bg-hover cursor-pointer ${
                          b === gitBranch ? 'text-ink font-semibold bg-hover-2' : 'text-ink-2'
                        }`}
                      >
                        <span className="truncate">{b}</span>
                        {b === gitBranch && <Check size={13} className="text-ink shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Header Controls: Refresh */}
        <div className="no-drag flex items-center gap-1">
          <button
            type="button"
            onClick={loadTreeAndGit}
            className="w-8 h-8 rounded-chip flex items-center justify-center text-ink-3 hover:bg-hover hover:text-ink transition-colors cursor-pointer"
            title={t('refreshTree') || '刷新'}
          >
            <RefreshCw className={`w-4 h-4 stroke-[1.8] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Main 3-Column Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden bg-page">

        {/* ═══ COLUMN 1: Code Tree & Changes Console (Tree/List + Commit Box) ═══ */}
        <div
          style={{ width: `${col1Width}px` }}
          className="shrink-0 flex flex-col min-h-0 border-r border-line bg-page overflow-hidden"
        >
          {/* Header row: Filter, Scope, Expand/Collapse & View Mode Toggle */}
          <div className="p-2.5 border-b border-line flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('treeFilterPlaceholder') || t('filterFiles')}
                  className="w-full h-8 pl-8 pr-3 rounded-full bg-field hover:bg-hover focus:bg-surface text-[13px] text-ink placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-focus/30 transition-colors"
                />
              </div>

              {/* View Mode Toggle Button: Tree vs List */}
              <button
                type="button"
                onClick={() => setViewMode((m) => (m === 'tree' ? 'list' : 'tree'))}
                className="w-8 h-8 shrink-0 rounded-[8px] flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
                title={viewMode === 'tree' ? t('reviewListView') : t('reviewTreeView')}
              >
                {viewMode === 'tree' ? <List size={14} /> : <FolderTree size={14} />}
              </button>
            </div>

            {/* Tree View Secondary Toolbar: Scope [仅改动 | 全部] + Expand/Collapse All */}
            {viewMode === 'tree' && (
              <div className="flex items-center justify-between text-[11px] pt-0.5">
                {/* Scope Pill Toggle */}
                <div className="inline-flex h-7.5 items-center bg-field p-0.5 rounded-[7px] font-medium">
                  <button
                    type="button"
                    onClick={() => setFilterScope('changes')}
                    className={`h-6.5 px-3 rounded-[5px] text-[12px] font-medium flex items-center justify-center transition-colors cursor-pointer ${
                      filterScope === 'changes'
                        ? 'bg-surface text-ink font-semibold shadow-hairline'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    {t('changedFilesOnly')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterScope('all')}
                    className={`h-6.5 px-3 rounded-[5px] text-[12px] font-medium flex items-center justify-center transition-colors cursor-pointer ${
                      filterScope === 'all'
                        ? 'bg-surface text-ink font-semibold shadow-hairline'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    {t('allFiles')}
                  </button>
                </div>

                {/* Expand / Collapse All (Unified w-8 h-8 dimensions) */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
                    title={t('expandAll')}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
                    title={t('collapseAll')}
                  >
                    <Folder size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action error banner if commit/checkout failed */}
          {actionError && (
            <div className="m-2 p-2 rounded-[6px] bg-red-500/10 border border-red-500/30 text-red-600 text-[11.5px] flex items-center justify-between gap-1.5 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0" title={actionError}>
                <AlertCircle size={13} className="shrink-0" />
                <span className="truncate">{actionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-red-600 hover:text-red-700 p-0.5 cursor-pointer shrink-0"
                title={t('dismiss') || '关闭'}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Column 1 Scrollable Content: Tree View or List View */}
          <div className="flex-1 overflow-y-auto p-2 scrollbar-none flex flex-col gap-2">
            {isLoading ? (
              <div
                data-code-tree-loading=""
                className="flex flex-1 flex-col items-center justify-center py-12 text-center text-ink-3"
              >
                <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
                <p className="text-[12px] text-ink-3">{t('loadingTreeAndGit')}</p>
              </div>
            ) : viewMode === 'tree' ? (

              /* ── TREE VIEW (With VS Code style branching guide lines) ── */
              filteredTreeNodes.length === 0 ? (
                <div className="p-6 flex flex-col items-center justify-center text-center text-ink-3">
                  {filterScope === 'changes' ? (
                    <>
                      <CheckCircle2 className="w-8 h-8 text-green mb-2 stroke-[1.7]" />
                      <div className="text-[13px] font-medium text-ink">{t('cleanWorkingTree')}</div>
                      <div className="text-[12px] text-ink-3 mt-0.5">{t('cleanWorkingTreeHint')}</div>
                    </>
                  ) : (
                    <div className="text-[12px] text-ink-3">{t('emptyTree')}</div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col relative" role="tree">
                  {renderTreeNodes(filteredTreeNodes, 0)}
                </div>
              )

            ) : (

              /* ── LIST VIEW (Staged & Unstaged Git Changes) ── */
              gitStatusMap.size === 0 ? (
                <div className="p-6 flex flex-col items-center justify-center text-center text-ink-3">
                  <CheckCircle2 className="w-8 h-8 text-green mb-2 stroke-[1.7]" />
                  <div className="text-[13px] font-medium text-ink">{t('cleanWorkingTree')}</div>
                  <div className="text-[12px] text-ink-3 mt-0.5">{t('cleanWorkingTreeListHint')}</div>
                </div>
              ) : (
                <>
                  {/* 1. Staged Changes Section */}
                  {stagedFiles.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="px-2 py-1 flex items-center justify-between text-[11.5px] font-semibold text-ink-2 bg-field/60 rounded-[6px]">
                        <span>{t('stagedChanges')} ({stagedFiles.length})</span>
                        <button
                          type="button"
                          onClick={() => handleUnstageFiles([])}
                          className="text-[11px] text-ink-3 hover:text-ink font-normal cursor-pointer flex items-center gap-0.5"
                          title={t('unstageAll')}
                        >
                          <Minus size={11} />
                          <span>{t('unstageAllShort')}</span>
                        </button>
                      </div>

                      <div className="flex flex-col gap-0.5" role="listbox">
                        {stagedFiles.map((file) => {
                          const active = selectedFilePath ? pathsEqual(selectedFilePath, file.file) : false;
                          return (
                            <div
                              key={`staged-${file.file}`}
                              role="option"
                              aria-selected={active}
                              data-slot="session-review-v2-file"
                              data-active={active ? 'true' : 'false'}
                              data-review-file={file.file}
                              className="group select-none"
                              onClick={() => handleSelectFile(file.file)}
                            >
                              <span
                                data-slot="session-review-v2-file-kind"
                                data-kind={file.status}
                                className="shrink-0 font-semibold text-[11px]"
                              >
                                {kindMark(file.status, file.xy)}
                              </span>
                              <span data-slot="session-review-v2-file-name" title={file.file}>
                                {file.file}
                              </span>
                              <span className="shrink-0 tabular-nums text-[12px] text-green">+{file.additions ?? 0}</span>
                              <span className="shrink-0 tabular-nums text-[12px] text-red-500 dark:text-red-400">-{file.deletions ?? 0}</span>
                              <span className="shrink-0 flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnstageFiles([file.file]);
                                  }}
                                  className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors cursor-pointer"
                                  title={t('unstageFile')}
                                >
                                  <Minus size={13} />
                                </button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 2. Unstaged Changes Section */}
                  <div className="flex flex-col gap-1">
                    <div className="px-2.5 py-1.5 flex items-center justify-between text-[12px] font-semibold text-ink-2 bg-field/60 rounded-[7px]">
                      <span>{t('unstagedChanges')} ({unstagedFiles.length})</span>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleStageFiles([])}
                          className="text-[11.5px] text-ink-3 hover:text-ink font-normal cursor-pointer flex items-center gap-1"
                          title={t('stageAll')}
                        >
                          <Plus size={12} />
                          <span>{t('stageAll')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscardConfirmFiles(unstagedFiles.map((f) => f.file))}
                          className="text-[11.5px] text-ink-3 hover:text-red-500 font-normal cursor-pointer flex items-center gap-1"
                          title={t('discardAll')}
                        >
                          <RotateCcw size={11} />
                          <span>{t('discardShort')}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5" role="listbox">
                      {unstagedFiles.length === 0 ? (
                        <p className="px-2 py-2 text-[12px] text-ink-3">{t('allChangesStaged')}</p>
                      ) : (
                        unstagedFiles.map((file) => {
                          const active = selectedFilePath ? pathsEqual(selectedFilePath, file.file) : false;
                          return (
                            <div
                              key={`unstaged-${file.file}`}
                              role="option"
                              aria-selected={active}
                              data-slot="session-review-v2-file"
                              data-active={active ? 'true' : 'false'}
                              data-review-file={file.file}
                              className="group select-none"
                              onClick={() => handleSelectFile(file.file)}
                            >
                              <span
                                data-slot="session-review-v2-file-kind"
                                data-kind={file.status}
                                className="shrink-0 font-semibold text-[11px]"
                              >
                                {kindMark(file.status, file.xy)}
                              </span>
                              <span data-slot="session-review-v2-file-name" title={file.file}>
                                {file.file}
                              </span>
                              <span className="shrink-0 tabular-nums text-[12px] text-green">+{file.additions ?? 0}</span>
                              <span className="shrink-0 tabular-nums text-[12px] text-red-500 dark:text-red-400">-{file.deletions ?? 0}</span>
                              <span className="shrink-0 flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStageFiles([file.file]);
                                  }}
                                  className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors cursor-pointer"
                                  title={t('stageFile')}
                                >
                                  <Plus size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDiscardConfirmFiles([file.file]);
                                  }}
                                  className="w-6 h-6 rounded-[5px] hover:bg-hover-2 flex items-center justify-center text-ink-3 hover:text-red-500 transition-colors cursor-pointer"
                                  title={t('discardFile')}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )
            )}
          </div>

          {/* Bottom Commit Input Box */}
          {isRepo && (
            <form
              onSubmit={handleCommit}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleCommit();
                }
              }}
              className="p-3 border-t border-line bg-page flex flex-col gap-2.5 shrink-0"
            >
              <input
                type="text"
                value={commitSummary}
                onChange={(e) => setCommitSummary(e.target.value)}
                placeholder={t('commitSummary')}
                className="w-full h-9 px-3 rounded-[8px] bg-field hover:bg-hover focus:bg-surface text-[13px] text-ink placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-focus/30 transition-colors"
              />
              <textarea
                value={commitDescription}
                onChange={(e) => setCommitDescription(e.target.value)}
                placeholder={t('commitDescription')}
                rows={2}
                className="w-full px-3 py-2 rounded-[8px] bg-field hover:bg-hover focus:bg-surface text-[12.5px] text-ink placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-focus/30 resize-none transition-colors"
              />
              <button
                type="submit"
                disabled={!commitSummary.trim() || isCommitting || gitStatusMap.size === 0}
                className="w-full h-9 rounded-[8px] bg-ink text-surface hover:opacity-90 font-medium text-[13px] flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
              >
                {isCommitting ? (
                  <LoaderCircle size={15} className="animate-spin stroke-[1.8]" />
                ) : (
                  <GitCommit size={15} />
                )}
                <span>
                  {isCommitting
                    ? t('committing')
                    : (t('commitTo', { branch: gitBranch || 'HEAD' }) || `Commit to ${gitBranch || 'HEAD'}`)}
                </span>
                <span className="text-[11px] opacity-70 ml-1">({isMac ? '⌘↵' : 'Ctrl↵'})</span>
              </button>
            </form>
          )}
        </div>

        {/* Resizer 1 (Between Column 1 and Column 2) */}
        <div
          onPointerDown={onResize1Start}
          onPointerMove={onResize1Move}
          onPointerUp={onResize1End}
          onPointerCancel={onResize1End}
          className="relative w-px h-full cursor-col-resize z-20 bg-line hover:bg-accent/40 active:bg-accent transition-colors shrink-0 before:absolute before:inset-y-0 before:left-1/2 before:w-[6px] before:-translate-x-1/2 before:content-['']"
          title={t('dragToResize')}
        />

        {/* ═══ COLUMN 2: Commit History Timeline ═══ */}
        <div
          style={{ width: `${col2Width}px` }}
          className="shrink-0 flex flex-col min-h-0 border-r border-line bg-page overflow-hidden"
        >
          {/* Header */}
          <div className="p-2.5 border-b border-line flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink px-1 shrink-0">
              <History size={15} className="text-ink-3" />
              <span>{t('commitHistory')}</span>
              <span className="text-[12px] font-normal text-ink-3">({historyCommits.length})</span>
            </div>
            <div className="relative flex-1 max-w-[150px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={t('searchCommits')}
                className="w-full h-8 pl-8 pr-3 rounded-full bg-field hover:bg-hover focus:bg-surface text-[12.5px] text-ink placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-focus/30 transition-colors"
              />
            </div>
          </div>

          {/* Timeline List */}
          <div className="flex-1 overflow-y-auto p-2 scrollbar-none flex flex-col gap-1">
            {isLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center py-12 text-center text-ink-3">
                <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
                <p className="text-[12px] text-ink-3">{t('loading')}</p>
              </div>
            ) : filteredHistory.length === 0 ? (
              <p className="px-2 py-6 text-[12px] text-ink-3 text-center">{t('noCommits')}</p>
            ) : (
              filteredHistory.map((item) => {
                const active = selectedCommitHash === item.hash;
                return (
                  <button
                    key={item.hash}
                    type="button"
                    onClick={() => handleSelectCommit(item)}
                    className={`w-full text-left p-2.5 rounded-[8px] transition-colors cursor-pointer flex flex-col gap-1.5 ${
                      active ? 'bg-hover-2 text-ink shadow-hairline' : 'hover:bg-hover text-ink-2'
                    }`}
                  >
                    <div className="text-[13px] font-medium text-ink truncate leading-tight">
                      {item.message}
                    </div>
                    <div className="flex items-center justify-between text-[11.5px] text-ink-3 font-mono">
                      <span>{item.author} · {item.relativeDate}</span>
                      <span className="bg-field px-2 py-0.5 rounded-[5px] text-[11px] font-mono text-ink-3">{item.shortHash}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Resizer 2 (Between Column 2 and Column 3) */}
        <div
          onPointerDown={onResize2Start}
          onPointerMove={onResize2Move}
          onPointerUp={onResize2End}
          onPointerCancel={onResize2End}
          className="relative w-px h-full cursor-col-resize z-20 bg-line hover:bg-accent/40 active:bg-accent transition-colors shrink-0 before:absolute before:inset-y-0 before:left-1/2 before:w-[6px] before:-translate-x-1/2 before:content-['']"
          title={t('dragToResize')}
        />

        {/* ═══ COLUMN 3: Code Diff & Details Workspace ═══ */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-page">

          {/* 1. Working Tree File Preview Mode */}
          {selectedFilePath ? (
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              {/* Toolbar */}
              <div data-slot="session-review-v2-toolbar">
                <div className="flex items-center gap-2 min-w-0">
                  <div data-slot="session-review-v2-toolbar-title" title={selectedFilePath}>
                    {selectedFilePath}
                  </div>
                  {(diffAdditions > 0 || diffDeletions > 0) && (
                    <span data-slot="session-review-v2-stats" aria-label={`+${diffAdditions} -${diffDeletions}`}>
                      {diffAdditions > 0 && <span data-add="">+{diffAdditions}</span>}
                      {diffDeletions > 0 && <span data-del="">-{diffDeletions}</span>}
                    </span>
                  )}

                  {/* Diff vs Full Code Switcher */}
                  {gitStatusMap.has(selectedFilePath) && (
                    <div className="inline-flex h-7.5 items-center bg-field p-0.5 rounded-[7px] font-medium shrink-0 ml-1.5">
                      <button
                        type="button"
                        onClick={() => setViewType('diff')}
                        className={`h-6.5 px-3 rounded-[5px] text-[12px] font-medium flex items-center justify-center transition-colors cursor-pointer ${
                          viewType === 'diff'
                            ? 'bg-surface text-ink font-semibold shadow-hairline'
                            : 'text-ink-3 hover:text-ink'
                        }`}
                      >
                        {t('diffView')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewType('code')}
                        className={`h-6.5 px-3 rounded-[5px] text-[12px] font-medium flex items-center justify-center transition-colors cursor-pointer ${
                          viewType === 'code'
                            ? 'bg-surface text-ink font-semibold shadow-hairline'
                            : 'text-ink-3 hover:text-ink'
                        }`}
                      >
                        {t('fullCode')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenInEditor(selectedFilePath)}
                    className="h-8 px-2.5 rounded-[7px] text-[12.5px] font-medium text-ink-2 hover:text-ink hover:bg-hover flex items-center gap-1.5 transition-colors cursor-pointer"
                    title={t('openInEditor')}
                  >
                    <ExternalLink size={14} />
                    <span>{t('openInEditor')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReveal(selectedFilePath)}
                    className="h-8 px-2.5 rounded-[7px] text-[12.5px] font-medium text-ink-2 hover:text-ink hover:bg-hover flex items-center gap-1.5 transition-colors cursor-pointer"
                    title={isMac ? t('revealInFinder') : t('revealInExplorer')}
                  >
                    <Folder size={14} />
                    <span>{isMac ? t('revealInFinder') : t('revealInExplorer')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyPath(selectedFilePath)}
                    className="h-8 px-2.5 rounded-[7px] text-[12.5px] font-medium text-ink-2 hover:text-ink hover:bg-hover flex items-center gap-1.5 transition-colors cursor-pointer"
                    title={t('copyRelativePath')}
                  >
                    {copiedNotification ? (
                      <Check size={14} className="text-green" />
                    ) : (
                      <Copy size={14} />
                    )}
                    <span>{copiedNotification ? t('pathCopied') : t('copyPath')}</span>
                  </button>
                </div>
              </div>

              {/* Diff / Code Viewer */}
              <div data-slot="session-review-v2-preview-scroll" data-review-diff-flush="" className="h-full">
                {viewType === 'diff' ? (
                  isLoadingDiff ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[300px] py-16 text-center px-4 text-ink-3">
                      <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
                      <p className="text-[12px] text-ink-3">{t('loadingDiff')}</p>
                    </div>
                  ) : fileDiffPatch ? (
                    fileDiffPatch.includes('Binary files') || fileDiffPatch.includes('GIT binary patch') ? (
                      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                        <FileCode className="w-10 h-10 text-ink-3 mb-2 stroke-[1.5]" />
                        <p className="text-[13px] font-medium text-ink mb-1">
                          {t('binaryDiffTitle')}
                        </p>
                        <p className="text-[12px] text-ink-3 max-w-sm">
                          {t('binaryDiffDesc')}
                        </p>
                      </div>
                    ) : parsedDiffRows.length > 0 ? (
                      <CodeBlock
                        variant="Diff"
                        flush
                        filename={basename(selectedFilePath)}
                        code={diffCode}
                        diff={parsedDiffRows}
                        labels={{ copy: t('copy') || 'Copy', copied: t('copied') || 'Copied' }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                        <CheckCircle2 className="w-10 h-10 text-green mb-2 stroke-[1.5]" />
                        <p className="text-[13px] font-medium text-ink mb-1">
                          {t('noDiffTitle')}
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                      <CheckCircle2 className="w-10 h-10 text-green mb-2 stroke-[1.5]" />
                      <p className="text-[13px] font-medium text-ink mb-1">
                        {t('noDiffTitle')}
                      </p>
                    </div>
                  )
                ) : (
                  isLoadingContent ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[300px] py-16 text-center px-4 text-ink-3">
                      <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
                      <p className="text-[12px] text-ink-3">{t('loadingFile')}</p>
                    </div>
                  ) : gitStatusMap.get(selectedFilePath)?.status === 'deleted' ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                      <FileCode className="w-10 h-10 text-ink-3 mb-2 stroke-[1.5]" />
                      <p className="text-[13px] font-medium text-ink mb-1">
                        {t('fileDeletedTitle')}
                      </p>
                      <p className="text-[12px] text-ink-3 max-w-sm mb-3">
                        {t('fileDeletedDesc')}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDiscardConfirmFiles([selectedFilePath])}
                        className="h-7.5 px-3 rounded-[6px] text-[12px] font-medium text-ink bg-field hover:bg-hover transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw size={12} />
                        <span>{t('restoreFile')}</span>
                      </button>
                    </div>
                  ) : fileContent !== null && !fileContent.includes('\0') && !selectedFilePath.endsWith('.pyc') ? (
                    <CodeBlock
                      variant="Code"
                      flush
                      filename={basename(selectedFilePath)}
                      code={fileContent}
                      labels={{ copy: t('copy') || 'Copy', copied: t('copied') || 'Copied' }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                      <FileCode className="w-10 h-10 text-ink-3 mb-2 stroke-[1.5]" />
                      <p className="text-[13px] text-ink-3 max-w-sm">
                        {t('binaryPreviewFallback')}
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>

          ) : selectedCommitDetail ? (

            /* 2. Historical Commit Detail Mode */
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              {/* Commit info header */}
              <div className="p-4 border-b border-line bg-page flex flex-col gap-2 shrink-0">
                <div className="text-[15px] font-semibold text-ink leading-snug">
                  {selectedCommitDetail.subject}
                </div>
                {selectedCommitDetail.body && (
                  <p className="text-[13px] text-ink-2 whitespace-pre-wrap leading-relaxed">
                    {selectedCommitDetail.body}
                  </p>
                )}
                <div className="flex items-center gap-3 text-[12px] text-ink-3 font-mono">
                  <span>{selectedCommitDetail.author}</span>
                  <span>{selectedCommitDetail.date} ({selectedCommitDetail.relativeDate})</span>
                  <span className="bg-field px-2 py-0.5 rounded text-[11px] text-ink-3">{selectedCommitDetail.hash}</span>
                </div>

                {/* Commit changed files pill list */}
                {selectedCommitDetail.files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                    <span className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-wider mr-1">
                      {t('changedFilesCount', { count: selectedCommitDetail.files.length })}
                    </span>
                    {selectedCommitDetail.files.map((cf) => {
                      const active = selectedCommitFile === cf.file;
                      return (
                        <button
                          key={cf.file}
                          type="button"
                          onClick={() => handleSelectCommitFile(selectedCommitDetail.hash, cf.file)}
                          className={`h-7.5 px-2.5 rounded-[7px] text-[12px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
                            active
                              ? 'bg-hover-2 text-ink font-semibold shadow-hairline'
                              : 'text-ink-2 hover:bg-hover hover:text-ink'
                          }`}
                        >
                          <span data-slot="session-review-v2-file-kind" data-kind={cf.status} className="font-semibold text-[10.5px]">
                            {kindMark(cf.status)}
                          </span>
                          <span>{cf.file}</span>
                          {cf.additions > 0 && <span className="text-green text-[11px]">+{cf.additions}</span>}
                          {cf.deletions > 0 && <span className="text-red-500 text-[11px]">-{cf.deletions}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Commit file diff */}
              <div data-slot="session-review-v2-preview-scroll" data-review-diff-flush="" className="h-full">
                {isLoadingCommitDiff || isLoadingCommitDetail ? (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] py-16 text-center px-4 text-ink-3">
                    <LoaderCircle className="w-5 h-5 animate-spin mb-2.5 text-ink-3 stroke-[1.8]" />
                    <p className="text-[12px] text-ink-3">{t('loadingDiff')}</p>
                  </div>
                ) : selectedCommitFileDiff ? (
                  selectedCommitFileDiff.includes('Binary files') || selectedCommitFileDiff.includes('GIT binary patch') ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                      <FileCode className="w-10 h-10 text-ink-3 mb-2 stroke-[1.5]" />
                      <p className="text-[13px] font-medium text-ink mb-1">
                        {t('binaryDiffTitle')}
                      </p>
                      <p className="text-[12px] text-ink-3 max-w-sm">
                        {t('binaryDiffDesc')}
                      </p>
                    </div>
                  ) : parsedCommitDiffRows.length > 0 ? (
                    <CodeBlock
                      variant="Diff"
                      flush
                      filename={selectedCommitFile || 'diff'}
                      code={commitDiffCode}
                      diff={parsedCommitDiffRows}
                      labels={{ copy: t('copy') || 'Copy', copied: t('copied') || 'Copied' }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                      <CheckCircle2 className="w-10 h-10 text-green mb-2 stroke-[1.5]" />
                      <p className="text-[13px] font-medium text-ink mb-1">
                        {t('noDiffTitle')}
                      </p>
                    </div>
                  )
                ) : (
                  <div className="p-8 text-[12px] text-ink-3 text-center">
                    {t('selectFileToViewDiff')}
                  </div>
                )}
              </div>
            </div>

          ) : (

            /* 3. Empty State */
            <div data-slot="session-review-v2-empty">
              {!isRepo ? (
                <div data-slot="session-review-v2-empty-no-git">
                  <FileCode2 size={24} strokeWidth={1.7} className="text-ink-3" aria-hidden="true" />
                  <div data-slot="session-review-v2-empty-no-git-title">
                    {t('reviewEmptyNoGitTitle')}
                  </div>
                  <div data-slot="session-review-v2-empty-no-git-description">
                    {t('reviewEmptyNoGitDescription')}
                  </div>
                  <button
                    type="button"
                    data-review-init-git=""
                    onClick={handleInitGit}
                  >
                    {t('reviewEmptyNoGitAction')}
                  </button>
                </div>
              ) : (
                <div data-slot="session-review-v2-empty-changes">
                  <GitBranch size={24} strokeWidth={1.7} className="text-ink-3" aria-hidden="true" />
                  <div data-slot="session-review-v2-empty-changes-title">
                    {t('reviewEmptyChangesTitle')}
                  </div>
                  <div data-slot="session-review-v2-empty-changes-description">
                    {t('reviewEmptyChangesDescription')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Discard Confirmation Modal (Non-blocking, elegant dialog) */}
      {discardConfirmFiles && (
        <div
          onClick={() => setDiscardConfirmFiles(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[10px] bg-surface border border-line p-5 shadow-overlay flex flex-col gap-3"
          >
            <div className="flex items-center gap-2 text-red-500 font-semibold text-[14px]">
              <AlertCircle size={18} />
              <span>{t('discardConfirmTitle')}</span>
            </div>
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              {t('discardConfirmPrompt', { count: discardConfirmFiles.length })}
            </p>
            <div className="max-h-32 overflow-y-auto rounded-[8px] bg-field p-2.5 text-[11.5px] font-mono text-ink-2 flex flex-col gap-1">
              {discardConfirmFiles.slice(0, 6).map((f) => (
                <div key={f} className="truncate">{f}</div>
              ))}
              {discardConfirmFiles.length > 6 && (
                <div className="text-ink-3">{t('discardConfirmMore', { count: discardConfirmFiles.length - 6 })}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDiscardConfirmFiles(null)}
                className="h-8 px-3.5 rounded-[7px] text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink transition-colors cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleExecuteDiscard(discardConfirmFiles)}
                className="h-8 px-3.5 rounded-[7px] bg-red-500 hover:bg-red-600 text-white font-medium text-[12.5px] transition-colors cursor-pointer"
              >
                {t('confirmDiscard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

CodeTreeManager.displayName = 'CodeTreeManager';
