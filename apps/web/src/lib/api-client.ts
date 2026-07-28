'use client';

import { getAccessToken, getRefreshToken, setSession, clearSession } from './auth';
import type { SessionResponseDto } from '@speed-enterprises/shared';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

/**
 * Lightweight fetch wrapper for client components. Always sends the tenant slug
 * (from the cookie set by middleware) and, if present, the access token.
 *
 * Access tokens are short-lived (~15 min). On a 401 this transparently refreshes
 * the session with the stored refresh token and retries the request once, so an
 * expired access token mid-session no longer surfaces as "Unauthorized". If the
 * refresh also fails, the session is cleared and the user is sent to sign-in.
 *
 * Throws ApiError on non-2xx with the parsed body.
 */
export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(typeof body?.message === 'string' ? body.message : `API ${status}`);
  }
}

function getCookieClient(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';').map(s => s.trim())) {
    if (part.startsWith(target)) return decodeURIComponent(part.slice(target.length));
  }
  return null;
}

function rawFetch(method: string, path: string, body: unknown, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const tenantSlug = getCookieClient('tenant_slug');
  if (tenantSlug) headers.set('X-Tenant-Slug', tenantSlug);

  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Single-flight refresh so several concurrent 401s only hit /auth/refresh once.
let refreshing: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const tenantSlug = getCookieClient('tenant_slug');
        const res = await fetch(`${API_ORIGIN}/api/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {}),
          },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        setSession((await res.json()) as SessionResponseDto);
        return true;
      } catch {
        return false;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  let res = await rawFetch(method, path, body, init);

  // Transparent re-auth: refresh + retry once on an expired access token.
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (await tryRefresh()) {
      res = await rawFetch(method, path, body, init);
    } else {
      clearSession();
      if (typeof window !== 'undefined') window.location.href = '/auth/sign-in';
    }
  }

  const contentType = res.headers.get('content-type') ?? '';
  const parsed = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}
