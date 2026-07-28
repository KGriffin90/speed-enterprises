import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import type { QuoteStatus } from '@speed-enterprises/shared';

interface ScheduledQuote {
  id: string;
  status: QuoteStatus;
  scheduledAt: string | null;
  preferredAt: string | null;
  addressLine: string; city: string; state: string;
  guestName: string | null;
  service: { name: string };
  user: { email: string; customerProfiles: { fullName: string }[] } | null;
}

export const metadata = { title: 'Admin · Schedule' };

function startOfMonth(y: number, m: number) { return new Date(y, m, 1); }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

export default async function SchedulePage({ searchParams }: { searchParams: { y?: string; m?: string } }) {
  requireTenantRole('OWNER');

  const now   = new Date();
  const year  = parseInt(searchParams.y ?? String(now.getFullYear()));
  const month = parseInt(searchParams.m ?? String(now.getMonth())); // 0-indexed

  // Fetch each relevant status separately and merge, since the admin endpoint
  // only supports a single ?status= value at a time.
  const [scheduled, inProgress] = await Promise.all([
    apiServer<ScheduledQuote[]>('GET', '/api/admin/quotes?status=SCHEDULED').catch(() => []),
    apiServer<ScheduledQuote[]>('GET', '/api/admin/quotes?status=IN_PROGRESS').catch(() => []),
  ]);
  const quotes = [...scheduled, ...inProgress];

  // Group by day-of-month
  const byDay: Record<number, ScheduledQuote[]> = {};
  for (const q of quotes) {
    const d = q.scheduledAt ?? q.preferredAt;
    if (!d) continue;
    const dt = new Date(d);
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      const day = dt.getDate();
      (byDay[day] ??= []).push(q);
    }
  }

  const totalDays = daysInMonth(year, month);
  const firstDow  = startOfMonth(year, month).getDay(); // 0=Sun
  const cells = Array.from({ length: Math.ceil((firstDow + totalDays) / 7) * 7 });

  const prevMonth = month === 0 ? { y: year - 1, m: 11 } : { y: year, m: month - 1 };
  const nextMonth = month === 11 ? { y: year + 1, m: 0  } : { y: year, m: month + 1 };

  const monthName = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Schedule</h1>
        <div className="flex items-center gap-3">
          <Link href={`/admin/schedule?y=${prevMonth.y}&m=${prevMonth.m}`} className="btn-secondary text-sm py-1.5 px-3">←</Link>
          <span className="font-semibold text-sm" style={{ color: 'var(--ink-900)' }}>{monthName}</span>
          <Link href={`/admin/schedule?y=${nextMonth.y}&m=${nextMonth.m}`} className="btn-secondary text-sm py-1.5 px-3">→</Link>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center text-xs font-medium py-1" style={{ color: 'var(--ink-500)' }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px" style={{ background: 'var(--surface-200)' }}>
        {cells.map((_, i) => {
          const day = i - firstDow + 1;
          const isValid = day >= 1 && day <= totalDays;
          const isToday = isValid && new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
          const jobs = isValid ? (byDay[day] ?? []) : [];

          return (
            <div
              key={i}
              className="min-h-[90px] p-1.5"
              style={{ background: isValid ? 'var(--surface-0)' : 'var(--surface-50)' }}
            >
              {isValid && (
                <>
                  <div
                    className="text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full"
                    style={isToday
                      ? { background: 'var(--brand-500)', color: 'white' }
                      : { color: 'var(--ink-500)' }
                    }
                  >
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {jobs.map(q => (
                      <Link
                        key={q.id}
                        href={`/admin/quotes/${q.id}`}
                        className="block truncate text-xs rounded px-1 py-0.5 font-medium hover:opacity-80 transition"
                        style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}
                        title={`${q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? q.user?.email ?? 'Customer'} — ${q.service.name} — ${q.city}`}
                      >
                        {q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? q.user?.email ?? 'Customer'}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Agenda list below calendar */}
      <div className="mt-8">
        <h2 className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>This month's jobs</h2>
        {Object.keys(byDay).length === 0 ? (
          <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-500)' }}>
            No scheduled jobs this month. Jobs appear here when their status is SCHEDULED or IN_PROGRESS and have a scheduled date.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Service</th>
                  <th className="text-left px-4 py-3 font-medium">Address</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byDay)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .flatMap(([day, jobs]) => jobs.map(q => (
                    <tr key={q.id} className="border-t relative hover:bg-[var(--surface-50)] cursor-pointer transition-colors" style={{ borderColor: 'var(--surface-100)' }}>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink-700)' }}>
                        <Link href={`/admin/quotes/${q.id}`} className="after:absolute after:inset-0">
                          {monthName.split(' ')[0]} {day}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-900)' }}>{q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? q.user?.email ?? '—'}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>{q.service.name}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-500)' }}>{q.addressLine}, {q.city}</td>
                      <td className="px-4 py-3"><StatusPill status={q.status} /></td>
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
