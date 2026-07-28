'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import type { JobRow } from './page';

// ── Helpers ───────────────────────────────────────────────────────────────

const DAYS     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PRIORITY_STATUS = ['IN_PROGRESS','SCHEDULED','ESTIMATE_SENT','REVIEWING','NEW','COMPLETED','PAID','CANCELED'];
const STATUS_FILTER   = ['ALL','NEW','SCHEDULED','IN_PROGRESS','COMPLETED'];

function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay());
  s.setHours(0,0,0,0);
  return s;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function jobDate(r: JobRow): Date | null {
  const d = r.scheduledAt ?? r.preferredAt;
  return d ? new Date(d) : null;
}
function customerName(r: JobRow): string {
  return r.guestName ?? r.user?.customerProfiles?.[0]?.fullName ?? r.user?.email ?? 'Customer';
}
function relDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Main component ────────────────────────────────────────────────────────

interface Props {
  rows: JobRow[];
  defaultView: 'list' | 'week';
  defaultStatus: string;
  defaultQuery: string;
}

export function JobsView({ rows, defaultView, defaultStatus, defaultQuery }: Props) {
  const [view,   setView]   = useState<'list'|'week'>(defaultView);
  const [filter, setFilter] = useState(defaultStatus);
  const [query,  setQuery]  = useState(defaultQuery);
  const [weekOf, setWeekOf] = useState(() => startOfWeek(new Date()));
  const [sort,   setSort]   = useState<'priority'|'date'|'name'|'service'|'status'>('priority');

  const filtered = rows
    .filter(r => filter === 'ALL' || r.status === filter)
    .filter(r => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        customerName(r).toLowerCase().includes(q) ||
        r.service.name.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      switch (sort) {
        case 'date':    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'name':    return customerName(a).localeCompare(customerName(b));
        case 'service': return a.service.name.localeCompare(b.service.name);
        case 'status':  return a.status.localeCompare(b.status);
        default:        return PRIORITY_STATUS.indexOf(a.status) - PRIORITY_STATUS.indexOf(b.status);
      }
    });

  const active = rows.filter(r => ['IN_PROGRESS','SCHEDULED'].includes(r.status)).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--ink-900)' }}>Jobs</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-500)' }}>
            {active > 0 ? `${active} active job${active > 1 ? 's' : ''}` : 'All job requests'}
          </p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--surface-100)' }}>
          {(['list','week'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="text-sm px-3 py-1.5 rounded-md font-medium transition-colors capitalize"
              style={{
                background: view === v ? 'var(--surface-0)' : 'transparent',
                color: view === v ? 'var(--ink-900)' : 'var(--ink-500)',
                boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {v === 'list' ? '☰ List' : '📅 Week'}
            </button>
          ))}
        </div>
      </div>

      {/* Status pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        {STATUS_FILTER.map(s => {
          const active = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors border whitespace-nowrap"
              style={{
                background:  active ? 'var(--brand-600)' : 'var(--surface-0)',
                color:       active ? 'white' : 'var(--ink-600)' as any,
                borderColor: active ? 'var(--brand-600)' : 'var(--surface-200)',
              }}
            >
              {s === 'ALL' ? 'All jobs' : s.replace('_', ' ')}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ink-400)' }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6.5" cy="6.5" r="4"/><path d="M10.5 10.5l3 3"/>
        </svg>
        <input
          className="input pl-9 text-sm"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search customer, service, city…"
        />
      </div>

      {/* Sort (list view) */}
      {view === 'list' && (
        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="job-sort" className="text-xs" style={{ color: 'var(--ink-500)' }}>Sort by</label>
          <select id="job-sort" className="input py-1.5 text-sm w-44" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
            <option value="priority">Priority</option>
            <option value="date">Newest</option>
            <option value="name">Name</option>
            <option value="service">Service</option>
            <option value="status">Status</option>
          </select>
        </div>
      )}

      {/* Views */}
      {view === 'list' ? (
        <ListView rows={filtered} />
      ) : (
        <WeekView rows={rows} weekOf={weekOf} onPrev={() => setWeekOf(w => addDays(w, -7))} onNext={() => setWeekOf(w => addDays(w, 7))} />
      )}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────

function ListView({ rows }: { rows: JobRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="text-4xl mb-3">🔍</div>
        <div className="font-medium" style={{ color: 'var(--ink-700)' }}>No jobs found</div>
        <div className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>Try a different filter.</div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {rows.map(r => {
        const name    = customerName(r);
        const urgent  = r.status === 'IN_PROGRESS';
        const dateStr = r.scheduledAt ?? r.preferredAt;
        return (
          <Link
            key={r.id}
            href={`/dashboard/jobs/${r.id}`}
            className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow"
            style={{ borderLeft: urgent ? '3px solid var(--brand-500)' : undefined }}
          >
            <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
              {name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: 'var(--ink-900)' }}>{name}</span>
                <StatusPill status={r.status} />
              </div>
              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-500)' }}>
                {r.service.name} · {r.addressLine}, {r.city}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs" style={{ color: 'var(--ink-400)' }}>
                {dateStr ? new Date(dateStr).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : relDate(r.createdAt)}
              </div>
            </div>
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--ink-300)' }}>
              <path d="M6 4l4 4-4 4"/>
            </svg>
          </Link>
        );
      })}
    </div>
  );
}

