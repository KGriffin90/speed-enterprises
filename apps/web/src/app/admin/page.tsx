import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import { SortSelect } from '@/components/SortSelect';
import { KpiCard } from './KpiCard';
import { PipelineChart, WinRateChart } from './DashboardCharts';
import type { QuoteStatus } from '@speed-enterprises/shared';

const SORT_OPTIONS = [
  { value: 'date',    label: 'Newest' },
  { value: 'name',    label: 'Name' },
  { value: 'service', label: 'Service' },
  { value: 'status',  label: 'Status' },
];

interface AdminQuoteRow {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  estimateAmountCents: number | null;
  guestName: string | null;
  guestEmail: string | null;
  addressLine: string; city: string; state: string;
  service: { name: string };
  user: { email: string; customerProfiles: { fullName: string }[] } | null;
}

export const metadata = { title: 'Admin · Quotes' };

const STATUS_OPTIONS: Array<QuoteStatus | 'ALL'> = [
  'ALL', 'NEW', 'REVIEWING', 'ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELED',
];

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function fmt$(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** KPI drill-down views. Selecting a tile scopes the dashboard to that metric. */
type View = 'new' | 'active' | 'pipeline' | 'winrate' | 'revenue';
const VIEWS: View[] = ['new', 'active', 'pipeline', 'winrate', 'revenue'];

const VIEW_TITLE: Record<View, { title: string; blurb: string }> = {
  new:      { title: 'New requests',  blurb: 'Quotes still at NEW — nobody has opened them yet.' },
  active:   { title: 'Active jobs',   blurb: 'Booked or underway: Scheduled and In progress.' },
  pipeline: { title: 'Pipeline',      blurb: 'Estimated value of every quote carrying an estimate.' },
  winrate:  { title: 'Win rate',      blurb: 'How quotes resolve: won, lost, or still in flight.' },
  revenue:  { title: 'Total revenue', blurb: 'Every quote marked Paid.' },
};

export default async function AdminQuotes({ searchParams }: { searchParams: { status?: string; q?: string; sort?: string; view?: string } }) {
  requireTenantRole('OWNER');

  const filter = new URLSearchParams();
  if (searchParams.status && searchParams.status !== 'ALL') filter.set('status', searchParams.status);
  if (searchParams.q) filter.set('q', searchParams.q);
  const path = `/api/admin/quotes${filter.toString() ? `?${filter.toString()}` : ''}`;

  // Fetch filtered rows + all rows for KPIs
  const [fetchedRows, allRows] = await Promise.all([
    apiServer<AdminQuoteRow[]>('GET', path).catch(() => []),
    apiServer<AdminQuoteRow[]>('GET', '/api/admin/quotes').catch(() => []),
  ]);

  // Client-chosen sort (?sort=) applied to the filtered set; default newest first.
  const custName = (r: AdminQuoteRow) => r.guestName ?? r.user?.customerProfiles?.[0]?.fullName ?? r.user?.email ?? '';
  const sort = searchParams.sort ?? 'date';
  const rows = [...fetchedRows].sort((a, b) => {
    switch (sort) {
      case 'name':    return custName(a).localeCompare(custName(b));
      case 'service': return a.service.name.localeCompare(b.service.name);
      case 'status':  return a.status.localeCompare(b.status);
      default:        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  // KPI computations from all quotes
  const newCount      = allRows.filter(r => r.status === 'NEW').length;
  const activeCount   = allRows.filter(r => ['SCHEDULED','IN_PROGRESS'].includes(r.status)).length;
  const pipeline      = allRows.filter(r => r.estimateAmountCents).reduce((s, r) => s + (r.estimateAmountCents ?? 0), 0);
  const wonCount      = allRows.filter(r => ['COMPLETED','PAID'].includes(r.status)).length;
  const convRate      = allRows.length ? Math.round((wonCount / allRows.length) * 100) : 0;
  const revenue       = allRows.filter(r => r.status === 'PAID').reduce((s, r) => s + (r.estimateAmountCents ?? 0), 0);

  const isFiltered    = !!(searchParams.status && searchParams.status !== 'ALL') || !!searchParams.q;

  // Active drill-down view (one at a time; re-selecting the same tile clears it).
  const view = VIEWS.includes(searchParams.view as View) ? (searchParams.view as View) : null;
  const hrefFor = (v: View) => (view === v ? '/admin' : `/admin?view=${v}`);

  // Rows shown by the list-style views, taken from the full unfiltered set.
  const viewRows = view === 'new'     ? allRows.filter(r => r.status === 'NEW')
                 : view === 'active'  ? allRows.filter(r => ['SCHEDULED','IN_PROGRESS'].includes(r.status))
                 : view === 'revenue' ? allRows.filter(r => r.status === 'PAID')
                 : null;
  const listRows = (viewRows ?? rows).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>Quotes</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-500)' }}>All incoming quote requests</p>
        </div>
      </div>

      {/* KPI cards — only shown when not filtered */}
      {!isFiltered && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <KpiCard
            label="New requests" value={String(newCount)} sub="need review" accent="brand"
            href={hrefFor('new')} active={view === 'new'}
            description="Quote requests still sitting at status NEW — nobody has opened them yet. Opening one moves it to Reviewing, so this is your unworked inbox."
          />
          <KpiCard
            label="Active jobs" value={String(activeCount)} sub="in progress" accent="green"
            href={hrefFor('active')} active={view === 'active'}
            description="Work that is booked or underway: quotes with a status of Scheduled or In progress. These are committed jobs, not estimates."
          />
          <KpiCard
            label="Pipeline" value={fmt$(pipeline)} sub="estimated revenue" accent="purple"
            href={hrefFor('pipeline')} active={view === 'pipeline'}
            description="Total dollar value of every quote that has an estimate amount, at any status. It is potential revenue quoted, not money collected."
          />
          <KpiCard
            label="Win rate" value={`${convRate}%`} sub="of all quotes" accent="orange"
            href={hrefFor('winrate')} active={view === 'winrate'}
            description="Share of all quotes that reached Completed or Paid. A rough close rate — in-flight quotes count against it until they finish."
          />
          <KpiCard
            label="Total revenue" value={fmt$(revenue)} sub="paid jobs" accent="blue"
            href={hrefFor('revenue')} active={view === 'revenue'}
            description="Money actually earned: the total on every quote marked Paid. Unlike Pipeline, this counts only jobs the customer has paid for — finished-but-unpaid work is not included."
          />
        </div>
      )}

      {/* Drill-down banner — replaces the pills/search while a KPI view is active */}
      {view && (
        <div className="card px-4 py-3 mb-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--ink-900)' }}>{VIEW_TITLE[view].title}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>{VIEW_TITLE[view].blurb}</div>
          </div>
          <Link href="/admin" className="btn-secondary text-sm px-4 py-2 whitespace-nowrap">Show all quotes</Link>
        </div>
      )}

      {/* Status filter pills */}
      {!view && (
      <div className="flex gap-2 flex-wrap mb-4">
        {STATUS_OPTIONS.map(s => {
          const active = (searchParams.status ?? 'ALL') === s;
          const count  = s === 'ALL' ? allRows.length : (allRows.filter(r => r.status === s).length);
          const href   = s === 'ALL' ? '/admin' : `/admin?status=${s}`;
          return (
            <Link
              key={s}
              href={href}
              className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors border whitespace-nowrap"
              style={{
                background:   active ? 'var(--brand-600)' : 'var(--surface-0)',
                color:        active ? 'white' : 'var(--ink-600)' as any,
                borderColor:  active ? 'var(--brand-600)' : 'var(--surface-200)',
              }}
            >
              {s === 'ALL' ? 'All' : s.replace('_', ' ')}
              {count > 0 && <span className="ml-1.5 opacity-70">{count}</span>}
            </Link>
          );
        })}
      </div>
      )}

      {/* Search bar */}
      {!view && (
      <form className="mb-5 flex gap-3" action="/admin">
        {searchParams.status && <input type="hidden" name="status" value={searchParams.status} />}
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ink-400)' }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="4"/><path d="M10.5 10.5l3 3"/>
          </svg>
          <input
            className="input pl-9 text-sm"
            name="q"
            defaultValue={searchParams.q ?? ''}
            placeholder="Search customer name, email, or address…"
          />
        </div>
        <button className="btn-primary text-sm px-4 py-2.5" type="submit">Search</button>
        {searchParams.q && (
          <Link href={searchParams.status ? `/admin?status=${searchParams.status}` : '/admin'} className="btn-secondary text-sm px-4 py-2.5">
            Clear
          </Link>
        )}
      </form>
      )}

      {/* Chart views */}
      {view === 'pipeline' && <PipelineChart rows={allRows} />}
      {view === 'winrate'  && <WinRateChart  rows={allRows} />}

      {/* Table */}
      {view === 'pipeline' || view === 'winrate' ? null : listRows.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="text-4xl mb-3">📋</div>
          <div className="font-medium" style={{ color: 'var(--ink-700)' }}>No quotes found</div>
          <div className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
            {view ? `Nothing is currently in ${VIEW_TITLE[view].title.toLowerCase()}.` : 'Try adjusting your filters or search query.'}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b text-xs font-medium" style={{ borderColor: 'var(--surface-200)', color: 'var(--ink-500)', background: 'var(--surface-50)' }}>
            <span>{listRows.length} {listRows.length === 1 ? 'result' : 'results'}</span>
            {!view && <SortSelect options={SORT_OPTIONS} defaultValue="date" />}
          </div>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
              <tr>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">Service</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Estimate</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map(r => {
                const name = r.guestName ?? r.user?.customerProfiles?.[0]?.fullName ?? r.user?.email ?? '—';
                return (
                  <tr key={r.id} className="border-t relative hover:bg-[var(--surface-50)] cursor-pointer transition-colors" style={{ borderColor: 'var(--surface-100)' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
                          {initials(name)}
                        </div>
                        <div>
                          <Link href={`/admin/quotes/${r.id}`} className="font-medium after:absolute after:inset-0 hover:underline" style={{ color: 'var(--ink-900)' }}>
                            {name}
                          </Link>
                          <div className="text-xs" style={{ color: 'var(--ink-400)' }}>
                            {r.guestEmail ?? r.user?.email ?? ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div style={{ color: 'var(--ink-800)' }}>{r.service.name}</div>
                      <div className="text-xs" style={{ color: 'var(--ink-400)' }}>{r.city}, {r.state}</div>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-900)' }}>
                      {r.estimateAmountCents != null
                        ? fmt$(r.estimateAmountCents)
                        : <span className="font-normal" style={{ color: 'var(--ink-300)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--ink-500)' }}>
                      {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
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
