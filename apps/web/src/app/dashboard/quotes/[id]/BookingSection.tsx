'use client';

import type { JSX } from 'react';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

// A self-serve "pick a slot" flow maps cleanly to fixed-length jobs that fit in
// a single work day. Anything longer (multi-day installs, big commercial jobs)
// routes to the owner-driven propose-slots flow instead.
const SELF_SERVE_MAX_MINUTES = 480;

interface Slot { startAt: string; endAt: string; label: string }
interface ProposedSlot { startAt: string; endAt: string; label: string }
interface Appointment {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'RESCHEDULED';
  mode: 'SELF_SERVE' | 'PROPOSED';
  startAt: string | null;
  endAt: string | null;
  customerTimezone: string;
  businessTimezone: string;
  rescheduleToken: string | null;
  cancelToken: string | null;
  proposedSlots: ProposedSlot[] | null;
}

const CUSTOMER_TZ = typeof Intl !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : 'America/Denver';

function fmt(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });
}

export function BookingSection({
  quoteId, status, accepted, durationMinutes,
}: {
  quoteId: string;
  status: string;
  accepted: boolean;
  durationMinutes: number | null;
}): JSX.Element | null {
  const router = useRouter();
  const [appt, setAppt]       = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);

  // Scheduling opens once the customer approves the estimate (status stays
  // ESTIMATE_SENT until a time is confirmed), and stays visible while SCHEDULED.
  const active = (status === 'ESTIMATE_SENT' && accepted) || status === 'SCHEDULED';

  const loadAppointments = useCallback(async () => {
    try {
      const list = await api<Appointment[]>('GET', `/api/quotes/${quoteId}/appointments`);
      // Most recent active appointment wins (list is desc by createdAt).
      const activeAppt = list.find(a => a.status === 'CONFIRMED' || a.status === 'PROPOSED');
      setAppt(activeAppt ?? null);
    } catch {
      setAppt(null);
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    if (active) loadAppointments();
    else setLoading(false);
  }, [active, loadAppointments]);

  if (!active) return null;
  if (loading) return null;

  // Confirmed → show the booked window + self-serve manage links.
  if (appt?.status === 'CONFIRMED' && appt.startAt) {
    return <ConfirmedView appt={appt} />;
  }

  // Owner proposed a time → customer approves it or picks a conflict-free alternative.
  if (appt?.status === 'PROPOSED' && appt.proposedSlots?.length) {
    return (
      <ProposedChooser
        appt={appt}
        quoteId={quoteId}
        durationMinutes={durationMinutes ?? 120}
        onConfirmed={() => router.refresh()}
      />
    );
  }

  // Accepted but not yet scheduled.
  const selfServeEligible = durationMinutes != null && durationMinutes <= SELF_SERVE_MAX_MINUTES;
  if (selfServeEligible) {
    return (
      <SelfServePicker
        quoteId={quoteId}
        durationMinutes={durationMinutes!}
        onBooked={() => router.refresh()}
      />
    );
  }

  // Long/complex job — owner will propose windows.
  return (
    <div className="card p-5">
      <div className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>Scheduling in progress</div>
      <p className="text-sm" style={{ color: 'var(--ink-600)' }}>
        Thanks for accepting! Because this job spans more than a day, our team will
        email you a few appointment windows to choose from shortly.
      </p>
    </div>
  );
}

// ── Self-serve slot picker ────────────────────────────────────────────────────

function SelfServePicker({
  quoteId, durationMinutes, onBooked,
}: {
  quoteId: string;
  durationMinutes: number;
  onBooked: () => void;
}) {
  const [slots, setSlots]   = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<Slot[]>('GET', `/api/appointments/slots?durationMinutes=${durationMinutes}`);
        setSlots(s);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load times.');
      } finally { setLoading(false); }
    })();
  }, [durationMinutes]);

  async function pick(slot: Slot) {
    setBusy(true); setError(null);
    try {
      // 1) Hold the slot for 10 minutes (server enforces uniqueness — no race).
      const hold = await api<{ holdToken: string }>(
        'POST', '/api/appointments/holds',
        { startAt: slot.startAt, endAt: slot.endAt },
      );
      // 2) Immediately confirm the booking using that hold.
      await api('POST', '/api/appointments/confirm-self-serve', {
        holdToken: hold.holdToken,
        quoteRequestId: quoteId,
        customerTimezone: CUSTOMER_TZ,
      });
      onBooked();
    } catch (e) {
      // 409 = someone grabbed it first; refresh the list.
      setError(e instanceof ApiError ? e.message : 'Could not book that time.');
      if (e instanceof ApiError && e.status === 409) {
        const s = await api<Slot[]>('GET', `/api/appointments/slots?durationMinutes=${durationMinutes}`).catch(() => []);
        setSlots(s);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="card p-5">
      <div className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>Schedule your appointment</div>
      <p className="text-sm mb-3" style={{ color: 'var(--ink-500)' }}>
        Pick a time that works for you. Times shown in {CUSTOMER_TZ.replace(/_/g, ' ')}.
      </p>

      {loading && <p className="text-sm" style={{ color: 'var(--ink-500)' }}>Loading available times…</p>}
      {!loading && slots.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--ink-500)' }}>
          No open times right now — our team will reach out to schedule.
        </p>
      )}

      <div className="space-y-2">
        {slots.map(slot => (
          <button
            key={slot.startAt}
            disabled={busy}
            onClick={() => pick(slot)}
            className="w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--surface-200)', color: 'var(--ink-900)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--brand-400)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--surface-200)')}
          >
            {fmt(slot.startAt, CUSTOMER_TZ)}
          </button>
        ))}
      </div>

      {error && <div className="text-sm mt-3" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  );
}