// ── Week calendar view ────────────────────────────────────────────────────

function WeekView({ rows, weekOf, onPrev, onNext }: {
  rows: JobRow[];
  weekOf: Date;
  onPrev: () => void;
  onNext: () => void;
}) {
  const today = new Date();
  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i));

  // Group rows by day (use scheduledAt then preferredAt)
  const byDay = new Map<string, JobRow[]>();
  for (const r of rows) {
    const d = jobDate(r);
    if (!d) continue;
    // Only show active/upcoming statuses on calendar
    if (!['SCHEDULED','IN_PROGRESS','NEW','REVIEWING'].includes(r.status)) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(r);
  }

  const weekLabel = `${MONTHS[weekOf.getMonth()]} ${weekOf.getDate()} – ${MONTHS[addDays(weekOf, 6).getMonth()]} ${addDays(weekOf, 6).getDate()}, ${addDays(weekOf, 6).getFullYear()}`;
  const isThisWeek = isSameDay(weekOf, startOfWeek(today));

  // Jobs with no date for the week's unscheduled section
  const unscheduled = rows.filter(r =>
    ['SCHEDULED','NEW','REVIEWING'].includes(r.status) && !r.scheduledAt && !r.preferredAt
  );

  return (
    <div>
      {/* Week nav */}
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary text-sm py-1.5 px-3" onClick={onPrev}>← Prev</button>
        <div className="text-center">
          <div className="text-sm font-semibold" style={{ color: 'var(--ink-900)' }}>{weekLabel}</div>
          {!isThisWeek && (
            <button className="text-xs mt-0.5" style={{ color: 'var(--brand-600)' }} onClick={() => {}}>
              Today
            </button>
          )}
        </div>
        <button className="btn-secondary text-sm py-1.5 px-3" onClick={onNext}>Next →</button>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden border" style={{ borderColor: 'var(--surface-200)' }}>
        {days.map(day => {
          const key    = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const jobs   = byDay.get(key) ?? [];
          const isToday = isSameDay(day, today);

          return (
            <div key={key} className="flex flex-col min-h-[160px]" style={{ background: 'var(--surface-0)' }}>
              {/* Day header */}
              <div className="px-2 pt-2 pb-1 border-b" style={{ borderColor: 'var(--surface-100)' }}>
                <div className="text-xs font-medium" style={{ color: 'var(--ink-400)' }}>{DAYS[day.getDay()]}</div>
                <div
                  className="text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mt-0.5"
                  style={isToday
                    ? { background: 'var(--brand-600)', color: 'white' }
                    : { color: 'var(--ink-800)' }}
                >
                  {day.getDate()}
                </div>
              </div>

              {/* Jobs */}
              <div className="px-1.5 py-1.5 flex flex-col gap-1 flex-1">
                {jobs.length === 0 && (
                  <div className="text-center py-4 text-xs" style={{ color: 'var(--ink-200)' }}>—</div>
                )}
                {jobs.map(r => (
                  <Link
                    key={r.id}
                    href={`/dashboard/jobs/${r.id}`}
                    className="block rounded-md px-1.5 py-1 text-xs font-medium truncate hover:opacity-80 transition-opacity"
                    style={{
                      background: r.status === 'IN_PROGRESS' ? 'var(--brand-100)' : r.status === 'SCHEDULED' ? '#d1fae5' : '#fef9c3',
                      color:      r.status === 'IN_PROGRESS' ? 'var(--brand-700)' : r.status === 'SCHEDULED' ? '#065f46' : '#854d0e',
                    }}
                    title={`${customerName(r)} — ${r.service.name}`}
                  >
                    {customerName(r)}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs" style={{ color: 'var(--ink-400)' }}>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'var(--brand-100)' }} /> In progress</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#d1fae5' }} /> Scheduled</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#fef9c3' }} /> Accepted / New</span>
      </div>

      {/* Unscheduled jobs */}
      {unscheduled.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink-600)' as any }}>
            Unscheduled ({unscheduled.length})
          </h2>
          <div className="grid gap-2">
            {unscheduled.map(r => (
              <Link key={r.id} href={`/dashboard/jobs/${r.id}`} className="card p-3 flex items-center gap-3 hover:shadow-md transition-shadow">
                <StatusPill status={r.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium" style={{ color: 'var(--ink-900)' }}>{customerName(r)}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--ink-400)' }}>{r.service.name} · {r.city}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
