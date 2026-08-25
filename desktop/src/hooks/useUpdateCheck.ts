import { useCallback, useEffect, useRef, useState } from 'react';

/** Where users download a new Desktop build. Matches the repository in package.json. */
export const RELEASES_URL = 'https://github.com/Wholiver/metis/releases/latest';

export type UpdateCheckStatus = 'idle' | 'checking' | 'available' | 'current' | 'failed';

export type UpdateCheckState = {
  status: UpdateCheckStatus;
  currentVersion?: string;
  latestVersion?: string;
  note?: string;
  error?: string;
};

type UpdateCheckResponse = {
  currentVersion?: string;
  updateAvailable?: boolean;
  checkFailed?: boolean;
  latest?: { version?: string; note?: string };
};

/**
 * Reads the release manifest through the desktop IPC channel, which forwards to
 * the CLI server endpoint (`GET /global/update-check`). The check needs the local
 * server, so the automatic run waits until the renderer is connected.
 */
export function useUpdateCheck(isConnected: boolean) {
  const [state, setState] = useState<UpdateCheckState>({ status: 'idle' });
  const autoCheckedRef = useRef(false);

  const check = useCallback(async () => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.update?.check) {
      setState({ status: 'failed', error: 'Update check is unavailable in this Desktop build.' });
      return;
    }
    setState((current) => ({ ...current, status: 'checking', error: undefined }));
    try {
      const result = await desktop.update.check();
      // `ok: false` means the local server could not be reached at all, which is
      // different from the manifest lookup itself failing.
      if (!result?.ok) {
        setState({ status: 'failed', error: result?.error || 'Could not reach the local Metis server.' });
        return;
      }
      const data: UpdateCheckResponse = result.data || {};
      if (data.checkFailed || !data.currentVersion) {
        setState({
          status: 'failed',
          currentVersion: data.currentVersion,
          error: 'Could not read the release manifest. Check your network connection.',
        });
        return;
      }
      setState({
        status: data.updateAvailable ? 'available' : 'current',
        currentVersion: data.currentVersion,
        latestVersion: data.latest?.version,
        note: data.latest?.note,
      });
    } catch (cause) {
      setState({ status: 'failed', error: cause instanceof Error ? cause.message : String(cause) });
    }
  }, []);

  useEffect(() => {
    if (!isConnected || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void check();
  }, [check, isConnected]);

  return { updateCheck: state, checkForUpdates: check };
}
