'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOutButton } from '../dashboard/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

const GROUPS = [
  {
    label: 'Operations',
    items: [
      { href: '/admin',          label: 'Quotes',     icon: <IconQuotes /> },
      { href: '/admin/schedule', label: 'Schedule',   icon: <IconCalendar /> },
      { href: '/admin/services', label: 'Services',   icon: <IconServices /> },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { href: '/admin/timesheets', label: 'Timesheets', icon: <IconClock /> },
      { href: '/admin/payroll',    label: 'Payroll',    icon: <IconDollar /> },
      { href: '/admin/routes',     label: 'Routes',     icon: <IconRoute /> },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/admin/insights',   label: 'Insights',   icon: <IconInsights /> },
      { href: '/admin/automations',  label: 'Automations',  icon: <IconTemplate /> },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/admin/team',     label: 'Team',     icon: <IconTeam /> },
      { href: '/admin/settings', label: 'Settings', icon: <IconSettings /> },
    ],
  },
];

export function NavSidebar({
  businessName,
  userName,
  userEmail,
  tenantRole,
}: {
  businessName: string;
  userName: string;
  userEmail: string;
  tenantRole: string;
}): JSX.Element {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col h-screen overflow-y-auto" style={{ background: 'var(--surface-0)', borderRight: '1px solid var(--surface-200)' }}>
      {/* Brand */}
      <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--surface-200)' }}>
        <div className="font-bold text-base truncate" style={{ color: 'var(--ink-900)' }}>{businessName}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs px-1.5 py-0.5 rounded font-semibold tracking-wide" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)', fontSize: '10px' }}>
            {tenantRole}
          </span>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 py-4 space-y-5">
        {GROUPS.map(group => (
          <div key={group.label}>
            <div className="px-2 mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-300)' }}>
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        background: active ? 'var(--brand-50)' : 'transparent',
                        color:      active ? 'var(--brand-700)' : 'var(--ink-600)' as any,
                      }}
                    >
                      <span className="flex-shrink-0 w-4 h-4" style={{ color: active ? 'var(--brand-600)' : 'var(--ink-400)' as any }}>
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User + sign out */}
      <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--surface-200)' }}>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
            {(userName || userEmail).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {/* Show full name only when it differs from the email */}
            {userName && userName !== userEmail && (
              <div className="text-xs font-medium truncate" style={{ color: 'var(--ink-700)' }}>{userName}</div>
            )}
            <div className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>{userEmail}</div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <SignOutButton />
          <ThemeToggle className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[var(--surface-100)]" />
        </div>
      </div>
    </aside>
  );
}

// ── Icons (minimal SVGs) ──────────────────────────────────────────────────────

function IconQuotes() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h8M2 12h5"/></svg>;
}
function IconCalendar() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 2v2M11 2v2M2 7h12"/></svg>;
}
function IconServices() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>;
}
function IconClock() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5l2 1.5"/></svg>;
}
function IconDollar() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v12M11 5H6.5a2 2 0 000 4h3a2 2 0 010 4H5"/></svg>;
}
function IconRoute() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v2A2.5 2.5 0 006.5 10h3A2.5 2.5 0 0012 7.5v-2"/></svg>;
}
function IconInsights() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 13l3.5-4 3 2L12 5"/></svg>;
}
function IconTemplate() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M6 6v8"/></svg>;
}
function IconTeam() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="5" r="2"/><circle cx="11" cy="5" r="2"/><path d="M1 13c0-2.2 2-4 5-4s5 1.8 5 4"/><path d="M11 9c2 0 4 1.5 4 4"/></svg>;
}
function IconSettings() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.5 3.5l.85.85M11.65 11.65l.85.85M3.5 12.5l.85-.85M11.65 4.35l.85-.85"/></svg>;
}
