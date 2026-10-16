import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/core/session-manager.ts';

describe('SessionManager deduplication', () => {
  it('does not duplicate sessions for case-differing directories on case-insensitive systems', async () => {
    // Test with newapp which has existing sessions on this system
    const sessions = await SessionManager.list('/Users/huchenrui/newapp');
    const ids = sessions.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('returns distinct session objects when listing sessions', async () => {
    const sessions = await SessionManager.list(process.cwd());
    const ids = sessions.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});
