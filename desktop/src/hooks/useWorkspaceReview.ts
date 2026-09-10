import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantContentPart } from '../types';
import type { DiffRow } from '../components/primitives/CodeBlock';
import { collectTurnFileDiffs } from '../lib/tool-diff';
import {
  filterReviewFiles,
  resolveReviewMode,
  reviewChangesOptions,
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
  selectedFileRef.current = selectedFile;

  const options = useMemo(() => reviewChangesOptions(info), [info]);
  const resolvedMode = resolveReviewMode(mode, options);
  const filteredFiles = useMemo(() => filterReviewFiles(files, filter), [files, filter]);
  const turnDiffs = useMemo(
    () => turnFilesToDiffs(collectTurnFileDiffs(toolParts, { workspacePath })),
    [toolParts, workspacePath],
  );

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

  useEffect(() => {
    if (!enabled) return;
    const workspace = desktopWorkspace();
    const requestId = ++requestIdRef.current;
    let cancelled = false;

    (async () => {
      setLoadingList(true);
      setError(null);
      try {
        let nextInfo: ReviewGitInfo = { isRepo: false, branch: null, defaultBranch: null };
        if (workspace?.gitInfo) {
          nextInfo = await workspace.gitInfo();
          if (cancelled || requestId !== requestIdRef.current) return;
          setInfo(nextInfo);
        }

        const nextOptions = reviewChangesOptions(nextInfo);
        setModeState((current) => resolveReviewMode(current, nextOptions));
        const activeMode = resolveReviewMode(
          (() => {
            try {
              return localStorage.getItem(sessionModeKey(sessionId)) || mode;
            } catch {
              return mode;
            }
          })(),
          nextOptions,
        );

        let list: ReviewFileDiff[] = [];
        if (activeMode === 'turn') {
          list = turnDiffs;
        } else if (workspace?.gitStatus) {
          const result = await workspace.gitStatus(activeMode);
          if (cancelled || requestId !== requestIdRef.current) return;
          setInfo(result.info);
          list = result.files;
        }

        if (cancelled || requestId !== requestIdRef.current) return;
        setFiles(list);
        const current = selectedFileRef.current;
        if (current && !list.some((item) => item.file === current)) {
          setSelectedFile(list[0]?.file ?? null);
        } else if (!current && list[0]) {
          setSelectedFile(list[0].file);
        }
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
  }, [enabled, workspacePath, sessionId, resolvedMode, turnDiffs, setSelectedFile]);

  useEffect(() => {
    if (!enabled || !selectedFile) {
      setPatch('');
      setRows([]);
      return;
    }
    const workspace = desktopWorkspace();
    let cancelled = false;
    setLoadingPatch(true);
    (async () => {
      try {
        if (resolvedMode === 'turn') {
          const match = turnDiffs.find((item) => item.file === selectedFile);
          if (!cancelled) {
            setRows(match?.rows || []);
            setPatch(match?.patch || '');
          }
          return;
        }
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
