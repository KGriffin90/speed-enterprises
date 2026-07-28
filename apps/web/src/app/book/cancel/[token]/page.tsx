'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { BookingShell } from '../../BookingShell';

export default function CancelPage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function cancel() {
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/book/cancel/${params.token}`, { reason });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <BookingShell title="Appointment canceled">
        <p style={{ color: '#475569' }}>
          Your appointment has been canceled. If you'd like to reschedule, contact the
          business and they'll get you set up again.
        </p>
      </BookingShell>
    );
  }

  return (
    <BookingShell title="Cancel your appointment">
      <p style={{ color: '#475569', marginBottom: '1rem' }}>
        Are you sure you want to cancel? Let us know why (optional) so we can improve.
      </p>
      <textarea
        rows={3}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason for canceling"
        style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: '0.75rem' }}
      />
      {error && <div style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</div>}
      <button
        onClick={cancel}
        disabled={busy}
        style={{ width: '100%', padding: '0.7rem', borderRadius: 8, background: '#dc2626', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Canceling…' : 'Confirm cancellation'}
      </button>
    </BookingShell>
  );
}
