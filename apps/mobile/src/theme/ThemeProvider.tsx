/**
 * ThemeProvider — resolves the active tenant's Branding into a `Theme` and
 * exposes it via `useTheme()`. This is the native equivalent of web injecting
 * per-tenant CSS variables in app/layout.tsx.
 *
 * Source of truth: GET /api/config/:slug returns the tenant BusinessConfig
 * (the same payload web's loadTenantConfig uses), whose `branding` block holds
 * the color/radius tokens. We re-resolve whenever the active tenant changes
 * (sign-in, tenant switch), and fall back to the indigo default theme when
 * there's no tenant in scope or the fetch fails.
 *
 * Light/dark: the effective color scheme follows the OS (`useColorScheme`)
 * unless the user has set an explicit preference, persisted in SecureStore.
 * Only the neutral ink/surface ramps flip per scheme; brand colors stay
 * branded — same behaviour as web's `data-theme="dark"` toggle. The chosen
 * scheme is read through `useColorMode()`; the resolved `Theme` through
 * `useTheme()`.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Branding } from '@speed-enterprises/shared';
import { apiCall } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { resolveTheme, type ColorScheme, type Theme } from './tokens';

export type { Theme } from './tokens';

/** Manual override; 'system' defers to the OS appearance. */
export type ColorModePreference = ColorScheme | 'system';

const PREF_KEY = 'color_mode_pref';

interface ColorModeValue {
  /** The user's stored preference ('light' | 'dark' | 'system'). */
  preference: ColorModePreference;
  /** The effective scheme actually in use (preference resolved against the OS). */
  scheme: ColorScheme;
  setPreference: (pref: ColorModePreference) => void;
  /** Flip between light and dark (sets an explicit preference). */
  toggle: () => void;
}

const ThemeContext = createContext<Theme>(resolveTheme(null));
const ColorModeContext = createContext<ColorModeValue>({
  preference: 'system',
  scheme: 'light',
  setPreference: () => {},
  toggle: () => {},
});

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useColorMode(): ColorModeValue {
  return useContext(ColorModeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { session, browsingSlug } = useAuth();
  // The tenant currently being BROWSED wins (set when opening a storefront,
  // cleared on sign-in / when returning to the authed console), so a signed-in
  // customer of business A viewing business B sees B's branding. With no
  // browsing context, the session's tenant drives theming.
  const slug = browsingSlug ?? session?.tenant?.slug ?? null;

  const [branding, setBranding] = useState<Branding | null>(null);

  // ── Color scheme: OS appearance + persisted manual override ───────────────
  const systemScheme = useColorScheme() ?? 'light';
  const [preference, setPreferenceState] = useState<ColorModePreference>('system');

  // Restore the saved preference once on mount.
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(PREF_KEY)
      .then(saved => {
        if (active && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setPreferenceState(saved);
        }
      })
      .catch(() => { /* default 'system' */ });
    return () => { active = false; };
  }, []);

  const scheme: ColorScheme = preference === 'system' ? systemScheme : preference;

  function setPreference(pref: ColorModePreference) {
    setPreferenceState(pref);
    SecureStore.setItemAsync(PREF_KEY, pref).catch(() => { /* non-fatal */ });
  }

  function toggle() {
    setPreference(scheme === 'dark' ? 'light' : 'dark');
  }

  // ── Tenant branding fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!slug) {
      setBranding(null);
      return;
    }
    let active = true;
    apiCall<{ branding?: Branding }>('GET', `/api/config/${slug}`)
      .then(cfg => {
        if (active && cfg?.branding) setBranding(cfg.branding);
      })
      .catch(() => {
        /* keep current branding — defaults are a safe baseline */
      });
    return () => {
      active = false;
    };
  }, [slug]);

  // Re-resolve whenever branding or the effective scheme changes.
  const theme = useMemo(() => resolveTheme(branding, scheme), [branding, scheme]);

  const colorMode = useMemo<ColorModeValue>(
    () => ({ preference, scheme, setPreference, toggle }),
    [preference, scheme],
  );

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ColorModeContext.Provider>
  );
}
