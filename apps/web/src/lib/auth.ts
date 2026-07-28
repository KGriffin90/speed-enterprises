'use client';

/**
 * Client-side auth helpers. Tokens live in SESSION cookies — no max-age means
 * the browser clears them when every window/tab is closed, but keeps them alive
 * across refreshes and new tabs within the same browser session.
 *
 * SESSION RESTORE DEFENSE: sessionStorage is the authoritative "this browser
 * session authenticated" marker. Unlike cookies, sessionStorage is always
 * cleared when the browser is fully closed, even when Chrome/Firefox session
 * restore is enabled. The SessionGuard component checks this marker on every
 * page load and clears any cookies that survived a browser restart.
 */
import type { SessionResponseDto } from '@speed-enterprises/shared';

const COOKIE_ACCESS  = 'tp_access';
const COOKIE_REFRESH = 'tp_refresh';
const COOKIE_ME      = 'tp_me';
const SESSION_ALIVE  = 'tp_session_alive';

export function setSession(s: SessionResponseDto) {
  // No max-age → session cookies. Browser clears on full close, not on tab close.
  setCookie(COOKIE_ACCESS,  s.accessToken);
  setCookie(COOKIE_REFRESH, s.refreshToken);
  setCookie(COOKIE_ME, JSON.stringify({
    user:        s.user,
    tenant:      s.tenant,
    memberships: s.memberships,
  }));
  // Mark this browser session as explicitly authenticated. sessionStorage is
  // always wiped on browser close (unlike cookies), so this is the truth source.
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_ALIVE, '1');
  }
}

export function clearSession() {
  delCookie(COOKIE_ACCESS);
  delCookie(COOKIE_REFRESH);
  delCookie(COOKIE_ME);
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_ALIVE);
  }
}

export function getAccessToken(): string | null {
  return getCookie(COOKIE_ACCESS);
}

export function getRefreshToken(): string | null {
  return getCookie(COOKIE_REFRESH);
}

export interface ClientMe {
  user:        SessionResponseDto['user'];
  tenant:      SessionResponseDto['tenant'];
  memberships: SessionResponseDto['memberships'];
}

export function getMe(): ClientMe | null {
  const raw = getCookie(COOKIE_ME);
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(raw)) as ClientMe; }
  catch { return null; }
}

// ── Cookie primitives ─────────────────────────────────────────────────────

/** Session cookie — omitting max-age/expires makes it browser-session-scoped. */
function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax`;
}

function delCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';').map(s => s.trim())) {
    if (part.startsWith(target)) return decodeURIComponent(part.slice(target.length));
  }
  return null;
}
