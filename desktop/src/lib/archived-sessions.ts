export const ARCHIVED_SESSIONS_STORAGE_KEY = 'metis.desktop.archivedSessions.v1';

export type ArchivedSessionRecord = {
  id: string;
  name: string;
  sessionPath: string;
  projectPath?: string;
  archivedAt: string;
};

export type ArchivedSessionsMap = Record<string, ArchivedSessionRecord>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isArchivedSessionRecord(value: unknown): value is ArchivedSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as ArchivedSessionRecord;
  return (
    typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.name === 'string'
    && typeof record.sessionPath === 'string'
    && record.sessionPath.length > 0
    && typeof record.archivedAt === 'string'
    && (record.projectPath === undefined || typeof record.projectPath === 'string')
  );
}

export function parseArchivedSessions(raw: string | null | undefined): ArchivedSessionsMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: ArchivedSessionsMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!isArchivedSessionRecord(value)) continue;
      if (value.id !== id) continue;
      result[id] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function loadArchivedSessions(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): ArchivedSessionsMap {
  if (!storage) return {};
  return parseArchivedSessions(storage.getItem(ARCHIVED_SESSIONS_STORAGE_KEY));
}

export function saveArchivedSessions(
  sessions: ArchivedSessionsMap,
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  if (!storage) return;
  storage.setItem(ARCHIVED_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

export function listArchivedSessions(sessions: ArchivedSessionsMap): ArchivedSessionRecord[] {
  return Object.values(sessions).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export function archiveSession(
  sessions: ArchivedSessionsMap,
  record: Omit<ArchivedSessionRecord, 'archivedAt'> & { archivedAt?: string },
): ArchivedSessionsMap {
  if (!record.id || !record.sessionPath) return sessions;
  return {
    ...sessions,
    [record.id]: {
      id: record.id,
      name: record.name || 'Untitled conversation',
      sessionPath: record.sessionPath,
      projectPath: record.projectPath,
      archivedAt: record.archivedAt || new Date().toISOString(),
    },
  };
}

export function unarchiveSession(sessions: ArchivedSessionsMap, sessionId: string): ArchivedSessionsMap {
  if (!sessions[sessionId]) return sessions;
  const next = { ...sessions };
  delete next[sessionId];
  return next;
}

export function archivedSessionIds(sessions: ArchivedSessionsMap): Set<string> {
  return new Set(Object.keys(sessions));
}
