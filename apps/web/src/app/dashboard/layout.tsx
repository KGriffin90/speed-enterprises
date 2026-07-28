import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/server-auth';
import { loadTenantConfig } from '@/lib/tenant';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = requireAuth();
  if (me.user.platformRole === 'PLATFORM_ADMIN') redirect('/platform');
  const role = me.tenant?.role;
  if (role === 'OWNER') redirect('/admin');

  const cfg     = await loadTenantConfig().catch(() => null);
  const isStaff = role === 'STAFF';
  const name    = me.user.fullName ?? me.user.email ?? '';
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-50)' }}>
      {/* Top nav */}
      <header className="sticky top-0 z-10" style={{ background: 'var(--surface-0)', borderBottom: '1px solid var(--surface-200)' }}>
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo + business name — links to the storefront home (still signed in) */}
          <Link href="/" className="flex items-center gap-2 min-w-0 flex-shrink-0">
            {cfg?.branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cfg.branding.logoUrl}
                alt=""
                className="h-7 w-7 rounded-lg object-cover flex-shrink-0"
                style={{ border: '1px solid var(--surface-200)' }}
              />
            )}
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--ink-700)' }}>
              {cfg?.businessName ?? 'My account'}
            </span>
          </Link>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            <NavLink href="/">Home</NavLink>
            {isStaff ? (
              <>
                <NavLink href="/dashboard/jobs">Jobs</NavLink>
                <NavLink href="/dashboard/timesheet">Timesheet</NavLink>
                <NavLink href="/dashboard/routes">Routes</NavLink>
                <NavLink href="/dashboard/account">Account</NavLink>
              </>
            ) : (
              <>
                <NavLink href="/dashboard">Quotes</NavLink>
                <NavLink href="/dashboard/account">Account</NavLink>
                <Link href="/quote/new" className="btn-primary text-xs py-1.5 px-3 ml-1">New quote</Link>
              </>
            )}
          </nav>

          {/* Theme toggle + avatar + sign out */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <ThemeToggle className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[var(--surface-100)]" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
                {initial}
              </div>
              <span className="text-sm hidden sm:block" style={{ color: 'var(--ink-700)' }}>{name.split(' ')[0]}</span>
              {role && (
                <span className="text-xs px-1.5 py-0.5 rounded font-semibold hidden sm:block" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)', fontSize: '10px' }}>
                  {role}
                </span>
              )}
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main>
        <div className="max-w-4xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>

    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm px-3 py-1.5 rounded-lg transition-colors font-medium"
      style={{ color: 'var(--ink-600)' as any }}
    >
      {children}
    </Link>
  );
}
