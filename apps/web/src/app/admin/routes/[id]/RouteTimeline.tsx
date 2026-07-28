'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

export interface RouteStop {
  id: string;
  sequence: number;
  label: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  status: 'PENDING' | 'ARRIVED' | 'DONE' | 'SKIPPED';
  arrivedAt: string | null;
  departedAt: string | null;
  onSiteMinutes: number | null;
  driveMinutesFromPrev: number | null;
}

export interface RouteDetail {
  id: string;
  name: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  startedAt: string;
  endedAt: string | null;
  plannedForDate: string | null;
  distanceMiles: number | null;
  gallonsUsed: number | null;
  membership: { fullName: string | null; user: { email: string | null } } | null;
  crew?: Array<{ membershipId: string; fullName: string | null; email: string | null }>;
  stops: RouteStop[];
  waypoints?: Array<{ lat: number; lng: number; recordedAt: string; speed: number | null }>;
  _count?: { waypoints: number };
}

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  PLANNED:     { bg: 'var(--surface-100)', fg: 'var(--ink-600)', label: 'Planned' },
  IN_PROGRESS: { bg: '#ecfdf5', fg: '#059669', label: 'Active' },
  COMPLETED:   { bg: '#eff6ff', fg: '#2563eb', label: 'Completed' },
  CANCELED:    { bg: '#fef2f2', fg: '#991b1b', label: 'Canceled' },
};

function fmtDur(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

export function RouteTimeline({ initial, routeId }: { initial: RouteDetail; routeId: string }): JSX.Element {
  const [route, setRoute] = useState<RouteDetail>(initial);

  // Poll while the route is live so the owner watches stops complete in near
  // real time. Stops once the route is finished.
  useEffect(() => {
    if (route.status !== 'IN_PROGRESS' && route.status !== 'PLANNED') return;
    const t = setInterval(async () => {
      try {
        const fresh = await api<RouteDetail>('GET', `/api/admin/routes/${routeId}`);
        setRoute(fresh);
      } catch { /* keep last */ }
    }, 10_000);
    return () => clearInterval(t);
  }, [routeId, route.status]);

  const st = STATUS[route.status] ?? { bg: 'var(--surface-100)', fg: 'var(--ink-600)', label: route.status };
  const totalOnSite = route.stops.reduce((s, x) => s + (x.onSiteMinutes ?? 0), 0);
  const totalDrive = route.stops.reduce((s, x) => s + (x.driveMinutesFromPrev ?? 0), 0);
  const currentStop = route.stops.find(s => s.status === 'ARRIVED');

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>{route.name ?? 'Route'}</h1>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
        {route.status === 'IN_PROGRESS' && (
          <span className="text-xs" style={{ color: '#059669' }}>● live · auto-refreshing</span>
        )}
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-500)' }}>
        {(route.crew && route.crew.length > 0
          ? route.crew.map(c => c.fullName ?? c.email ?? '—').join(', ')
          : route.membership?.fullName ?? route.membership?.user.email ?? 'Unassigned')}
        {route.plannedForDate ? ` · ${new Date(route.plannedForDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}` : ''}
        {currentStop ? ` · on site at: ${currentStop.label}` : ''}
      </p>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-6">
        <Tile label="Time on jobs" value={fmtDur(totalOnSite || null)} />
        <Tile label="Drive time" value={fmtDur(totalDrive || null)} />
        <Tile label="Miles" value={route.distanceMiles != null ? route.distanceMiles.toFixed(1) : '—'} />
        <Tile label="Gallons" value={route.gallonsUsed != null ? route.gallonsUsed.toFixed(2) : '—'} />
      </div>

      {/* Live GPS location (latest fix) */}
      {route.waypoints && route.waypoints.length > 0 ? (
        <div className="card p-4 mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ink-500)' }}>Last known location</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--ink-900)' }}>
              {route.waypoints[0]!.lat.toFixed(5)}, {route.waypoints[0]!.lng.toFixed(5)}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
              {new Date(route.waypoints[0]!.recordedAt).toLocaleString()} · {route._count?.waypoints ?? 0} GPS points
            </div>
          </div>
          <a
            className="btn-secondary text-sm whitespace-nowrap"
            target="_blank"
            rel="noreferrer"
            href={`https://www.google.com/maps?q=${route.waypoints[0]!.lat},${route.waypoints[0]!.lng}`}
          >
            View on map ↗
          </a>
        </div>
      ) : (
        <div className="card p-4 mb-6 text-sm" style={{ color: 'var(--ink-500)' }}>
          No GPS location yet — it appears once the assigned staff start tracking (mobile app, or the timesheet page open in a browser).
        </div>
      )}

      {/* Stop-by-stop timeline */}
      <div className="space-y-0">
        {route.stops.map((s, i) => (
          <div key={s.id}>
            {/* Drive segment from the previous stop */}
            {i > 0 && (
              <div className="flex items-center gap-3 pl-4 py-1.5 text-xs" style={{ color: 'var(--ink-500)' }}>
                <span style={{ width: 24 }}>↓</span>
                <span>Drive {fmtDur(s.driveMinutesFromPrev)}</span>
              </div>
            )}
            <div className="card p-4 flex items-start gap-4"
              style={s.status === 'ARRIVED' ? { borderColor: '#059669', boxShadow: '0 0 0 1px #059669' } : undefined}>
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{
                  background: s.status === 'DONE' ? '#eff6ff' : s.status === 'ARRIVED' ? '#ecfdf5' : 'var(--surface-100)',
                  color: s.status === 'DONE' ? '#2563eb' : s.status === 'ARRIVED' ? '#059669' : 'var(--ink-500)',
                }}>
                {s.status === 'DONE' ? '✓' : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: 'var(--ink-900)' }}>{s.label}</div>
                {(s.addressLine || s.city) && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
                    {[s.addressLine, s.city, s.state, s.postalCode].filter(Boolean).join(', ')}
                  </div>
                )}
                <div className="text-xs mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--ink-600)' }}>
                  <span>Arrived: <b>{fmtTime(s.arrivedAt)}</b></span>
                  <span>Departed: <b>{fmtTime(s.departedAt)}</b></span>
                  <span>On site: <b style={{ color: 'var(--brand-600)' }}>{fmtDur(s.onSiteMinutes)}</b></span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {route.stops.length === 0 && (
          <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-500)' }}>No stops on this route.</div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ink-500)' }}>{label}</div>
      <div className="text-xl font-bold" style={{ color: 'var(--ink-900)' }}>{value}</div>
    </div>
  );
}
