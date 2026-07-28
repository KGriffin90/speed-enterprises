'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

// Staff-facing route view. Per-stop arrival/departure timing is OWNER-ONLY and is
// not returned by the API here — staff see the ordered stop addresses and a
// Current/Next/Done marker so they know where to go. Arrival/departure is detected
// automatically from GPS (see the route geofence), so there are no manual controls.
interface Stop {
  id: string;
  sequence: number;
  label: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  status: 'PENDING' | 'ARRIVED' | 'DONE' | 'SKIPPED';
}
interface AssignedRoute {
  id: string;
  name: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  plannedForDate: string | null;
  stops: Stop[];
}

export function AssignedRoutes(): JSX.Element | null {
  const [routes, setRoutes] = useState<AssignedRoute[] | null>(null);

  useEffect(() => {
    (async () => {
      try { setRoutes(await api<AssignedRoute[]>('GET', '/api/me/routes/assigned')); }
      catch { setRoutes([]); }
    })();
  }, []);

  if (routes === null || routes.length === 0) return null;

  return (
    <div className="mb-8 space-y-5">
      <h2 className="text-lg font-bold" style={{ color: 'var(--ink-900)' }}>Your assigned routes</h2>
      {routes.map(route => {
        // "Next" is the first stop you haven't visited yet; "Current" is the one
        // GPS has you on site at.
        const nextStop = route.stops.find(s => s.status === 'PENDING');
        return (
          <div key={route.id} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-bold" style={{ color: 'var(--ink-900)' }}>{route.name ?? 'Route'}</div>
                <div className="text-xs" style={{ color: 'var(--ink-500)' }}>
                  {route.stops.length} stops{route.plannedForDate ? ` · ${new Date(route.plannedForDate).toLocaleDateString()}` : ''}
                </div>
              </div>
              {route.status === 'IN_PROGRESS' && <span className="text-xs font-semibold" style={{ color: '#059669' }}>● in progress</span>}
            </div>

            <ol className="space-y-2">
              {route.stops.map((s, i) => {
                const isCurrent = s.status === 'ARRIVED';
                const isNext = nextStop?.id === s.id;
                const marker = isCurrent ? 'Current' : isNext ? 'Next' : s.status === 'DONE' ? 'Done' : null;
                return (
                  <li key={s.id} className="flex items-start gap-3 py-2" style={{ borderTop: i ? '1px solid var(--surface-100)' : undefined }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                      style={{
                        background: s.status === 'DONE' ? '#eff6ff' : isCurrent ? '#ecfdf5' : 'var(--surface-100)',
                        color: s.status === 'DONE' ? '#2563eb' : isCurrent ? '#059669' : 'var(--ink-500)',
                      }}>
                      {s.status === 'DONE' ? '✓' : i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm" style={{ color: 'var(--ink-900)' }}>{s.label}</div>
                      {(s.addressLine || s.city) && (
                        <div className="text-xs" style={{ color: 'var(--ink-500)' }}>{[s.addressLine, s.city, s.state].filter(Boolean).join(', ')}</div>
                      )}
                    </div>
                    {marker && (
                      <span className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: isCurrent ? '#ecfdf5' : isNext ? 'var(--brand-100)' : 'var(--surface-100)',
                          color: isCurrent ? '#059669' : isNext ? 'var(--brand-700)' : 'var(--ink-500)',
                        }}>
                        {marker}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
