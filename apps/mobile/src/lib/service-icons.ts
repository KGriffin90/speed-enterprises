/**
 * Native mirror of web's apps/web/src/lib/service-icons.ts. KEEP IN SYNC BY HAND
 * (the maps live in app code, not @speed-enterprises/shared which is types-only
 * for Metro).
 *
 * Web maps a Service.iconKey → emoji and a Service.slug → representative photo
 * (served from /public/images/services). The mobile equivalent bundles the same
 * WebP files under assets/images/services and resolves them with static
 * `require()` (Metro needs the literal path), falling back to the emoji icon.
 */
import type { ImageSourcePropType } from 'react-native';

// iconKey → emoji. iconKey is a SEMANTIC key (e.g. 'window'), never an emoji —
// always resolve through this map and fall back to a default for unknown keys.
export const SERVICE_ICON_MAP: Record<string, string> = {
  window: '🪟',
  windows: '🪞',
  home: '🏠',
  building: '🏢',
  washing: '🚿',
};

export const DEFAULT_SERVICE_EMOJI = '🪟';

/** Resolve an iconKey to a display emoji, never returning raw key text. */
export function serviceEmoji(iconKey?: string | null): string {
  if (!iconKey) return DEFAULT_SERVICE_EMOJI;
  return SERVICE_ICON_MAP[iconKey] ?? DEFAULT_SERVICE_EMOJI;
}

// slug → bundled photo. Keys MUST be real Service.slug values (mirrors web's
// SERVICE_PHOTO_MAP). require() paths are static so Metro can bundle them; a
// slug without an entry falls back to the emoji icon.
const SERVICE_PHOTO_MAP: Record<string, ImageSourcePropType> = {
  'residential-window-cleaning': require('../../assets/images/services/residential-window-cleaning.webp'),
  'commercial-window-cleaning': require('../../assets/images/services/commercial-window-cleaning.webp'),
  'residential-screen-cleaning': require('../../assets/images/services/residential-screen-cleaning.webp'),
  'residential-track-cleaning': require('../../assets/images/services/residential-track-cleaning.webp'),
  'commercial-pressure-washing': require('../../assets/images/services/commercial-pressure-washing.webp'),
  'residential-pressure-washing': require('../../assets/images/services/residential-pressure-washing.webp'),
};

/** Bundled photo for a service slug, or null to fall back to the emoji icon. */
export function servicePhoto(slug?: string | null): ImageSourcePropType | null {
  if (!slug) return null;
  return SERVICE_PHOTO_MAP[slug] ?? null;
}
