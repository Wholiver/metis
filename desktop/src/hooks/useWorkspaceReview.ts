import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantContentPart } from '../types';
import type { DiffRow } from '../components/primitives/CodeBlock';
import { collectTurnFileDiffs } from '../lib/tool-diff';
import {
  diffRowsEqual,
  filterReviewFiles,
  resolveReviewMode,
  reviewChangesOptions,
  reviewFilesEqual,
} from '../lib/review-diff';

export type ReviewMode = 'git' | 'branch' | 'turn';
export type ReviewFileStatus = 'added' | 'deleted' | 'modified';

export interface ReviewFileDiff {
  file: string;
  additions: number;
  deletions: number;
  status?: ReviewFileStatus;
  patch?: string;
  rows?: DiffRow[];
}

export interface ReviewGitInfo {
  isRepo: boolean;
  branch: string | null;
  defaultBranch: string | null;
}

export const SIDEBAR_WIDTH_DEFAULT = 240;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 480;
const PANEL_STORAGE_KEY = 'metis.review-panel-v2';

type PanelPersist = {
  sidebarOpened?: boolean;
  sidebarWidth?: number;
};

function desktopWorkspace() {
  return (window as any).metisDesktop?.workspace as {
    gitInfo?: () => Promise<ReviewGitInfo>;
    gitStatus?: (mode?: string) => Promise<{ info: ReviewGitInfo; files: ReviewFileDiff[] }>;
    gitDiff?: (path: string, mode?: string) => Promise<{ path: string; diff: string; truncated?: boolean }>;
    gitInit?: () => Promise<ReviewGitInfo>;
    diff?: (path: string) => Promise<{ path: string; diff: string; truncated?: boolean }>;
  } | undefined;
}

function readPanelPersist(): PanelPersist {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PanelPersist : {};
  } catch {
    return {};
  }
}

