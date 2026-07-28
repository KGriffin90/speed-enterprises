import Link from 'next/link';
import { apiServer, requireAuth } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import { SortSelect } from '@/components/SortSelect';
import type { QuoteStatus } from '@speed-enterprises/shared';

const SORT_OPTIONS = [
  { value: 'date',    label: 'Newest' },
  { value: 'service', label: 'Service' },
  { value: 'status',  label: 'Status' },
];

interface QuoteRow {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  estimateAmountCents: number | null;
  addressLine: string;
  city: string;
  state: string;
  service: { name: string; slug: string };
}

export const metadata = { title: 'My quotes' };

// Simple relative time formatter
function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days  = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ACTIVE_STATUSES: QuoteStatus[] = ['NEW','REVIEWING','ESTIMATE_SENT','SCHEDULED','IN_PROGRESS'];

export default async function CustomerDashboard({ searchParams }: { searchParams: { sort?: string } }) {
  const me     = requireAuth();
  const quotes = await apiServer<QuoteRow[]>('GET', '/api/quotes/mine').catch(() => []);

  // Client-chosen sort (?sort=), applied within the Active / Past groups.
  const sort = searchParams.sort ?? 'date';
  const cmp = (a: QuoteRow, b: QuoteRow) => {
    switch (sort) {
      case 'service': return a.service.name.localeCompare(b.service.name);
      case 'status':  return a.status.localeCompare(b.status);
      default:        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  };
  const active   = quotes.filter(q => ACTIVE_STATUSES.includes(q.status)).sort(cmp);
  const past     = quotes.filter(q => !ACTIVE_STATUSES.includes(q.status)).sort(cmp);
  const firstName = me.user.fullName?.split(' ')[0] ?? 'there';

  return (
    <div className="max-w-2xl">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>
          Hey {firstName} 👋
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-500)' }}>
          {quotes.length === 0
            ? 'Get started by requesting your first quote.'
            : `You have ${active.length} active ${active.length === 1 ? 'request' : 'requests'}.`}
        </p>
      </div>

      {quotes.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--brand-50)' }}>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--brand-600)' }}>
              <path d="M9 12h6M12 9v6M3 12a9 9 0 1018 0 9 9 0 00-18 0z"/>
            </svg>
          </div>
          <h2 className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>No quotes yet</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--ink-500)' }}>Request a free estimate — it only takes 2 minutes.</p>
          <Link href="/quote/new" className="btn-primary text-sm">Request a quote</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {quotes.length > 1 && (
            <div className="flex justify-end">
              <SortSelect options={SORT_OPTIONS} defaultValue="date" />
            </div>
          )}
          {/* Active quotes */}
          {active.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-700)' }}>Active</h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>{active.length}</span>
              </div>
              <ul className="space-y-2">
                {active.map(q => (
                  <li key={q.id}>
                    <Link href={`/dashboard/quotes/${q.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                      {/* Service icon placeholder */}
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--brand-50)' }}>
                        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--brand-600)' }}>
                          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                          <circle cx="10" cy="10" r="3"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm" style={{ color: 'var(--ink-900)' }}>{q.service.name}</span>
                          <StatusPill status={q.status} />
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
                          {q.addressLine}, {q.city} · {relativeDate(q.createdAt)}
                        </div>
                      </div>
                      {q.estimateAmountCents != null && (
                        <div className="text-right flex-shrink-0">
                          <div className="font-bold text-sm" style={{ color: 'var(--ink-900)' }}>
                            ${(q.estimateAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--ink-400)' }}>estimate</div>
                        </div>
                      )}
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--ink-300)' }}>
                        <path d="M6 4l4 4-4 4"/>
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Past quotes */}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink-500)' }}>Past</h2>
              <ul className="space-y-2">
                {past.map(q => (
                  <li key={q.id}>
                    <Link href={`/dashboard/quotes/${q.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow" style={{ opacity: 0.75 }}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-100)' }}>
                        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--ink-400)' }}>
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm" style={{ color: 'var(--ink-700)' }}>{q.service.name}</span>
                          <StatusPill status={q.status} />
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>
                          {q.city} · {relativeDate(q.createdAt)}
                        </div>
                      </div>
                      {q.estimateAmountCents != null && (
                        <div className="font-medium text-sm flex-shrink-0" style={{ color: 'var(--ink-600)' as any }}>
                          ${(q.estimateAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* CTA */}
          <Link href="/quote/new" className="btn-secondary w-full text-sm flex items-center justify-center gap-2 py-3">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v10M3 8h10"/></svg>
            Request another quote
          </Link>
        </div>
      )}
    </div>
  );
}
