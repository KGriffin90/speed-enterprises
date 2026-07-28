import type { Branding } from '@speed-enterprises/shared';

/**
 * Render a CSS variable block for a tenant. Injected into <head> at SSR by
 * app/layout.tsx so the very first paint reflects the tenant's brand colors.
 */
export function renderThemeStyles(branding: Branding): string {
  const c = branding.colors;
  const radius = branding.cornerRadius === 'sharp' ? '0.25rem'
               : branding.cornerRadius === 'rounded' ? '1.25rem'
               : '0.75rem';
  const fontMap: Record<string, string> = {
    inter:           "'Inter', system-ui, sans-serif",
    montserrat:      "'Montserrat', system-ui, sans-serif",
    manrope:         "'Manrope', system-ui, sans-serif",
    'plus-jakarta':  "'Plus Jakarta Sans', system-ui, sans-serif",
    'dm-sans':       "'DM Sans', system-ui, sans-serif",
    system:          "system-ui, -apple-system, sans-serif",
  };
  const font = fontMap[branding.fontFamily] ?? fontMap.system;

  // Only the tenant-specific tokens are injected. The neutral ink/surface ramps
  // (and their dark-mode overrides) live in globals.css so the data-theme="dark"
  // toggle can flip them — inline values here would block that override.
  return `:root{
  --brand-50:${c.brand50};
  --brand-100:${c.brand100};
  --brand-200:${c.brand200};
  --brand-400:${c.brand400};
  --brand-500:${c.brand500};
  --brand-600:${c.brand600};
  --brand-700:${c.brand700};
  --brand-900:${c.brand900};
  --accent:${c.accent};
  --on-brand:${c.onBrand};
  --font-brand:${font};
  --brand-radius:${radius};
}`;
}

/**
 * Returns CSS custom properties as an inline-style object scoped to a DOM
 * element. Use this on a wrapper <div> in the layout body so the variables
 * update correctly on every RSC render, overriding the :root defaults in
 * globals.css regardless of whether Next.js re-patches <head> on soft nav.
 */
export function renderThemeVars(branding: Branding): Record<string, string> {
  const c = branding.colors;
  const radius = branding.cornerRadius === 'sharp' ? '0.25rem'
               : branding.cornerRadius === 'rounded' ? '1.25rem'
               : '0.75rem';
  const fontMap: Record<string, string> = {
    inter:           "'Inter', system-ui, sans-serif",
    montserrat:      "'Montserrat', system-ui, sans-serif",
    manrope:         "'Manrope', system-ui, sans-serif",
    'plus-jakarta':  "'Plus Jakarta Sans', system-ui, sans-serif",
    'dm-sans':       "'DM Sans', system-ui, sans-serif",
    system:          "system-ui, -apple-system, sans-serif",
  };
  const font = fontMap[branding.fontFamily] ?? "system-ui, -apple-system, sans-serif";
  // Neutral ink/surface ramps are intentionally omitted — they come from
  // globals.css so the dark-mode toggle can override them (inline values here
  // would win over the [data-theme="dark"] rule). Only tenant tokens go inline.
  return {
    '--brand-50':  c.brand50,  '--brand-100': c.brand100, '--brand-200': c.brand200,
    '--brand-400': c.brand400, '--brand-500': c.brand500, '--brand-600': c.brand600,
    '--brand-700': c.brand700, '--brand-900': c.brand900,
    '--accent':    c.accent,   '--on-brand':  c.onBrand,
    '--font-brand': font, '--brand-radius': radius,
  };
}

/** Google Fonts <link> for the tenant's selected font family (when applicable). */
export function fontStylesheetHref(branding: Branding): string | null {
  const slug: Record<string, string> = {
    inter:           'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    montserrat:      'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700;800&display=swap',
    manrope:         'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&display=swap',
    'plus-jakarta':  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap',
    'dm-sans':       'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap',
    system: null as any,
  };
  return slug[branding.fontFamily] ?? null;
}
