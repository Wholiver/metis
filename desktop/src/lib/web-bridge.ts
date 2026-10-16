/**
 * Web Desktop Bridge
 *
 * Provides a seamless fallback for window.metisDesktop when running inside
 * standard web browsers outside Electron (such as when served by Metis Server).
 */

export function initWebDesktopBridge(): void {
  if (typeof window === 'undefined') return;
  if ((window as any).metisDesktop) return;

  const eventListeners = new Set<(event: unknown) => void>();
  const disconnectListeners = new Set<(msg?: unknown) => void>();
  let eventSource: EventSource | null = null;

  function ensureEventSource() {
    if (eventSource) return;
    try {
      eventSource = new EventSource('/events');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          for (const listener of eventListeners) {
            listener(data);
          }
        } catch {}
      };
      eventSource.onerror = (err) => {
        for (const listener of disconnectListeners) {
          listener(err);
        }
      };
    } catch {}
  }

  const isMac = /macintosh|mac os x/i.test(navigator.userAgent);
  const isWin = /windows|win32/i.test(navigator.userAgent);
  const platform = isMac ? 'darwin' : isWin ? 'win32' : 'linux';

  (window as any).metisDesktop = {
    isWeb: true,
    platform,
    metis: {
      getConnection: async () => ({
        baseUrl: window.location.origin,
        username: 'metis',
      }),
      connect: async (_options?: unknown) => ({
        ok: true,
        data: { baseUrl: window.location.origin, username: 'metis' },
      }),
      disconnect: async () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      },
      request: async ({ path, method = 'GET', body, timeoutMs }: { path: string; method?: string; body?: unknown; timeoutMs?: number }) => {
        try {
          const res = await fetch(path, {
            method,
            headers: {
              Accept: 'application/json',
              ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
          });
          const text = await res.text();
          let data;
          try {
            data = text ? JSON.parse(text) : undefined;
          } catch {
            data = text;
          }
          return { ok: res.ok, status: res.status, data };
        } catch (error: any) {
          return { ok: false, status: 0, error: error?.message || String(error) };
        }
      },
      onEvent: (listener: (event: unknown) => void) => {
        eventListeners.add(listener);
        ensureEventSource();
        return () => {
          eventListeners.delete(listener);
          if (eventListeners.size === 0 && disconnectListeners.size === 0 && eventSource) {
            eventSource.close();
            eventSource = null;
          }
        };
      },
      onDisconnect: (listener: (msg?: unknown) => void) => {
        disconnectListeners.add(listener);
        ensureEventSource();
        return () => {
          disconnectListeners.delete(listener);
        };
      },
      onServerReady: () => () => {},
    },
    workspace: {
      isRemote: async () => true,
      get: async () => {
        try {
          const res = await fetch('/workspace/summary');
          if (res.ok) {
            const data = await res.json();
            return { ...data, isRemote: true };
          }
        } catch {}
        return { name: 'workspace', path: '', isGitRepo: false, isRemote: true };
      },
      set: async (workspacePath: string) => {
        try {
          await fetch('/session/new', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd: workspacePath, collaborationMode: 'build' }),
          });
          const res = await fetch(`/workspace/summary?cwd=${encodeURIComponent(workspacePath)}`);
          if (res.ok) {
            return { ...(await res.json()), isRemote: true };
          }
        } catch {}
        return { name: workspacePath.split(/[/\\]/).filter(Boolean).pop() || 'Project', path: workspacePath, isGitRepo: false, isRemote: true };
      },
      validate: async (targetPath: string) => {
        try {
          const res = await fetch('/workspace/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: targetPath }),
          });
          return await res.json();
        } catch (err: any) {
          return { valid: false, error: err?.message || 'Validation request failed' };
        }
      },
      select: async () => ({ isRemote: true }),
      tree: async (targetDir?: string) => {
        try {
          const query = targetDir ? `?targetDir=${encodeURIComponent(targetDir)}&cwd=${encodeURIComponent(targetDir)}` : '';
          const res = await fetch(`/workspace/tree${query}`);
          if (res.ok) return await res.json();
        } catch {}
        return { root: { name: '', path: '', isGitRepo: false }, nodes: [], truncated: false };
      },
      diff: async (relativePath: string) => {
        try {
          const res = await fetch(`/workspace/git-diff?path=${encodeURIComponent(relativePath)}&mode=git`);
          if (res.ok) return await res.json();
        } catch {}
        return { path: relativePath, diff: '', truncated: false };
      },
      gitInfo: async (targetDir?: string) => {
        try {
          const query = targetDir ? `?cwd=${encodeURIComponent(targetDir)}` : '';
          const res = await fetch(`/workspace/git-info${query}`);
          if (res.ok) return await res.json();
        } catch {}
        return { isRepo: false, branch: null, defaultBranch: null };
      },
      gitStatus: async (mode = 'git', targetDir?: string) => {
        try {
          const cwdParam = targetDir ? `&cwd=${encodeURIComponent(targetDir)}` : '';
          const res = await fetch(`/workspace/git-status?mode=${mode}${cwdParam}`);
          if (res.ok) return await res.json();
        } catch {}
        return { info: { isRepo: false, branch: null, defaultBranch: null }, files: [] };
      },
      gitDiff: async (relativePath: string, mode = 'git', targetDir?: string) => {
        try {
          const cwdParam = targetDir ? `&cwd=${encodeURIComponent(targetDir)}` : '';
          const res = await fetch(`/workspace/git-diff?path=${encodeURIComponent(relativePath)}&mode=${mode}${cwdParam}`);
          if (res.ok) return await res.json();
        } catch {}
        return { path: relativePath, diff: '', truncated: false };
      },
      gitBranches: async () => ({ current: '', branches: [] }),
      gitHistory: async () => [],
      readFile: async (relativePath: string, targetDir?: string) => {
        try {
          const cwdParam = targetDir ? `&cwd=${encodeURIComponent(targetDir)}` : '';
          const res = await fetch(`/workspace/file?path=${encodeURIComponent(relativePath)}${cwdParam}`);
          if (res.ok) {
            const data = await res.json();
            return data.content ?? '';
          }
        } catch {}
        return '';
      },
    },
    clipboard: {
      writeText: async (text: string) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank');
    },
  };
}
