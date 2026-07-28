'use client';

import { useEffect } from 'react';
import { clearSession } from '@/lib/auth';

/**
 * Enforces that auth cookies can only survive within the browser session in
 * which the user explicitly signed in.
 *
 * The problem: Chrome, Firefox, and Safari all have session-restore features
 * that resurrect session cookies when the browser is reopened after a full
 * shutdown. This makes the server think the user is still logged in, even
 * though they closed the browser and expected to be signed out.
 *
 * The fix: sessionStorage is the authoritative "this session authenticated"
 * marker. Unlike cookies, sessionStorage is always wiped when the browser
 * fully closes — session restore never touches it. On every page mount, we
 * compare:
 *   - tp_me cookie present  → server thinks user is logged in
 *   - tp_session_alive flag → user actually signed in during THIS browser session
 *
 * If the cookie is present but the flag is missing, it's a restored stale
 * session. We clear the cookies and reload so SSR re-renders unauthenticated.
 */
export function SessionGuard() {
  useEffect(() => {
    const hasCookie = document.cookie.split(';').some(c => c.trim().startsWith('tp_me='));
    const hasMarker = sessionStorage.getItem('tp_session_alive') === '1';

    if (hasCookie && !hasMarker) {
      // Stale session detected: cookies survived a browser restart.
      // Clear everything and force a fresh page load so the server renders
      // without auth cookies and protected routes redirect to sign-in.
      clearSession();
      window.location.replace(window.location.href);
    }
  }, []);

  return null;
}
