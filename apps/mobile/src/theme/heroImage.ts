/**
 * Tenant hero photo FALLBACK — the native mirror of web's heroImageUrl()
 * (apps/web/src/app/page.tsx). The preferred source is the tenant's
 * `Branding.heroImageUrl` (data-driven, set per tenant); these maps only
 * cover tenants that haven't set one. KEEP IN SYNC WITH WEB BY HAND — the
 * maps live in app code (not @speed-enterprises/shared, which is types-only
 * for Metro).
 *
 * Web layers the photo under a ~85% surface wash + a brand radial tint so it
 * reads at "light opacity"; the storefront reproduces that with overlay views.
 */

// Per-tenant photos (verified free Unsplash images, same IDs as web).
const SLUG_PHOTOS: Record<string, string> = {
  'speedenterprises': 'photo-1769788161278-8dc624a2d537', // man washing windows on skyscraper
};

// Industry fallbacks for tenants without a curated photo.
const INDUSTRY_PHOTOS: Record<string, string> = {
  WINDOW_CLEANING:  'photo-1769788161278-8dc624a2d537',
  PLUMBING:         'photo-1749532125405-70950966b0e5',
  ELECTRICAL:       'photo-1635335874521-7987db781153',
  SOLAR:            'photo-1660330589505-9a433a742a7b', // mobile-only addition (web predates the SOLAR industry)
  OTHER:            'photo-1660330589505-9a433a742a7b', // solar as generic clean-energy fallback
};

/** Returns a CDN URL for the tenant's hero photo, or '' when none applies.
 *  Sized for phone screens (web requests 1920w). */
export function heroImageUrl(slug: string, industry?: string): string {
  const id = SLUG_PHOTOS[slug] ?? (industry ? INDUSTRY_PHOTOS[industry] : undefined) ?? INDUSTRY_PHOTOS.OTHER ?? '';
  if (!id) return '';
  return `https://images.unsplash.com/${id}?w=1200&h=900&auto=format&fit=crop&q=80`;
}
