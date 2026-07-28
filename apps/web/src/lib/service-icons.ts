// Maps Service.iconKey values → emoji (fast, no dependency).
// iconKey is a semantic key (e.g. 'window', 'washing'), NOT an emoji — never
// render it raw or the word overflows its icon container. Always go through this
// map and fall back to a default for unknown keys.

export const SERVICE_ICON_MAP: Record<string, string> = {
  window: '🪟',     // paned window
  windows: '🪞',    // pane of glass
  home: '🏠',       // residential window cleaning
  building: '🏢',   // commercial window cleaning
  washing: '🚿',    // pressure washing
};

export const DEFAULT_SERVICE_EMOJI = '🪟';

/** Resolve an iconKey to a display emoji, never returning raw key text. */
export function serviceEmoji(iconKey?: string | null): string {
  if (!iconKey) return DEFAULT_SERVICE_EMOJI;
  return SERVICE_ICON_MAP[iconKey] ?? DEFAULT_SERVICE_EMOJI;
}

// Real representative photos for specific service slugs, served from
// /public/images/services. When a service has one, its card shows the photo
// instead of the emoji icon. Files are license-clear CC0 stock (Pexels),
// cropped + compressed to WebP locally. Slugs without an entry fall back to
// the emoji icon.
// Keys MUST be the real Service.slug values (see update-speed-services.ts), or
// servicePhoto() returns null and the card silently falls back to the emoji.
export const SERVICE_PHOTO_MAP: Record<string, string> = {
  'residential-window-cleaning': '/images/services/residential-window-cleaning.webp',
  'commercial-window-cleaning': '/images/services/commercial-window-cleaning.webp',
  'residential-screen-cleaning': '/images/services/residential-screen-cleaning.webp',
  'residential-track-cleaning': '/images/services/residential-track-cleaning.webp',
  'commercial-pressure-washing': '/images/services/commercial-pressure-washing.webp', 
  'residential-pressure-washing': '/images/services/residential-pressure-washing.webp',
  'exterior-window-washing': '/images/services/exterior-window-washing.webp',
};

/** Photo path for a service slug, or null to fall back to the emoji icon. */
export function servicePhoto(slug?: string | null): string | null {
  if (!slug) return null;
  return SERVICE_PHOTO_MAP[slug] ?? null;
}
