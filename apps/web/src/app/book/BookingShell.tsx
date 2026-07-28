'use client';

import type { JSX, ReactNode } from 'react';

/** Minimal standalone shell for public email-link booking pages. These open in
 *  a fresh browser (no session, possibly no tenant cookie), so they stay
 *  self-contained and lean on neutral styling. */
export function BookingShell({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: '2rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '1rem' }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export const CUSTOMER_TZ = typeof Intl !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : 'America/Denver';

export function fmt(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });
}
