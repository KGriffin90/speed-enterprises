import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { ClockWidget } from './ClockWidget';

interface TimeEntry {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  breakMinutes: number;
  notesByStaff: string | null;
  notesByAdmin: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'EDITED';
}

interface Pay {
  workedMinutes: number; basePayCents: number; grossPayCents: number; payType: string;
  from: string; to: string;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const metadata = { title: 'My timesheet' };

function shiftMins(e: TimeEntry): number {
  if (!e.clockedOutAt) return 0;
  return Math.max(0, Math.round((new Date(e.clockedOutAt).getTime() - new Date(e.clockedInAt).getTime()) / 60_000) - e.breakMinutes);
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

export default async function TimesheetPage() {
  requireTenantRole('STAFF');

  const [current, entries, pay] = await Promise.all([
    apiServer<TimeEntry | null>('GET', '/api/me/time/current').catch(() => null),
    apiServer<TimeEntry[]>('GET', '/api/me/time').catch(() => []),
    apiServer<Pay>('GET', '/api/me/pay').catch(() => null),
  ]);

  const past = entries.filter(e => e.status !== 'ACTIVE');

  // Week stats
  const weekEntries  = past.filter(e => isThisWeek(e.clockedInAt));
  const weekMins     = weekEntries.reduce((s, e) => s + shiftMins(e), 0);
  const weekShifts   = weekEntries.length;
  const totalMins    = past.reduce((s, e) => s + shiftMins(e), 0);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>Timesheet</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-500)' }}>Track your shifts and hours</p>
      </div>

      {/* Clock in/out widget */}
      <ClockWidget initial={current} />

      {/* This month's pay — hours × your hourly rate */}
      {pay && (
        <div className="card p-5 mt-5">
          <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-500)' }}>This month’s pay</div>
          <div className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ink-900)' }}>{usd(pay.grossPayCents)}</div>
          <div className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
            {fmtDuration(pay.workedMinutes)} worked
            {pay.payType === 'HOURLY' && pay.basePayCents > 0 ? ` · ${usd(pay.basePayCents)}/hr` : ''}
          </div>
        </div>
      )}

      {/* This week summary */}
      {(weekShifts > 0 || current) && (
        <div className="grid grid-cols-3 gap-3 mt-5">
          <div className="card p-4 text-center">
            <div className="text-xl font-bold" style={{ color: 'var(--ink-900)' }}>{fmtDuration(weekMins + (current ? 0 : 0))}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>This week</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-xl font-bold" style={{ color: 'var(--ink-900)' }}>{weekShifts}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>Shifts</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-xl font-bold" style={{ color: 'var(--ink-900)' }}>{fmtDuration(totalMins)}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>All time</div>
          </div>
        </div>
      )}

      {/* Shift history */}
      <div className="mt-7">
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink-700)' }}>Shift history</h2>

        {past.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-3xl mb-2">⏱</div>
            <p className="text-sm" style={{ color: 'var(--ink-500)' }}>No completed shifts yet. Clock in to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {past.map(e => {
              const mins    = shiftMins(e);
              const edited  = e.status === 'EDITED';
              const hasNote = e.notesByAdmin || e.notesByStaff;
              return (
                <div key={e.id} className="card p-4" style={{ borderLeft: edited ? '3px solid var(--brand-400)' : undefined }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold" style={{ color: 'var(--ink-900)' }}>
                          {fmtDate(e.clockedInAt)}
                        </span>
                        {edited && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}>
                            edited
                          </span>
                        )}
                      </div>
                      <div className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--ink-500)' }}>
                        <span>{fmtTime(e.clockedInAt)}</span>
                        <span>→</span>
                        <span>{e.clockedOutAt ? fmtTime(e.clockedOutAt) : '—'}</span>
                        {e.breakMinutes > 0 && <span style={{ color: 'var(--ink-400)' }}>· {e.breakMinutes}m break</span>}
                      </div>
                      {hasNote && (
                        <div className="text-xs mt-1.5 italic" style={{ color: 'var(--ink-400)' }}>
                          {e.notesByAdmin ? `Admin: ${e.notesByAdmin}` : e.notesByStaff}
                        </div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-base font-bold" style={{ color: 'var(--ink-900)' }}>
                        {mins > 0 ? fmtDuration(mins) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
