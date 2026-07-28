'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

// In-flow (sits just left of the logo inside the navbar's content gutter).
const CLASSNAME =
  'flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-full transition-colors hover:bg-[var(--surface-100)]';
const STYLE = { border: '1px solid var(--surface-200)', color: 'var(--ink-600)' } as React.CSSProperties;

function ChevronLeft(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/**
 * Storefront-navbar back affordance.
 *
 * The home/storefront ("/") is the top of the app, so there's no meaningful
 * "back" — the button is hidden there. On any deeper page it returns to the
 * storefront home rather than retracing browser history, so the destination is
 * predictable no matter how the visitor arrived.
 */
export function NavBackButton(): JSX.Element | null {
  const pathname = usePathname();

  if (pathname === '/') return null;

  return (
    <Link
      href="/"
      aria-label="Back to home"
      title="Back to home"
      className={CLASSNAME}
      style={STYLE}
    >
      <ChevronLeft />
    </Link>
  );
}
