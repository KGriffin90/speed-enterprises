import type { Config } from 'tailwindcss';

/**
 * Brand tokens are CSS variables. The active tenant's values are injected
 * inline by `app/layout.tsx` at SSR — no per-tenant build needed.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand-500)',
          50:  'var(--brand-50)',
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          900: 'var(--brand-900)',
        },
        accent: 'var(--accent)',
        'on-brand': 'var(--on-brand)',
        ink: {
          900: 'var(--ink-900)',
          700: 'var(--ink-700)',
          500: 'var(--ink-500)',
          300: 'var(--ink-300)',
        },
        surface: {
          0:   'var(--surface-0)',
          50:  'var(--surface-50)',
          100: 'var(--surface-100)',
          200: 'var(--surface-200)',
        },
      },
      fontFamily: {
        brand: 'var(--font-brand, system-ui, sans-serif)',
      },
      borderRadius: {
        brand: 'var(--brand-radius, 0.75rem)',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(28,25,23,0.06), 0 4px 20px rgba(28,25,23,0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
