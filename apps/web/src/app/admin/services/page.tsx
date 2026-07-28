import Link from 'next/link';
import { apiServer } from '@/lib/server-auth';

interface ServiceRow {
  id: string; slug: string; name: string; category: string;
  active: boolean; pricingMode: string; basePriceCents: number;
  questions: any[];
}

export const metadata = { title: 'Admin · Services' };

export default async function AdminServices() {
  const services = await apiServer<ServiceRow[]>('GET', '/api/services').catch(() => []);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Services</h1>
        <span className="text-sm" style={{ color: 'var(--ink-500)' }}>{services.length}</span>
      </div>

      {services.length === 0 ? (
        <div className="card p-10 text-center" style={{ color: 'var(--ink-500)' }}>
          No services yet. Click "New service" to create one, or clone from the industry catalog via the platform admin.
        </div>
      ) : (
        <ul className="grid gap-3">
          {services.map(s => (
            <li key={s.id}>
              <Link href={`/admin/services/${s.id}`} className="card p-5 flex items-start justify-between gap-4 hover:shadow-md transition">
                <div>
                  <div className="font-semibold" style={{ color: 'var(--ink-900)' }}>
                    {s.name}
                    {!s.active && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-100)', color: 'var(--ink-500)' }}>inactive</span>}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--ink-500)' }}>
                    {s.category} · {s.pricingMode.replace(/_/g, ' ').toLowerCase()} · {s.questions.length} questions
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs" style={{ color: 'var(--ink-500)' }}>From</div>
                  <div className="font-semibold" style={{ color: 'var(--ink-900)' }}>
                    ${(s.basePriceCents / 100).toLocaleString('en-US')}
                  </div>
                  <div className="text-xs mt-1 link">Edit →</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
