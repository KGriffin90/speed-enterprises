'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { BookingShell, CUSTOMER_TZ, fmt } from '../../BookingShell';

interface Slot { startAt: string; endAt: string; label: string }
interface RescheduleData {
  appointment: {
    startAt: string | null;
    customerTimezone: string;
    quoteRequest?: { service?: { name?: string } };
  };
  availableSlots: Slot[];
}

export default function ReschedulePage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const [data, setData]     = useState<RescheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  async function load() {
    try {
      const d = await api<RescheduleData>('GET', `/api/book/reschedule/${params.token}`);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reschedule link not found.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.token]);

  async function pick(slot: Slot) {
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/book/reschedule/${params.token}`, {
        startAt: slot.startAt,
        endAt: slot.endAt,
        customerTimezone: CUSTOMER_TZ,
      });
      setDone(slot.startAt);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reschedule.');
      // Slot may have been taken — refresh the list.
      if (e instanceof ApiError && e.status === 409) load();
    } finally { setBusy(false); }
  }

  if (loading) {
    return <BookingShell title="Loading…"><p style={{ color: '#475569' }}>Fetching available times…</p></BookingShell>;
  }

  if (done) {
    return (
      <BookingShell title="Rescheduled 🎉">
        <p style={{ color: '#475569' }}>
          Your appointment is now set for <strong>{fmt(done, CUSTOMER_TZ)}</strong>.
          A confirmation email is on its way.
        </p>
      </BookingShell>
    );
  }

  if (error && !data) {
    return <BookingShell title="Link not available"><p style={{ color: '#dc2626' }}>{error}</p></BookingShell>;
  }

  return (
    <BookingShell title="Reschedule your appointment">
      {data?.appointment.startAt && (
        <p style={{ color: '#475569', marginBottom: '0.75rem' }}>
          Currently scheduled for <strong>{fmt(data.appointment.startAt, CUSTOMER_TZ)}</strong>.
          Pick a new time below.
        </p>
      )}
      <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '1rem' }}>
        Times shown in {CUSTOMER_TZ.replace(/_/g, ' ')}.
      </p>

      {data?.availableSlots.length === 0 && (
        <p style={{ color: '#475569' }}>No open times right now — please contact the business directly.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {data?.availableSlots.map(slot => (
          <button
            key={slot.startAt}
            disabled={busy}
            onClick={() => pick(slot)}
            style={{ textAlign: 'left', padding: '0.7rem', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', color: '#0f172a', opacity: busy ? 0.5 : 1 }}
          >
            {fmt(slot.startAt, CUSTOMER_TZ)}
          </button>
        ))}
      </div>

      {error && <div style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.75rem' }}>{error}</div>}
    </BookingShell>
  );
}
