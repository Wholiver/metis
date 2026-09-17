import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_SESSIONS_STORAGE_KEY,
  archiveSession,
  archivedSessionIds,
  listArchivedSessions,
  loadArchivedSessions,
  parseArchivedSessions,
  saveArchivedSessions,
  unarchiveSession,
} from '../desktop/src/lib/archived-sessions';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    raw: store,
  };
}

describe('desktop archived sessions', () => {
  it('parses, archives, lists, and unarchives sessions', () => {
    const empty = parseArchivedSessions(null);
    expect(empty).toEqual({});

    let sessions = archiveSession({}, {
      id: 's1',
      name: 'Hello',
      sessionPath: '/tmp/s1.jsonl',
      projectPath: '/tmp/project',
      archivedAt: '2026-09-13T01:00:00.000Z',
    });
    sessions = archiveSession(sessions, {
      id: 's2',
      name: 'Later',
      sessionPath: '/tmp/s2.jsonl',
      archivedAt: '2026-09-13T02:00:00.000Z',
    });

    expect(archivedSessionIds(sessions)).toEqual(new Set(['s1', 's2']));
    expect(listArchivedSessions(sessions).map((item) => item.id)).toEqual(['s2', 's1']);

    sessions = unarchiveSession(sessions, 's1');
    expect(sessions).not.toHaveProperty('s1');
    expect(sessions).toHaveProperty('s2');
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const sessions = archiveSession({}, {
      id: 's1',
      name: 'Stored',
      sessionPath: '/tmp/s1.jsonl',
      archivedAt: '2026-09-13T03:00:00.000Z',
    });
    saveArchivedSessions(sessions, storage);
    expect(storage.raw[ARCHIVED_SESSIONS_STORAGE_KEY]).toContain('"s1"');
    expect(loadArchivedSessions(storage)).toEqual(sessions);
  });

  it('ignores malformed storage payloads', () => {
    expect(parseArchivedSessions('{')).toEqual({});
    expect(parseArchivedSessions(JSON.stringify({ bad: { id: 1 } }))).toEqual({});
    expect(parseArchivedSessions(JSON.stringify({
      s1: { id: 'other', name: 'x', sessionPath: '/tmp/x.jsonl', archivedAt: '2026-09-13T00:00:00.000Z' },
    }))).toEqual({});
  });
});
