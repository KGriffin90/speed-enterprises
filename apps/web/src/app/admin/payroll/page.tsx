import { apiServer, requireTenantRole } from '@/lib/server-auth';

interface PayrollRow {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  basePayCents: number;
  payType: string;
  totalMinutes: number;
  workedMinutes: number;
  grossPayCents: number;
  entryCount: number;
}

export const metadata = { title: 'Admin · Payroll' };

function fmt$(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function fmtHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default async function PayrollPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  requireTenantRole('OWNER');

  const now   = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const from = searchParams.from ?? firstOfMonth;
  const to   = searchParams.to   ?? today;

  const rows = await apiServer<PayrollRow[]>('GET', `/api/admin/payroll?from=${from}&to=${to}`).catch(() => []);

  const totalGross = rows.reduce((s, r) => s + r.grossPayCents, 0);
  const totalMins  = rows.reduce((s, r) => s + r.workedMinutes, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Payroll</h1>
        <a href="/admin/timesheets" className="link text-sm">← Timesheets</a>
      </div>

      <form className="card p-4 mb-5 flex items-center gap-3 flex-wrap" action="/admin/payroll">
        <label className="text-sm" style={{ color: 'var(--ink-500)' }}>Period</label>
        <input className="input" type="date" name="from" defaultValue={from} />
        <span className="text-sm" style={{ color: 'var(--ink-500)' }}>to</span>
        <input className="input" type="date" name="to" defaultValue={to} />
        <button className="btn-primary" type="submit">Run</button>
      </form>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-500)' }}>No completed shifts in this period.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Stat label="Total payroll" value={fmt$(totalGross)} />
            <Stat label="Total hours worked" value={fmtHours(totalMins)} />
            <Stat label="Employees" value={String(rows.length)} />
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Employee</th>
                  <th className="text-left px-4 py-3 font-medium">Pay type</th>
                  <th className="text-left px-4 py-3 font-medium">Rate</th>
                  <th className="text-left px-4 py-3 font-medium">Shifts</th>
                  <th className="text-left px-4 py-3 font-medium">Hours worked</th>
                  <th className="text-right px-4 py-3 font-medium">Gross pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.membershipId} className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: 'var(--ink-900)' }}>{r.name}</div>
                      <div className="text-xs" style={{ color: 'var(--ink-500)' }}>{r.email}</div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>{r.payType}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                      {r.basePayCents > 0 ? `${fmt$(r.basePayCents)}/hr` : <span style={{ color: 'var(--ink-300)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>{r.entryCount}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>{fmtHours(r.workedMinutes)}</td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--ink-900)' }}>
                      {r.grossPayCents > 0 ? fmt$(r.grossPayCents) : <span style={{ color: 'var(--ink-300)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: 'var(--surface-50)', borderTop: '2px solid var(--surface-200)' }}>
                <tr>
                  <td colSpan={4} className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-700)' }}>Total</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-700)' }}>{fmtHours(totalMins)}</td>
                  <td className="px-4 py-3 text-right font-bold text-base" style={{ color: 'var(--ink-900)' }}>{fmt$(totalGross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs mt-3" style={{ color: 'var(--ink-400)' }}>
            Gross pay = worked hours × hourly rate. Break time is excluded. Salary employees show rate as set; no automatic calculation.
            Set each employee's rate on the <a href="/admin/team" className="link">Team page</a>.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ink-500)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>{value}</div>
    </div>
  );
}