function writePanelPersist(patch: PanelPersist) {
  try {
    const next = { ...readPanelPersist(), ...patch };
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function sessionModeKey(sessionId: string | null | undefined) {
  return `metis.review-mode:${sessionId || 'default'}`;
}

function sessionFileKey(sessionId: string | null | undefined) {
  return `metis.review-file:${sessionId || 'default'}`;
}

function turnFilesToDiffs(files: ReturnType<typeof collectTurnFileDiffs>): ReviewFileDiff[] {
  return files.map((file) => ({
    file: file.path,
    additions: file.additions,
    deletions: file.deletions,
    rows: file.rows,
    status: file.additions > 0 && file.deletions === 0
      ? 'added'
      : file.deletions > 0 && file.additions === 0
      ? 'deleted'
      : 'modified',
  }));
}

export interface UseWorkspaceReviewOptions {
  sessionId?: string | null;
  workspacePath?: string;
  toolParts?: AssistantContentPart[];
  enabled?: boolean;
}

export function useWorkspaceReview({
  sessionId,
  workspacePath,
  toolParts = [],
  enabled = true,
}: UseWorkspaceReviewOptions) {
  const persist = useMemo(() => readPanelPersist(), []);
  const [info, setInfo] = useState<ReviewGitInfo>({ isRepo: false, branch: null, defaultBranch: null });
  const [mode, setModeState] = useState<ReviewMode>('turn');
  const [files, setFiles] = useState<ReviewFileDiff[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [patch, setPatch] = useState('');
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPatch, setLoadingPatch] = useState(false);
  const [initPending, setInitPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpened, setSidebarOpenedState] = useState(persist.sidebarOpened !== false);
  const [sidebarWidth, setSidebarWidthState] = useState(
    Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, persist.sidebarWidth || SIDEBAR_WIDTH_DEFAULT)),
  );
  const requestIdRef = useRef(0);
  const selectedFileRef = useRef<string | null>(null);
  const filesRef = useRef(files);
  const rowsRef = useRef(rows);
  const previousTurnDiffsRef = useRef<ReviewFileDiff[]>([]);
  selectedFileRef.current = selectedFile;
  filesRef.current = files;
  rowsRef.current = rows;

  const options = useMemo(() => reviewChangesOptions(info), [info]);
  const resolvedMode = resolveReviewMode(mode, options);
  const filteredFiles = useMemo(() => filterReviewFiles(files, filter), [files, filter]);
  const turnDiffs = useMemo(() => {
    const next = turnFilesToDiffs(collectTurnFileDiffs(toolParts, { workspacePath }));
    const previous = previousTurnDiffsRef.current;
    if (reviewFilesEqual(previous, next)) return previous;
    previousTurnDiffsRef.current = next;
    return next;
  }, [toolParts, workspacePath]);

  const setMode = useCallback((next: ReviewMode) => {
    setModeState(next);
    try {
      localStorage.setItem(sessionModeKey(sessionId), next);
    } catch {
      // ignore
    }
  }, [sessionId]);

  const setSelectedFile = useCallback((next: string | null) => {
    setSelectedFileState(next);
    selectedFileRef.current = next;
    try {
      if (next) localStorage.setItem(sessionFileKey(sessionId), next);
      else localStorage.removeItem(sessionFileKey(sessionId));
    } catch {
      // ignore
    }
  }, [sessionId]);

  const setSidebarOpened = useCallback((next: boolean) => {
    setSidebarOpenedState(next);
    writePanelPersist({ sidebarOpened: next });
  }, []);

  const setSidebarWidth = useCallback((next: number) => {
    const width = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(next)));
    setSidebarWidthState(width);
    writePanelPersist({ sidebarWidth: width });
  }, []);

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(sessionModeKey(sessionId));
      if (storedMode === 'git' || storedMode === 'branch' || storedMode === 'turn') {
        setModeState(storedMode);
      }
      setSelectedFileState(localStorage.getItem(sessionFileKey(sessionId)));
    } catch {
      // ignore
    }
  }, [sessionId]);

  const syncSelectedFile = useCallback((list: ReviewFileDiff[]) => {
    const current = selectedFileRef.current;
    if (current && list.some((item) => item.file === current)) return;
    const next = list[0]?.file ?? null;
    if (next !== current) setSelectedFile(next);
  }, [setSelectedFile]);

  useEffect(() => {
    if (!enabled) return;
    const workspace = desktopWorkspace();
    if (!workspace?.gitInfo) return;
    let cancelled = false;
    (async () => {
      try {
        const nextInfo = await workspace.gitInfo();
        if (cancelled) return;
        setInfo((current) => (
          current.isRepo === nextInfo.isRepo
          && current.branch === nextInfo.branch
          && current.defaultBranch === nextInfo.defaultBranch
            ? current
            : nextInfo
        ));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, workspacePath, sessionId]);

  useEffect(() => {
    if (!enabled) return;
    if (resolvedMode === 'turn') {
      setLoadingList(false);
      setFiles((current) => (reviewFilesEqual(current, turnDiffs) ? current : turnDiffs));
      syncSelectedFile(turnDiffs);
      return;
    }

    const workspace = desktopWorkspace();
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    if (filesRef.current.length === 0) setLoadingList(true);
    setError(null);
    (async () => {
      try {
        let list: ReviewFileDiff[] = [];
        if (workspace?.gitStatus) {
          const result = await workspace.gitStatus(resolvedMode);
          if (cancelled || requestId !== requestIdRef.current) return;
          setInfo((current) => (
            current.isRepo === result.info.isRepo
            && current.branch === result.info.branch
            && current.defaultBranch === result.info.defaultBranch
              ? current
              : result.info
          ));
          list = result.files;
        }
        if (cancelled || requestId !== requestIdRef.current) return;
        setFiles((current) => (reviewFilesEqual(current, list) ? current : list));
        syncSelectedFile(list);
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setFiles([]);
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, workspacePath, sessionId, resolvedMode, turnDiffs, syncSelectedFile]);

  useEffect(() => {
    if (!enabled || !selectedFile) {
      setPatch('');
      setRows([]);
      setLoadingPatch(false);
      return;
    }
    if (resolvedMode === 'turn') {
      const match = turnDiffs.find((item) => item.file === selectedFile);
      const nextRows = match?.rows || [];
      const nextPatch = match?.patch || '';
      setLoadingPatch(false);
      setRows((current) => (diffRowsEqual(current, nextRows) ? current : nextRows));
      setPatch((current) => (current === nextPatch ? current : nextPatch));
      return;
    }

    const workspace = desktopWorkspace();
    let cancelled = false;
    if (rowsRef.current.length === 0) setLoadingPatch(true);
    (async () => {
      try {
        if (workspace?.gitDiff) {
          const result = await workspace.gitDiff(selectedFile, resolvedMode);
          if (!cancelled) {
            setRows([]);
            setPatch(result.diff || '');
          }
          return;
        }
        if (workspace?.diff) {
          const result = await workspace.diff(selectedFile);
          if (!cancelled) {
            setRows([]);
            setPatch(result.diff || '');
          }
          return;
        }
        if (!cancelled) {
          setRows([]);
          setPatch('');
        }
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setPatch('');
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoadingPatch(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, selectedFile, resolvedMode, turnDiffs, workspacePath]);

  const refresh = useCallback(() => {
    setModeState((current) => current);
    setInfo((current) => ({ ...current }));
  }, []);

  const initGit = useCallback(async () => {
    const workspace = desktopWorkspace();
    if (!workspace?.gitInit) return;
    setInitPending(true);
    setError(null);
    try {
      const next = await workspace.gitInit();
      setInfo(next);
      setMode('git');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitPending(false);
    }
  }, [setMode]);

  const totals = useMemo(() => filteredFiles.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  ), [filteredFiles]);

  return {
    info,
    mode: resolvedMode,
    setMode,
    options,
    files,
    filteredFiles,
    filter,
    setFilter,
    selectedFile,
    setSelectedFile,
    patch,
    rows,
    loadingList,
    loadingPatch,
    initPending,
    initGit,
    refresh,
    error,
    sidebarOpened,
    setSidebarOpened,
    sidebarWidth,
    setSidebarWidth,
    totals,
  };
}
