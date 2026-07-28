'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { BookingShell, CUSTOMER_TZ } from '../../BookingShell';

export default function ConfirmProposedPage(): JSX.Element {
  const params = useParams<{ appointmentId: string }>();
  const search = useSearchParams();
  const slot   = search.get('slot') ?? '0';

  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/book/confirm-proposed/${params.appointmentId}?slot=${slot}`, {
        customerTimezone: CUSTOMER_TZ,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not confirm. The slot may have been taken.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <BookingShell title="Appointment confirmed 🎉">
        <p style={{ color: '#475569' }}>
          You're all set. A confirmation email is on its way with the details and
          links to reschedule or cancel if you need to.
        </p>
      </BookingShell>
    );
  }

  return (
    <BookingShell title="Confirm your appointment">
      <p style={{ color: '#475569', marginBottom: '1rem' }}>
        Click below to lock in the time you selected. We'll email you a confirmation.
      </p>
      {error && <div style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</div>}
      <button
        onClick={confirm}
        disabled={busy}
        style={{ width: '100%', padding: '0.7rem', borderRadius: 8, background: '#059669', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Confirming…' : 'Confirm this time'}
      </button>
    </BookingShell>
  );
}
