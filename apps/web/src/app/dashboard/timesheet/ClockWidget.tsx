'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

interface TimeEntry {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  status: string;
}

interface Props {
  initial: TimeEntry | null;
}

function elapsed(from: string): string {
  const secs = Math.floor((Date.now() - new Date(from).getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ClockWidget({ initial }: Props) {
  const router = useRouter();
  const [active, setActive] = useState<TimeEntry | null>(initial);
  const [tick, setTick]     = useState('00:00:00');
  const [note, setNote]     = useState('');
  const [breakMins, setBreakMins] = useState(0);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [trackingRoute, setTrackingRoute] = useState(false);
  const [routeId, setRouteId]   = useState<string | null>(null);
  const [miles, setMiles]       = useState<number | null>(null);
  const watchRef   = useRef<number | null>(null);
  const routeIdRef = useRef<string | null>(null);

  // Live elapsed timer
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(elapsed(active.clockedInAt)), 1000);
    return () => clearInterval(id);
  }, [active]);

  // GPS tracking
  useEffect(() => {
    routeIdRef.current = routeId;
  }, [routeId]);

  async function startTracking(entryId: string) {
    if (!('geolocation' in navigator)) return;
    try {
      const route = await api<{ id: string }>('POST', '/api/me/routes', { timeEntryId: entryId });
      setRouteId(route.id);
      setTrackingRoute(true);

      watchRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const rid = routeIdRef.current;
          if (!rid) return;
          await api('POST', `/api/me/routes/${rid}/waypoints`, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            altitude: pos.coords.altitude ?? undefined,
            recordedAt: new Date(pos.timestamp).toISOString(),
          }).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
      );
    } catch {
      // GPS tracking is best-effort — don't block clock-in if it fails
    }
  }

  async function stopTracking() {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    const rid = routeIdRef.current;
    if (!rid) return;
    try {
      const ended = await api<{ distanceMiles: number | null; gallonsUsed: number | null }>(
        'POST', `/api/me/routes/${rid}/end`,
      );
      if (ended.distanceMiles != null) setMiles(ended.distanceMiles);
    } catch {}
    setRouteId(null);
    setTrackingRoute(false);
  }

  async function clockIn() {
    setBusy(true); setError(null);
    try {
      const entry = await api<TimeEntry>('POST', '/api/me/time/clock-in', { notesByStaff: note || undefined });
      setActive(entry);
      setTick(elapsed(entry.clockedInAt));
      setNote('');
      await startTracking(entry.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to clock in');
    } finally { setBusy(false); }
  }

  async function clockOut() {
    setBusy(true); setError(null);
    await stopTracking();
    try {
      await api('POST', '/api/me/time/clock-out', {
        notesByStaff: note || undefined,
        breakMinutes: breakMins,
      });
      setActive(null);
      setNote('');
      setBreakMins(0);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to clock out');
    } finally { setBusy(false); }
  }

  const isClockedIn = !!active;

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ink-500)' }}>
            {isClockedIn ? 'Currently clocked in' : 'Not clocked in'}
          </div>
          <div className="text-4xl font-mono font-bold" style={{ color: isClockedIn ? 'var(--brand-600)' : 'var(--ink-300)' }}>
            {isClockedIn ? tick : '00:00:00'}
          </div>
          {isClockedIn && (
            <div className="text-xs mt-1" style={{ color: 'var(--ink-500)' }}>
              Since {new Date(active.clockedInAt).toLocaleTimeString()}
              {trackingRoute && (
                <span className="ml-2 inline-flex items-center gap-1" style={{ color: '#059669' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                  GPS tracking
                </span>
              )}
            </div>
          )}
          {miles != null && !isClockedIn && (
            <div className="text-xs mt-1" style={{ color: 'var(--ink-500)' }}>
              Last route: {miles.toFixed(1)} mi driven
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 min-w-[200px]">
          <input
            className="input text-sm"
            placeholder={isClockedIn ? 'Clock-out note (optional)' : 'Note (optional)'}
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          {isClockedIn && (
            <div className="flex items-center gap-2">
              <label className="text-xs whitespace-nowrap" style={{ color: 'var(--ink-500)' }}>Break (min)</label>
              <input
                className="input text-sm w-20"
                type="number" min={0} step={5}
                value={breakMins}
                onChange={e => setBreakMins(parseInt(e.target.value) || 0)}
              />
            </div>
          )}
          <button
            className={isClockedIn ? 'btn-secondary' : 'btn-primary'}
            onClick={isClockedIn ? clockOut : clockIn}
            disabled={busy}
            style={isClockedIn ? { borderColor: '#dc2626', color: '#dc2626' } : {}}
          >
            {busy ? '…' : isClockedIn ? 'Clock out' : 'Clock in'}
          </button>
        </div>
      </div>

      {error && <div className="text-xs mt-3" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  );
}
