import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/server-auth';
import { SignOutButton } from '../dashboard/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function PlatformLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const me = requirePlatformAdmin();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8 pb-4 border-b" style={{ borderColor: 'var(--surface-200)' }}>
        <div>
          <div className="flex items-center gap-2">
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-500)' }}>Platform Admin</div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#fef3c7', color: '#92400e' }}>
              {me.user.platformRole}
            </span>
          </div>
          <div className="font-semibold text-lg" style={{ color: 'var(--ink-900)' }}>
            {me.user.fullName ?? me.user.email}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/platform" className="link text-sm">Tenants</Link>
          <ThemeToggle className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[var(--surface-100)]" />
          <SignOutButton />
        </div>
      </div>
      {children}
    </div>
  );
}
