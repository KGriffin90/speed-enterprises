import * as SecureStore from 'expo-secure-store';
import {
  apiCall, ApiError, saveSession, clearSession, getStoredSession,
  refreshAccessToken, revokeAndClearSession, setOnSessionExpired,
  __resetAuthStateForTests,
} from './api';

const BASE = 'http://localhost:4000';

/** Build a minimal fetch Response stand-in. */
function res(status: number, body: any, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as any;
}

const store = (SecureStore as any).__store as Map<string, string>;

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  __resetAuthStateForTests(); // clear single-flight refresh + expiry callback
  global.fetch = jest.fn();
});

describe('apiCall — request shaping', () => {
  it('sends bearer token + X-Tenant-Slug and parses JSON', async () => {
    await saveSession('tok', 'ref', 'acme', { user: { id: 'u' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce(res(200, { ok: true }));

    const out = await apiCall<{ ok: boolean }>('GET', '/api/quotes/mine');

    expect(out).toEqual({ ok: true });
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${BASE}/api/quotes/mine`);
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers['X-Tenant-Slug']).toBe('acme');
    expect(opts.body).toBeUndefined();
  });

  it('omits auth/tenant headers when unauthenticated, and serializes a body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(res(200, {}));

    await apiCall('POST', '/api/public/quotes', { a: 1 });

    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
    expect(opts.headers['X-Tenant-Slug']).toBeUndefined();
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('returns text for non-JSON responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(res(200, 'pong', 'text/plain'));
    expect(await apiCall('GET', '/health')).toBe('pong');
  });

  it('throws ApiError with status + parsed body on non-2xx', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(res(403, { message: 'nope' }));
    // message/name are non-enumerable on Error, so assert by direct access.
    const err = (await apiCall('GET', '/api/admin/quotes').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('nope');
    expect(err.body).toEqual({ message: 'nope' });
  });
});

describe('apiCall — 401 refresh + retry', () => {
  it('refreshes once on 401 then retries with the new token', async () => {
    await saveSession('old', 'r1', 'acme', { user: { id: 'u' } });
    let quotesHits = 0;
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return res(200, { accessToken: 'new', refreshToken: 'r2', user: { id: 'u' }, tenant: { slug: 'acme' } });
      }
      quotesHits += 1;
      return quotesHits === 1 ? res(401, { message: 'expired' }) : res(200, { data: true });
    });

    const out = await apiCall<{ data: boolean }>('GET', '/api/quotes/mine');

    expect(out).toEqual({ data: true });
    expect(await SecureStore.getItemAsync('access_token')).toBe('new');
    expect(await SecureStore.getItemAsync('refresh_token')).toBe('r2');
    // retry used the refreshed token
    const lastCall = (global.fetch as jest.Mock).mock.calls.at(-1)!;
    expect(lastCall[1].headers.Authorization).toBe('Bearer new');
  });

  it('does NOT attempt refresh for /api/auth/* paths (no recursion)', async () => {
    await saveSession('old', 'r1', 'acme', { user: { id: 'u' } });
    (global.fetch as jest.Mock).mockResolvedValue(res(401, { message: 'bad creds' }));

    await expect(apiCall('POST', '/api/auth/login', {})).rejects.toMatchObject({ status: 401 });
    // only the login call — never the refresh endpoint
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('on failed refresh: clears session, fires onSessionExpired, throws 401', async () => {
    await saveSession('old', 'r1', 'acme', { user: { id: 'u' } });
    const onExpired = jest.fn();
    setOnSessionExpired(onExpired);
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) return res(401, { message: 'refresh dead' });
      return res(401, { message: 'expired' });
    });

    await expect(apiCall('GET', '/api/quotes/mine')).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(await SecureStore.getItemAsync('access_token')).toBeNull();
    expect(await SecureStore.getItemAsync('refresh_token')).toBeNull();
  });

  it('does not loop forever if the refreshed token still 401s', async () => {
    await saveSession('old', 'r1', 'acme', { user: { id: 'u' } });
    let refreshCalls = 0;
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return res(200, { accessToken: 'new', refreshToken: 'r2', user: { id: 'u' }, tenant: { slug: 'acme' } });
      }
      return res(401, { message: 'still expired' });
    });

    await expect(apiCall('GET', '/api/quotes/mine')).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1); // retried once, not infinitely
  });

  it('collapses concurrent 401s into a single refresh (single-flight)', async () => {
    await saveSession('old', 'r1', 'acme', { user: { id: 'u' } });
    let refreshCalls = 0;
    const seen: Record<string, number> = {};
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return res(200, { accessToken: 'new', refreshToken: 'r2', user: { id: 'u' }, tenant: { slug: 'acme' } });
      }
      seen[url] = (seen[url] ?? 0) + 1;
      return seen[url] === 1 ? res(401, { message: 'expired' }) : res(200, { ok: url });
    });

    const [a, b] = await Promise.all([
      apiCall('GET', '/api/a'),
      apiCall('GET', '/api/b'),
    ]);
    expect(a).toEqual({ ok: `${BASE}/api/a` });
    expect(b).toEqual({ ok: `${BASE}/api/b` });
    expect(refreshCalls).toBe(1);
  });
});

describe('refreshAccessToken', () => {
  it('returns null when there is no refresh token', async () => {
    expect(await refreshAccessToken()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('persists rotated tokens + tenant slug on success', async () => {
    await SecureStore.setItemAsync('refresh_token', 'r1');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      res(200, { accessToken: 'A', refreshToken: 'B', user: { id: 'u' }, tenant: { slug: 'beta' } }),
    );
    expect(await refreshAccessToken()).toBe('A');
    expect(await SecureStore.getItemAsync('access_token')).toBe('A');
    expect(await SecureStore.getItemAsync('refresh_token')).toBe('B');
    expect(await SecureStore.getItemAsync('tenant_slug')).toBe('beta');
  });

  it('returns null on a non-OK refresh and a thrown fetch (network error)', async () => {
    await SecureStore.setItemAsync('refresh_token', 'r1');
    (global.fetch as jest.Mock).mockResolvedValueOnce(res(401, { message: 'x' }));
    expect(await refreshAccessToken()).toBeNull();

    await SecureStore.setItemAsync('refresh_token', 'r1');
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    expect(await refreshAccessToken()).toBeNull();
  });
});

describe('revokeAndClearSession', () => {
  it('revokes the refresh token server-side, then clears local storage', async () => {
    await saveSession('tok', 'r1', 'acme', { user: { id: 'u' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce(res(200, {}));

    await revokeAndClearSession();

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${BASE}/api/auth/logout`);
    expect(JSON.parse(opts.body)).toEqual({ refreshToken: 'r1' });
    expect(await SecureStore.getItemAsync('access_token')).toBeNull();
    expect(await SecureStore.getItemAsync('refresh_token')).toBeNull();
  });

  it('still clears locally if the logout request fails (best-effort)', async () => {
    await saveSession('tok', 'r1', 'acme', { user: { id: 'u' } });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await expect(revokeAndClearSession()).resolves.toBeUndefined();
    expect(await SecureStore.getItemAsync('refresh_token')).toBeNull();
  });

  it('skips the network call when there is no refresh token', async () => {
    await revokeAndClearSession();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('session storage round-trip', () => {
  it('saves and reads back token/slug/session, and clears all keys', async () => {
    await saveSession('tok', 'ref', 'acme', { user: { id: 'u', email: 'a@b.c' } });
    const s = await getStoredSession();
    expect(s.token).toBe('tok');
    expect(s.slug).toBe('acme');
    expect(s.session).toEqual({ user: { id: 'u', email: 'a@b.c' } });

    await clearSession();
    expect(await getStoredSession()).toEqual({ token: null, slug: null, session: null });
  });
});

describe('ApiError', () => {
  it('uses body.message when present, else a generic message', () => {
    expect(new ApiError(500, { message: 'boom' }).message).toBe('boom');
    expect(new ApiError(502, 'gateway').message).toBe('API 502');
  });
});
