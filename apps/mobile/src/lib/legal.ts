import { Linking } from 'react-native';

/**
 * Legal document versions + links for the consent capture at sign-up.
 *
 * The documents themselves are hosted by the web app (the same URLs Apple
 * requires for the App Store privacy policy / EULA). Keep WEB_URL pointed at
 * your production marketing/web origin. Keep the version strings in sync with
 * apps/web/src/content/legal/config.ts (LEGAL_VERSIONS).
 */

export const WEB_URL =
  process.env.EXPO_PUBLIC_WEB_URL ?? 'https://your-domain.example';

export const LEGAL_VERSIONS = {
  terms:   '2026-06-13',
  privacy: '2026-06-13',
  eula:    '2026-06-13',
} as const;

export type LegalSlug =
  | 'privacy-policy'
  | 'terms-of-service'
  | 'eula'
  | 'acceptable-use-policy'
  | 'cookie-policy';

export function legalUrl(slug: LegalSlug): string {
  return `${WEB_URL.replace(/\/$/, '')}/legal/${slug}`;
}

export function openLegal(slug: LegalSlug): void {
  Linking.openURL(legalUrl(slug)).catch(() => undefined);
}
