import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { ResumeDraftBanner } from './ResumeDraftBanner';

type Phase = 'all' | 'planned' | 'running' | 'active' | 'completed';

interface Route {
  id: string;
  name: string | null;
  phase: 'planned' | 'running' | 'active' | 'completed';
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  startedAt: string;
  plannedForDate: string | null;
  endedAt: string | null;
  distanceMiles: number | null;
  gallonsUsed: number | null;
  sourceTemplateId: string | null;
  membership: { fullName: string | null; user: { email: string } } | null;
  _count: { waypoints: number; stops: number };
}

// Display buckets derived server-side from status + plannedForDate.
// En route = it's the scheduled day; Active = a staff member started it (GPS live).
const PHASE_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  planned:   { bg: 'var(--surface-100)', fg: 'var(--ink-600)', label: 'Planned' },
  running:   { bg: '#fffbeb',            fg: '#b45309',        label: 'En route' },
  active:    { bg: '#ecfdf5',            fg: '#059669',        label: 'Active' },
  completed: { bg: '#eff6ff',            fg: '#2563eb',        label: 'Completed' },
};

const TABS: { value: Phase; label: string; hint: string }[] = [
  { value: 'all',       label: 'All',       hint: '' },
  { value: 'planned',   label: 'Planned',   hint: 'coming up' },
  { value: 'running',   label: 'En route',  hint: 'today' },
  { value: 'active',    label: 'Active',    hint: 'live' },
  { value: 'completed', label: 'Completed', hint: '' },
];

interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }

export const metadata = { title: 'Admin · Routes' };

export default async function AdminRoutes({ searchParams }: { searchParams: { membershipId?: string; phase?: string } }): Promise<JSX.Element> {
  requireTenantRole('OWNER');

  const phase: Phase = (['all', 'planned', 'running', 'active', 'completed'].includes(searchParams.phase ?? '')
    ? searchParams.phase
    : 'all') as Phase;

  const q = new URLSearchParams({ phase });
  if (searchParams.membershipId) q.set('membershipId', searchParams.membershipId);

  const [routes, members] = await Promise.all([
    apiServer<Route[]>('GET', `/api/admin/routes?${q}`).catch(() => []),
    apiServer<Member[]>('GET', '/api/me/team').catch(() => []),
  ]);

  const staff = members.filter(m => m.active && m.role !== 'CUSTOMER');
  const totalMiles = routes.reduce((s, r) => s + (r.distanceMiles ?? 0), 0);
  const totalGal   = routes.reduce((s, r) => s + (r.gallonsUsed  ?? 0), 0);

  // Preserve the employee filter when switching phase tabs.
  const linkFor = (p: Phase) => {
    const u = new URLSearchParams();
    if (p !== 'all') u.set('phase', p);
    if (searchParams.membershipId) u.set('membershipId', searchParams.membershipId);
    const qs = u.toString();
    return `/admin/routes${qs ? `?${qs}` : ''}`;
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--ink-900)' }}>Routes</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        Your current, upcoming, and completed routes. Reusable blueprints live under Templates.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <Link href="/admin/routes/new" className="card p-5 block transition-shadow hover:shadow-md">
          <div className="text-base font-bold" style={{ color: 'var(--ink-900)' }}>Create a route</div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-500)' }}>
            A one-time route for a specific day — from scratch or started from a template.
          </p>
          <div className="mt-3 text-sm font-semibold" style={{ color: 'var(--brand-600)' }}>+ Create route →</div>
        </Link>
        <Link href="/admin/routes/templates" className="card p-5 block transition-shadow hover:shadow-md">
          <div className="text-base font-bold" style={{ color: 'var(--ink-900)' }}>Templates</div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-500)' }}>
            Reusable route blueprints — one-off, or on a schedule (weekly, monthly, …).
          </p>
          <div className="mt-3 text-sm font-semibold" style={{ color: 'var(--brand-600)' }}>Manage templates →</div>
        </Link>
      </div>

      <ResumeDraftBanner />

      {/* Phase filter tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map(tab => {
          const active = phase === tab.value;
          return (
            <Link
              key={tab.value}
              href={linkFor(tab.value)}
              className="text-sm font-semibold px-3.5 py-1.5 rounded-full transition-colors"
              style={active
                ? { background: 'var(--brand-600)', color: 'var(--on-brand)' }
                : { background: 'var(--surface-100)', color: 'var(--ink-600)' }}
            >
              {tab.label}{tab.hint && <span className="font-normal opacity-70"> · {tab.hint}</span>}
            </Link>
          );
        })}
      </div>

      {/* Employee filter (keeps the active phase tab) */}
      <form className="card p-4 mb-5 flex items-center gap-3 flex-wrap" action="/admin/routes">
        <input type="hidden" name="phase" value={phase} />
        <select className="input w-48" name="membershipId" defaultValue={searchParams.membershipId ?? ''}>
          <option value="">All employees</option>
          {staff.map(m => (
            <option key={m.id} value={m.id}>{m.fullName ?? m.user.email}</option>
          ))}
        </select>
        <button className="btn-primary" type="submit">Filter</button>
      </form>

      {routes.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ink-500)' }}>Total miles</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>{totalMiles.toFixed(1)}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ink-500)' }}>Est. gallons used</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>{totalGal.toFixed(2)}</div>
          </div>
        </div>
      )}

      {routes.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-500)' }}>
          No {phase === 'all' ? '' : `${phase} `}routes{phase === 'planned' ? ' coming up' : ''}.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
              <tr>
                <th className="text-left px-4 py-3 font-medium">Route / employee</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Stops</th>
                <th className="text-left px-4 py-3 font-medium">Miles</th>
                <th className="text-left px-4 py-3 font-medium">Gallons</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {routes.map(r => {
                const st = PHASE_STYLE[r.phase] ?? { bg: 'var(--surface-100)', fg: 'var(--ink-600)', label: r.phase };
                const when = r.plannedForDate ?? r.startedAt;
                return (
                <tr key={r.id} className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-900)' }}>
                    <div className="font-medium flex items-center gap-2">
                      {r.name ?? 'Route'}
                      {r.sourceTemplateId && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-100)', color: 'var(--ink-500)' }}>recurring</span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--ink-500)' }}>{r.membership?.fullName ?? r.membership?.user.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                    {/* plannedForDate is a UTC date-only value → format in UTC so
                        it never shifts a day for viewers west of UTC. startedAt is
                        a real moment, shown in local time. */}
                    {new Date(when).toLocaleDateString(undefined, r.plannedForDate ? { timeZone: 'UTC' } : undefined)}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>{r._count.stops}</td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink-900)' }}>
                    {r.distanceMiles != null ? r.distanceMiles.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                    {r.gallonsUsed != null ? r.gallonsUsed.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/routes/${r.id}`} className="link text-sm font-semibold">View →</Link>
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
