import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_METIS_SERVER,
  localServerTarget,
  persistMetisServer,
  restoreMetisServer,
} = require('../desktop/server-connection.cjs') as {
  DEFAULT_METIS_SERVER: { baseUrl: string; username: string; password: string };
  localServerTarget: (baseUrl: string) => { baseUrl: string; hostname: string; port: number } | undefined;
  persistMetisServer: (server: { baseUrl: string; username: string; password?: string }) => { baseUrl: string; username: string };
  restoreMetisServer: (saved?: { baseUrl?: string; username?: string; password?: string }) => { baseUrl: string; username: string; password: string };
};

describe('desktop Server connection preferences', () => {
  it('restores the configured URL and username without persisting the password', () => {
    const persisted = persistMetisServer({
      baseUrl: 'http://127.0.0.1:5123/',
      username: 'operator',
      password: 'do-not-write-this',
    });
    expect(persisted).toEqual({ baseUrl: 'http://127.0.0.1:5123', username: 'operator' });
    expect(persisted).not.toHaveProperty('password');
    expect(restoreMetisServer(persisted)).toEqual({
      baseUrl: 'http://127.0.0.1:5123',
      username: 'operator',
      password: '',
    });
  });

  it('falls back safely when persisted connection data is invalid', () => {
    expect(restoreMetisServer({ baseUrl: 'file:///tmp/metis', username: '' })).toEqual(DEFAULT_METIS_SERVER);
  });

  it('maps a loopback URL to the managed Server host and selected port', () => {
    expect(localServerTarget('http://localhost:5123')).toEqual({
      baseUrl: 'http://localhost:5123',
      hostname: '127.0.0.1',
      port: 5123,
    });
    expect(localServerTarget('http://[::1]:6123')).toEqual({
      baseUrl: 'http://[::1]:6123',
      hostname: '::1',
      port: 6123,
    });
  });

  it('does not auto-start for remote, HTTPS, or path-prefixed Server URLs', () => {
    expect(localServerTarget('http://192.168.1.20:4096')).toBeUndefined();
    expect(localServerTarget('https://127.0.0.1:4096')).toBeUndefined();
    expect(localServerTarget('http://127.0.0.1:4096/metis')).toBeUndefined();
  });
});
