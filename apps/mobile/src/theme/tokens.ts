/**
 * Design tokens — the native mirror of the web design system.
 *
 * Web defines these as CSS custom properties in apps/web/src/app/globals.css
 * (`:root`) and injects per-tenant overrides via apps/web/src/lib/theme.ts.
 * React Native has no CSS variables, so we resolve the same token set into a
 * plain JS `Theme` object that screens read through `useTheme()`.
 *
 * Parity rules (keep in lockstep with web):
 *   - Only brand-* + accent + onBrand vary per tenant (from Branding.colors).
 *   - ink-* and surface-* are fixed neutrals, identical to web :root.
 *   - cornerRadius maps sharp→4 / soft→12 / rounded→20 px (web theme.ts uses
 *     0.25rem / 0.75rem / 1.25rem at the 16px root).
 */

import type { Branding, ColorTokens } from '@speed-enterprises/shared';

export type ColorScheme = 'light' | 'dark';

/** Neutral ramp shapes — string-valued so light and dark variants share a type. */
export type InkRamp = Record<900 | 700 | 500 | 300, string>;
export type SurfaceRamp = Record<0 | 50 | 100 | 200, string>;

// Light neutrals — identical to web globals.css :root. Never tenant-varied.
export const INK_LIGHT = {
  900: '#1c1917',
  700: '#44403c',
  500: '#78716c',
  300: '#a8a29e',
} as const;

export const SURFACE_LIGHT = {
  0: '#ffffff',
  50: '#fafaf9',
  100: '#f5f5f4',
  200: '#e7e5e4',
} as const;

// Dark neutrals — mirror web globals.css :root[data-theme='dark']. Only the
// neutral ramps flip in dark mode; brand colors stay branded (same as web).
export const INK_DARK = {
  900: '#fafaf9',
  700: '#e7e5e4',
  500: '#a8a29e',
  300: '#78716c',
} as const;

export const SURFACE_DARK = {
  0: '#1c1917',
  50: '#0c0a09',
  100: '#292524',
  200: '#3f3a36',
} as const;

// Back-compat aliases — the light ramp is the historical default. Existing
// imports of INK/SURFACE keep resolving to light values.
export const INK = INK_LIGHT;
export const SURFACE = SURFACE_LIGHT;

// Default brand ramp (indigo) — matches web :root defaults. Used until the
// tenant Branding loads, and on platform-level screens that have no tenant.
export const DEFAULT_BRAND: ColorTokens = {
  brand50: '#eef2ff',
  brand100: '#e0e7ff',
  brand200: '#c7d2fe',
  brand400: '#818cf8',
  brand500: '#6366f1',
  brand600: '#4f46e5',
  brand700: '#4338ca',
  brand900: '#1e1b4b',
  accent: '#f59e0b',
  onBrand: '#ffffff',
};

// cornerRadius → px. Mirrors web theme.ts radius mapping at a 16px root.
const RADIUS_PX: Record<NonNullable<Branding['cornerRadius']>, number> = {
  sharp: 4,
  soft: 12,
  rounded: 20,
};

/**
 * RN approximation of web's `shadow-soft`
 * (`0 1px 2px rgba(28,25,23,.06), 0 4px 20px rgba(28,25,23,.06)`).
 * RN collapses to a single shadow; we bias toward the larger ambient layer.
 */
export const SHADOW_SOFT = {
  shadowColor: '#1c1917',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
} as const;

export interface Theme {
  /** Active color scheme — 'light' or 'dark'. */
  scheme: ColorScheme;
  /** Convenience flag, true when scheme === 'dark'. */
  isDark: boolean;
  /** Tenant brand ramp (or DEFAULT_BRAND before branding loads). */
  brand: ColorTokens;
  ink: InkRamp;
  surface: SurfaceRamp;
  /** Corner radius in px, derived from Branding.cornerRadius. */
  radius: number;
  /** Pill / fully-rounded radius. */
  radiusFull: number;
  /**
   * RN fontFamily, or undefined for the system font. Custom Google Fonts
   * (Inter, Montserrat, …) require expo-font loading before they can be
   * named here; until that lands we fall back to the system font so text
   * never renders with a missing/ghost family. Tracked for a later phase.
   */
  font: string | undefined;
  shadowSoft: typeof SHADOW_SOFT;
}

export function resolveTheme(
  branding?: Pick<Branding, 'colors' | 'cornerRadius'> | null,
  scheme: ColorScheme = 'light',
): Theme {
  const isDark = scheme === 'dark';
  return {
    scheme,
    isDark,
    brand: branding?.colors ?? DEFAULT_BRAND,
    // Only the neutral ramps flip per scheme; brand colors stay branded (web parity).
    ink: isDark ? INK_DARK : INK_LIGHT,
    surface: isDark ? SURFACE_DARK : SURFACE_LIGHT,
    // `?? 'soft'` guards null/undefined; the trailing `?? RADIUS_PX.soft` guards
    // an unexpected value (bad/forward-compat data) so radius is never undefined.
    radius: RADIUS_PX[branding?.cornerRadius ?? 'soft'] ?? RADIUS_PX.soft,
    radiusFull: 999,
    font: undefined, // system font until expo-font wiring lands
    shadowSoft: SHADOW_SOFT,
  };
}

/** Theme used before any tenant Branding has loaded (light scheme). */
export const defaultTheme = resolveTheme(null);
