import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { TimesheetsTable } from './TimesheetsTable';

interface Entry {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  breakMinutes: number;
  notesByStaff: string | null;
  notesByAdmin: string | null;
  status: string;
  membership: { fullName: string | null; role: string; user: { email: string } };
}

interface Member { id: string; fullName: string | null; user: { email: string } }

export const metadata = { title: 'Admin · Timesheets' };

export default async function AdminTimesheets({
  searchParams,
}: {
  searchParams: { membershipId?: string; from?: string; to?: string };
}) {
  requireTenantRole('OWNER');

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const from = searchParams.from ?? weekAgo;
  const to   = searchParams.to   ?? today;

  const q = new URLSearchParams({ from, to });
  if (searchParams.membershipId) q.set('membershipId', searchParams.membershipId);

  const [entries, members] = await Promise.all([
    apiServer<Entry[]>('GET', `/api/admin/time?${q}`).catch(() => []),
    apiServer<Member[]>('GET', '/api/me/team').catch(() => []),
  ]);

  const staff = members.filter(m => (m as any).role !== 'CUSTOMER' && (m as any).active !== false);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Timesheets</h1>
        <a href="/admin/payroll" className="btn-secondary text-sm py-2 px-3">Payroll →</a>
      </div>

      <form className="card p-4 mb-5 flex items-center gap-3 flex-wrap" action="/admin/timesheets">
        <select className="input w-48" name="membershipId" defaultValue={searchParams.membershipId ?? ''}>
          <option value="">All employees</option>
          {staff.map((m: any) => (
            <option key={m.id} value={m.id}>{m.fullName ?? m.user.email}</option>
          ))}
        </select>
        <input className="input" type="date" name="from" defaultValue={from} />
        <span className="text-sm" style={{ color: 'var(--ink-500)' }}>to</span>
        <input className="input" type="date" name="to" defaultValue={to} />
        <button className="btn-primary" type="submit">Filter</button>
      </form>

      {entries.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-500)' }}>No entries found for this period.</div>
      ) : (
        <TimesheetsTable entries={entries} />
      )}
    </div>
  );
}
