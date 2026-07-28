import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { apiCall, DEFAULT_TENANT_SLUG, getStoredSession, revokeAndClearSession, saveSession, setOnSessionExpired } from './api';

interface User {
  id: string;
  email: string;
  fullName?: string | null;
  platformRole: string;
}

interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  role: 'CUSTOMER' | 'STAFF' | 'OWNER';
}

interface Session {
  user: User;
  tenant?: TenantInfo | null;
}

interface AuthContextValue {
  session:  Session | null;
  loading:  boolean;
  /** Resolves with the new session so callers can route on the fresh role
   *  (reading `isStaff`/`isAdmin` right after await would hit a stale closure). */
  signIn:   (email: string, password: string, tenantSlug: string) => Promise<Session>;
  signOut:  () => Promise<void>;
  isStaff:  boolean;
  isAdmin:  boolean;
  /** Tenant the signed-out user is currently browsing (public storefront / quote
   *  flow). Drives theming when there's no session. Set when a business is
   *  picked on the discovery screen; ignored once a real session exists. */
  browsingSlug:    string | null;
  setBrowsingSlug: (slug: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [browsingSlug, setBrowsingSlug] = useState<string | null>(DEFAULT_TENANT_SLUG);

  useEffect(() => {
    // Restore session from SecureStore without an API call.
    // The stored session_data is written on every login so it's always fresh.
    getStoredSession().then(({ token, session: stored }) => {
      if (token && stored) {
        setSession(stored as Session);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    }).finally(() => {
      // Always release the native splash once session restore settles. app/index
      // also hides it, but deep links can mount other routes first — without
      // this, the splash would never dismiss on a deep-link launch.
      SplashScreen.hideAsync().catch(() => {});
    });

    // If a token refresh fails (refresh token expired/revoked), drop to the
    // signed-out state reactively so the UI can't sit on a dead session.
    setOnSessionExpired(() => setSession(null));
    return () => setOnSessionExpired(null);
  }, []);

  async function signIn(email: string, password: string, tenantSlug: string): Promise<Session> {
    const res = await apiCall<{
      accessToken: string; refreshToken: string; user: User; tenant?: TenantInfo | null;
    }>('POST', '/api/auth/login', { email, password, tenantSlug });

    const newSession: Session = { user: res.user, tenant: res.tenant };
    await saveSession(res.accessToken, res.refreshToken, tenantSlug, newSession);
    setSession(newSession);
    // Entering an authed context: the public browsing tenant no longer drives
    // theming (the session tenant does).
    setBrowsingSlug(null);
    return newSession;
  }

  async function signOut() {
    // Revoke the refresh token server-side before clearing local storage so it
    // can't be replayed for its remaining lifetime.
    await revokeAndClearSession();
    setSession(null);
  }

  const role    = session?.tenant?.role;
  const isStaff = role === 'STAFF' || role === 'OWNER';
  const isAdmin = role === 'OWNER';

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut, isStaff, isAdmin, browsingSlug, setBrowsingSlug }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
