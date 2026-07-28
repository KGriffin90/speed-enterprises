import Link from 'next/link';
import { apiServer } from '@/lib/server-auth';

interface TenantRow {
  id: string;
  slug: string;
  status: string;
  planTier: string;
  industry: string;
  createdAt: string;
  config: { businessName: string } | null;
  _count: { quoteRequests: number; memberships: number };
}

export const metadata = { title: 'Platform Admin · Tenants' };

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ACTIVE:    { bg: '#dcfce7', text: '#166534' },
  TRIAL:     { bg: '#fef3c7', text: '#92400e' },
  SUSPENDED: { bg: '#fee2e2', text: '#991b1b' },
  ARCHIVED:  { bg: '#f1f5f9', text: '#475569' },
};

export default async function PlatformTenants(): Promise<JSX.Element> {
  const tenants = await apiServer<TenantRow[]>('GET', '/api/platform/tenants').catch(() => []);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Tenants</h1>
        <span className="text-sm" style={{ color: 'var(--ink-500)' }}>
          {tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'}
        </span>
      </div>

      {tenants.length === 0 ? (
        <div className="card p-10 text-center" style={{ color: 'var(--ink-500)' }}>No tenants found.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
              <tr>
                <th className="text-left px-4 py-3 font-medium">Business</th>
                <th className="text-left px-4 py-3 font-medium">Slug</th>
                <th className="text-left px-4 py-3 font-medium">Industry</th>
                <th className="text-left px-4 py-3 font-medium">Plan</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Quotes</th>
                <th className="text-right px-4 py-3 font-medium">Members</th>
                <th className="text-left px-4 py-3 font-medium">View</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => {
                const colors = STATUS_COLORS[t.status] ?? STATUS_COLORS['ARCHIVED']!;
                return (
                  <tr key={t.id} className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink-900)' }}>
                      {t.config?.businessName ?? t.slug}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--ink-500)' }}>
                      {t.slug}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                      {t.industry.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                      {t.planTier}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: colors.bg, color: colors.text }}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: 'var(--ink-700)' }}>
                      {t._count.quoteRequests}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: 'var(--ink-700)' }}>
                      {t._count.memberships}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/?tenant=${t.slug}`} className="link text-xs">
                        Site →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
