'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';

interface NavItem { label: string; href: string }

interface Props {
  items: NavItem[];
  phone: string;
  tenantSlug: string;
}

export function MobileMenuToggle({ items, phone, tenantSlug }: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="md:hidden flex flex-col gap-1.5 p-2 rounded-lg transition-colors"
        style={{ color: 'var(--ink-700)' }}
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <span
          className="block h-0.5 w-5 transition-all origin-center"
          style={{
            background: 'currentColor',
            transform: open ? 'rotate(45deg) translate(3px, 3px)' : 'none',
          }}
        />
        <span
          className="block h-0.5 w-5 transition-all"
          style={{
            background: 'currentColor',
            opacity: open ? 0 : 1,
          }}
        />
        <span
          className="block h-0.5 w-5 transition-all origin-center"
          style={{
            background: 'currentColor',
            transform: open ? 'rotate(-45deg) translate(3px, -3px)' : 'none',
          }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 right-0 md:hidden shadow-xl"
          style={{
            background: 'var(--surface-0)',
            borderBottom: '1px solid var(--surface-200)',
            zIndex: 50,
          }}
        >
          <nav className="section py-4 flex flex-col gap-1">
            {items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="px-4 py-3 rounded-lg font-medium transition-colors text-sm"
                style={{ color: 'var(--ink-700)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-100)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {item.label}
              </Link>
            ))}
            <hr className="my-2" style={{ borderColor: 'var(--surface-200)' }} />
            <a
              href={`tel:${phone}`}
              className="px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2"
              style={{ color: 'var(--brand-600)' }}
            >
              <PhoneIcon />
              {phone}
            </a>
            <Link
              href="/quote/new"
              onClick={() => setOpen(false)}
              className="btn-primary mx-4 mt-2 text-sm py-3"
            >
              Get a free quote
            </Link>
          </nav>
        </div>
      )}
    </>
  );
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92v2z"/>
    </svg>
  );
}