// ── Proposed-slots chooser ────────────────────────────────────────────────────

function ProposedChooser({
  appt, quoteId, durationMinutes, onConfirmed,
}: {
  appt: Appointment;
  quoteId: string;
  durationMinutes: number;
  onConfirmed: () => void;
}) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const proposed = appt.proposedSlots ?? [];

  // Approve the owner's proposed window.
  async function approveProposed() {
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/appointments/${appt.id}/confirm-proposed`, {
        slotIndex: 0,
        customerTimezone: CUSTOMER_TZ,
      });
      onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not confirm that time.');
    } finally { setBusy(false); }
  }

  // Load 3 conflict-free alternatives from the owner's availability.
  async function loadAlternatives() {
    setShowAlternatives(true); setLoadingSlots(true); setError(null);
    try {
      const s = await api<Slot[]>('GET', `/api/appointments/slots?durationMinutes=${durationMinutes}`);
      setSlots(s.slice(0, 3));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load other times.');
    } finally { setLoadingSlots(false); }
  }

  async function pickAlternative(slot: Slot) {
    setBusy(true); setError(null);
    try {
      const hold = await api<{ holdToken: string }>('POST', '/api/appointments/holds', { startAt: slot.startAt, endAt: slot.endAt });
      await api('POST', '/api/appointments/confirm-self-serve', {
        holdToken: hold.holdToken,
        quoteRequestId: quoteId,
        customerTimezone: CUSTOMER_TZ,
      });
      onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not book that time.');
      if (e instanceof ApiError && e.status === 409) loadAlternatives();
    } finally { setBusy(false); }
  }

  return (
    <div className="card p-5">
      <div className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>Approve your appointment time</div>
      <p className="text-sm mb-3" style={{ color: 'var(--ink-500)' }}>
        {showAlternatives
          ? `Pick one of these open times. Times in ${CUSTOMER_TZ.replace(/_/g, ' ')}.`
          : `Our team proposed this time. Approve it, or see other options. Times in ${CUSTOMER_TZ.replace(/_/g, ' ')}.`}
      </p>

      {!showAlternatives ? (
        <>
          <div className="space-y-2">
            {proposed.map((slot, i) => (
              <div key={i} className="px-3 py-2.5 rounded-lg border text-sm font-medium"
                style={{ borderColor: 'var(--brand-400)', background: 'color-mix(in srgb, var(--brand-500) 6%, var(--surface-0))', color: 'var(--ink-900)' }}>
                {fmt(slot.startAt, CUSTOMER_TZ)}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary flex-1" disabled={busy} onClick={approveProposed}>
              {busy ? 'Confirming…' : 'Approve this time'}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={loadAlternatives}>
              This time doesn’t work
            </button>
          </div>
        </>
      ) : (
        <>
          {loadingSlots && <p className="text-sm" style={{ color: 'var(--ink-500)' }}>Loading open times…</p>}
          {!loadingSlots && slots.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--ink-500)' }}>No other open times right now — our team will reach out.</p>
          )}
          <div className="space-y-2">
            {slots.map(slot => (
              <button
                key={slot.startAt}
                disabled={busy}
                onClick={() => pickAlternative(slot)}
                className="w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors disabled:opacity-50"
                style={{ borderColor: 'var(--surface-200)', color: 'var(--ink-900)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--brand-400)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--surface-200)')}
              >
                {fmt(slot.startAt, CUSTOMER_TZ)}
              </button>
            ))}
          </div>
          <button className="btn-secondary text-sm mt-3" disabled={busy} onClick={() => setShowAlternatives(false)}>
            ← Back to proposed time
          </button>
        </>
      )}
      {error && <div className="text-sm mt-3" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  );
}

// ── Confirmed view ────────────────────────────────────────────────────────────

function ConfirmedView({ appt }: { appt: Appointment }) {
  const router = useRouter();
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason]       = useState('');
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const sameZone = appt.customerTimezone === appt.businessTimezone;

  async function cancel() {
    if (!appt.cancelToken) return;
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/book/cancel/${appt.cancelToken}`, { reason });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card p-5" style={{ borderColor: '#86efac', background: '#f0fdf4' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: '#bbf7d0', color: '#14532d', fontSize: 10 }}>
          Confirmed
        </span>
      </div>
      <div className="font-bold text-lg" style={{ color: '#14532d' }}>
        {fmt(appt.startAt!, appt.customerTimezone)}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
        Your time zone ({appt.customerTimezone.replace(/_/g, ' ')})
      </div>
      {!sameZone && (
        <div className="text-xs mt-1" style={{ color: 'var(--ink-500)' }}>
          Business time: {fmt(appt.startAt!, appt.businessTimezone)} ({appt.businessTimezone.replace(/_/g, ' ')})
        </div>
      )}

      <div className="flex gap-2 mt-4">
        {appt.rescheduleToken && (
          <a
            href={`/book/reschedule/${appt.rescheduleToken}`}
            className="btn-secondary text-sm flex-1 text-center"
          >
            Reschedule
          </a>
        )}
        {!canceling && (
          <button className="btn-secondary text-sm" onClick={() => setCanceling(true)}>Cancel</button>
        )}
      </div>

      {canceling && (
        <div className="mt-3 space-y-2">
          <textarea
            className="input" rows={2}
            placeholder="Reason for canceling (optional)"
            value={reason} onChange={e => setReason(e.target.value)}
          />
          {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}
          <div className="flex gap-2">
            <button className="btn-secondary text-sm flex-1" onClick={cancel} disabled={busy}>
              {busy ? 'Canceling…' : 'Confirm cancellation'}
            </button>
            <button className="btn-secondary text-sm" onClick={() => setCanceling(false)}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}
