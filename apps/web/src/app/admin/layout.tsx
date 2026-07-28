import type { JSX } from 'react';
import { requireTenantRole, readMe } from '@/lib/server-auth';
import { loadTenantConfig } from '@/lib/tenant';
import { NavSidebar } from './NavSidebar';

export default async function AdminLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
  requireTenantRole('OWNER');
  const [cfg, me] = await Promise.all([
    loadTenantConfig().catch(() => null),
    Promise.resolve(readMe()),
  ]);

  return (
    <div className="flex h-screen" style={{ background: 'var(--surface-50)' }}>
      <NavSidebar
        businessName={cfg?.businessName ?? 'Admin'}
        userName={me?.user.fullName ?? me?.user.email ?? ''}
        userEmail={me?.user.email ?? ''}
        tenantRole={me?.tenant?.role ?? 'OWNER'}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-8 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
