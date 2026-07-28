'use client';

import type { JSX } from 'react';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

interface Appointment {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'RESCHEDULED';
  mode: 'SELF_SERVE' | 'PROPOSED';
  startAt: string | null;
  businessTimezone: string;
  proposedSlots: Array<{ startAt: string; label: string }> | null;
}

const BUSINESS_TZ = typeof Intl !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : 'America/Denver';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** Owner-side scheduling control. Shows current appointment state and — when the
 *  quote is accepted but unscheduled — lets the owner propose 2–3 windows for the
 *  customer to confirm (the complex/multi-day flow). */
export function SchedulingPanel({ quoteId, status }: { quoteId: string; status: string }): JSX.Element | null {
  const router = useRouter();
  const [appt, setAppt]       = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [windows, setWindows] = useState<string[]>(['']);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Appointment[]>('GET', `/api/quotes/${quoteId}/appointments`);
      setAppt(list.find(a => a.status === 'CONFIRMED' || a.status === 'PROPOSED') ?? null);
    } catch {
      setAppt(null);
    } finally { setLoading(false); }
  }, [quoteId]);

  useEffect(() => {
    if (['ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS'].includes(status)) load();
    else setLoading(false);
  }, [status, load]);

  // Only relevant once the customer has accepted the estimate.
  if (!['ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS'].includes(status)) return null;
  if (loading) return null;

  async function submitProposal() {
    const valid = windows.map(w => w.trim()).filter(Boolean);
    if (valid.length < 1) { setError('Add at least one window.'); return; }
    setBusy(true); setError(null);
    try {
      const payload = valid.map(local => {
        const start = new Date(local); // datetime-local is in business local time
        // Default 2h window; the real duration is enforced server-side from the service.
        const end = new Date(start.getTime() + 2 * 60 * 60_000);
        return { startAt: start.toISOString(), endAt: end.toISOString() };
      });
      await api('POST', '/api/appointments/propose', { quoteRequestId: quoteId, windows: payload });
      setProposing(false);
      setWindows(['']);
      router.refresh();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not propose slots.');
    } finally { setBusy(false); }
  }

  async function cancelAppointment() {
    if (!appt) return;
    setBusy(true); setError(null);
    try {
      await api('DELETE', `/api/appointments/${appt.id}`, { reason: 'Canceled by business' });
      router.refresh();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel.');
    } finally { setBusy(false); }
  }

  // ── Confirmed appointment ──
  if (appt?.status === 'CONFIRMED' && appt.startAt) {
    return (
      <div className="card p-5">
        <div className="font-semibold mb-2" style={{ color: 'var(--ink-900)' }}>Appointment</div>
        <div className="text-lg font-bold" style={{ color: 'var(--ink-900)' }}>{fmt(appt.startAt)}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
          {appt.businessTimezone.replace(/_/g, ' ')} · booked {appt.mode === 'SELF_SERVE' ? 'by customer' : 'via proposal'}
        </div>
        <button className="btn-secondary text-sm mt-4" onClick={cancelAppointment} disabled={busy}>
          {busy ? 'Canceling…' : 'Cancel appointment'}
        </button>
        {error && <div className="text-sm mt-2" style={{ color: '#dc2626' }}>{error}</div>}
      </div>
    );
  }

  // ── Proposed, awaiting customer pick ──
  if (appt?.status === 'PROPOSED' && appt.proposedSlots?.length) {
    return (
      <div className="card p-5">
        <div className="font-semibold mb-2" style={{ color: 'var(--ink-900)' }}>Awaiting customer</div>
        <p className="text-sm mb-2" style={{ color: 'var(--ink-500)' }}>
          You proposed these windows. The customer will confirm one:
        </p>
        <ul className="text-sm space-y-1">
          {appt.proposedSlots.map((s, i) => (
            <li key={i} style={{ color: 'var(--ink-700)' }}>• {fmt(s.startAt)}</li>
          ))}
        </ul>
        <button className="btn-secondary text-sm mt-4" onClick={cancelAppointment} disabled={busy}>
          {busy ? 'Withdrawing…' : 'Withdraw proposal'}
        </button>
        {error && <div className="text-sm mt-2" style={{ color: '#dc2626' }}>{error}</div>}
      </div>
    );
  }

  // ── Accepted, unscheduled → offer to propose windows ──
  return (
    <div className="card p-5">
      <div className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>Scheduling</div>
      <p className="text-sm mb-3" style={{ color: 'var(--ink-500)' }}>
        Short jobs let the customer self-book. For multi-day or complex work, propose
        2–3 windows for them to choose from. Times in {BUSINESS_TZ.replace(/_/g, ' ')}.
      </p>

      {!proposing ? (
        <button className="btn-primary w-full" onClick={() => setProposing(true)}>Propose appointment windows</button>
      ) : (
        <div className="space-y-3">
          {windows.map((w, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="datetime-local"
                className="input flex-1"
                value={w}
                onChange={e => setWindows(ws => ws.map((x, j) => j === i ? e.target.value : x))}
              />
              {windows.length > 1 && (
                <button className="btn-secondary text-sm" onClick={() => setWindows(ws => ws.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
          {windows.length < 3 && (
            <button className="text-sm link" onClick={() => setWindows(ws => [...ws, ''])}>+ Add another window</button>
          )}
          {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={submitProposal} disabled={busy}>
              {busy ? 'Sending…' : 'Send to customer'}
            </button>
            <button className="btn-secondary" onClick={() => { setProposing(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
