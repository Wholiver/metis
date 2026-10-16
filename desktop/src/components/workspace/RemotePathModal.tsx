import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, FolderOpen, LoaderCircle, Server, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Button } from '../atoms/Button';

export interface RemotePathModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (remotePath: string) => Promise<void> | void;
  initialPath?: string;
}

const RECENT_REMOTE_PATHS_KEY = 'metis:recent-remote-workspaces';
const MAX_RECENT_PATHS = 8;

export function getRecentRemotePaths(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REMOTE_PATHS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function saveRecentRemotePath(remotePath: string): void {
  try {
    const trimmed = remotePath.trim();
    if (!trimmed) return;
    const recents = getRecentRemotePaths().filter((p) => p !== trimmed);
    recents.unshift(trimmed);
    localStorage.setItem(RECENT_REMOTE_PATHS_KEY, JSON.stringify(recents.slice(0, MAX_RECENT_PATHS)));
  } catch {}
}

export const RemotePathModal: React.FC<RemotePathModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  initialPath = '',
}) => {
  const { t, language } = useI18n();
  const isZh = language?.startsWith('zh');

  const tr = useCallback(
    (key: string, zhText: string, enText: string): string => {
      const val = t(key);
      if (!val || val === key) return isZh ? zhText : enText;
      return val;
    },
    [t, isZh],
  );

  const [inputPath, setInputPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputPath(initialPath || '');
      setError(null);
      setIsValidating(false);
      setRecentPaths(getRecentRemotePaths());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialPath]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = inputPath.trim();
    if (!trimmed) {
      setError(tr('remotePathEmpty', '请输入远程工作区绝对路径', 'Please enter a remote workspace path'));
      return;
    }
    setError(null);
    setIsValidating(true);
    try {
      const desktop = (window as any).metisDesktop;
      if (desktop?.workspace?.validate) {
        const result = await desktop.workspace.validate(trimmed);
        if (result && result.valid === false) {
          setError(result.error || tr('remotePathInvalid', '远程路径不存在或不是目录', 'Remote path does not exist or is not a directory'));
          setIsValidating(false);
          return;
        }
        const resolved = result?.resolved || trimmed;
        saveRecentRemotePath(resolved);
        await onSelect(resolved);
      } else {
        saveRecentRemotePath(trimmed);
        await onSelect(trimmed);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || tr('remotePathValidateFailed', '校验远程路径失败', 'Failed to validate remote path'));
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        data-remote-path-modal=""
        className="flex w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden rounded-window bg-surface shadow-overlay border border-line/60 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-path-modal-title"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3 border-b border-line/60">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-inset text-ink-2">
              <Server className="h-4 w-4 stroke-[1.8]" />
            </span>
            <div className="min-w-0">
              <h2
                id="remote-path-modal-title"
                className="truncate text-[15px] font-medium tracking-tight text-ink"
              >
                {tr('openRemoteWorkspace', '打开远程工作区', 'Open Remote Workspace')}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {tr(
                  'openRemoteWorkspaceHint',
                  '输入远程服务器上的项目绝对路径（如 /home/user/project）',
                  'Enter the absolute project path on the remote server',
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none cursor-pointer"
            title={tr('close', '关闭', 'Close')}
            aria-label={tr('close', '关闭', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-4 px-6 py-4 text-[13px]">
            {error && (
              <div className="flex items-center gap-2 rounded-control border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="remote-workspace-path-input"
                className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
              >
                {tr('remotePathLabel', '远程绝对路径', 'Remote Absolute Path')}
              </label>
              <div className="relative flex items-center">
                <input
                  id="remote-workspace-path-input"
                  ref={inputRef}
                  type="text"
                  value={inputPath}
                  onChange={(e) => {
                    setInputPath(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="/home/username/my-project"
                  disabled={isValidating}
                  className="w-full rounded-control border border-line bg-field px-3 py-2 text-[13px] font-mono text-ink outline-none transition-[box-shadow,border-color] placeholder:text-ink-4 focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]"
                />
              </div>
            </div>

            {recentPaths.length > 0 && (
              <div>
                <span className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
                  <Clock className="h-3.5 w-3.5" />
                  {tr('recentRemotePaths', '最近打开的远程路径', 'Recent Remote Paths')}
                </span>
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-control border border-line/50 p-1 bg-inset/40">
                  {recentPaths.map((recent) => (
                    <button
                      key={recent}
                      type="button"
                      onClick={() => {
                        setInputPath(recent);
                        if (error) setError(null);
                      }}
                      className="flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] font-mono text-ink-2 transition-colors hover:bg-hover hover:text-ink cursor-pointer truncate"
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                      <span className="truncate">{recent}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-line/60 bg-inset/20">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isValidating}>
              {tr('cancel', '取消', 'Cancel')}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isValidating || !inputPath.trim()}>
              {isValidating ? (
                <>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  <span>{tr('validating', '校验中…', 'Validating…')}</span>
                </>
              ) : (
                <span>{tr('open', '打开', 'Open')}</span>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
