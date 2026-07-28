import * as SecureStore from 'expo-secure-store';

/**
 * Single source of truth for the API origin.
 * Dev: set EXPO_PUBLIC_API_URL in apps/mobile/.env (e.g. your LAN IP for a
 * physical device); falls back to localhost for simulators.
 * Production builds MUST point at an https origin — EXPO_PUBLIC_* vars are
 * inlined at build time, so a release build silently baked against localhost
 * would ship a dead app. Fail loudly instead.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

if (!__DEV__ && !API_URL.startsWith('https://')) {
  throw new Error(
    `Refusing to run a release build against a non-HTTPS API ("${API_URL}"). ` +
    'Set EXPO_PUBLIC_API_URL to your production https endpoint at build time.',
  );
}

/**
 * Single-tenant standalone: the one business this app serves. Used to theme the
 * signed-out (public storefront / quote) experience without a discovery step.
 */
export const DEFAULT_TENANT_SLUG = process.env.EXPO_PUBLIC_DEFAULT_TENANT ?? 'speedenterprises';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof (body as any)?.message === 'string' ? (body as any).message : `API ${status}`);
    this.name = 'ApiError';
  }
}

/** Network timeout for every request. Without this a hung connection leaves
 *  the UI on a spinner forever (bare fetch never times out on iOS). */
const REQUEST_TIMEOUT_MS = 15_000;

/** fetch with an AbortController timeout. Timeouts/network failures surface as
 *  ApiError(0) so every existing `e instanceof ApiError` handler shows a
 *  human-readable message instead of a TypeError. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new ApiError(0, { message: 'Request timed out. Check your connection and try again.' });
    }
    throw new ApiError(0, { message: 'Network error. Check your connection and try again.' });
  } finally {
    clearTimeout(timer);
  }
}

// Invoked when authentication is irrecoverable (refresh failed). The auth
// context registers a handler so the UI drops to the sign-in screen reactively.
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(cb: (() => void) | null) {
  onSessionExpired = cb;
}

/**
 * Core API call. Sends the bearer access token + X-Tenant-Slug — the exact
 * same credentials the web client sends, so every request runs through the
 * API's TenantMiddleware + role guards identically (no mobile-specific path).
 *
 * On a 401 it attempts a single token refresh and retries once. If the refresh
 * fails, the local session is cleared and `onSessionExpired` fires.
 */
export async function apiCall<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  _retried = false,
): Promise<T> {
  const token      = await SecureStore.getItemAsync('access_token');
  const tenantSlug = await SecureStore.getItemAsync('tenant_slug');

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token)      headers['Authorization'] = `Bearer ${token}`;
  if (tenantSlug) headers['X-Tenant-Slug'] = tenantSlug;

  const res = await fetchWithTimeout(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Access token likely expired (15m TTL) — refresh once and retry. Never
  // attempt this for the auth endpoints themselves (avoids recursion).
  if (res.status === 401 && !_retried && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiCall<T>(method, path, body, true);
    // Refresh failed → the session is dead. Clear it and notify the app.
    await clearSession();
    onSessionExpired?.();
  }

  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

// ── Session storage ─────────────────────────────────────────────────────────

export async function saveSession(
  accessToken: string,
  refreshToken: string,
  tenantSlug: string,
  sessionPayload: unknown,
) {
  // AFTER_FIRST_UNLOCK: keychain items stay readable while the device is locked
  // (after the first unlock since boot). Required so the background location task
  // can authenticate its waypoint POSTs when the phone is in a pocket. The default
  // (WHEN_UNLOCKED) would make getItemAsync return null mid-route while locked.
  const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
  await Promise.all([
    SecureStore.setItemAsync('access_token',  accessToken,  opts),
    SecureStore.setItemAsync('refresh_token', refreshToken, opts),
    SecureStore.setItemAsync('tenant_slug',   tenantSlug,   opts),
    SecureStore.setItemAsync('session_data',  JSON.stringify(sessionPayload), opts),
  ]);
}

export async function clearSession() {
  await Promise.all([
    SecureStore.deleteItemAsync('access_token'),
    SecureStore.deleteItemAsync('refresh_token'),
    SecureStore.deleteItemAsync('tenant_slug'),
    SecureStore.deleteItemAsync('session_data'),
  ]);
}

export async function getStoredSession() {
  const [token, slug, data] = await Promise.all([
    SecureStore.getItemAsync('access_token'),
    SecureStore.getItemAsync('tenant_slug'),
    SecureStore.getItemAsync('session_data'),
  ]);
  const session = data ? JSON.parse(data) : null;
  return { token, slug, session };
}

// ── Token refresh (single-flight) ────────────────────────────────────────────

interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: unknown;
  tenant?: { slug?: string } | null;
}

// Refresh-token rotation means two concurrent refreshes would invalidate each
// other; collapse all callers onto one in-flight request.
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await SecureStore.getItemAsync('refresh_token');
    if (!refreshToken) return null;
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as SessionResponse;
      const slug = data.tenant?.slug ?? (await SecureStore.getItemAsync('tenant_slug')) ?? '';
      await saveSession(data.accessToken, data.refreshToken, slug, { user: data.user, tenant: data.tenant ?? null });
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Test-only: reset module-level singletons (single-flight refresh + the
 * session-expiry callback) so unit tests are hermetic. No-op in production use.
 */
export function __resetAuthStateForTests() {
  refreshInFlight = null;
  onSessionExpired = null;
}

/**
 * Sign out. Revokes the refresh token server-side (so it can't be replayed for
 * its remaining 30-day lifetime) before clearing local secure storage.
 */
export async function revokeAndClearSession() {
  const refreshToken = await SecureStore.getItemAsync('refresh_token');
  if (refreshToken) {
    await fetchWithTimeout(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {
      /* best-effort; local clear still proceeds */
    });
  }
  await clearSession();
}
