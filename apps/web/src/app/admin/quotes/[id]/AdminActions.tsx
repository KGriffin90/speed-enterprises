'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import type { QuoteStatus } from '@speed-enterprises/shared';

interface Props {
  quoteId: string;
  currentStatus: QuoteStatus;
  allowedTransitions: QuoteStatus[];
  canSendEstimate: boolean;
  /** Owner-only: permanently remove the quote from the lists. */
  canDelete: boolean;
  currentEstimateCents: number | null;
  computedTotalCents: number | null;
  jobComplexity: 'SIMPLE' | 'COMPLEX' | null;
}

/**
 * Owner actions on a quote. The status lifecycle is otherwise automatic, so the
 * only manual status move here is Cancel. "Send estimate & propose time" does
 * both at once: it emails the estimate (→ ESTIMATE_SENT) and proposes a start
 * window the customer approves (→ SCHEDULED). Complex jobs reserve a 3-day span;
 * short jobs a single day.
 */
export function AdminActions({
  quoteId, allowedTransitions, canSendEstimate, canDelete,
  currentEstimateCents, computedTotalCents, jobComplexity,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [showEstimate, setShowEstimate] = useState(false);
  const [amount, setAmount] = useState(() => {
    const cents = currentEstimateCents ?? computedTotalCents ?? 0;
    return (cents / 100).toFixed(2);
  });
  const [message, setMessage] = useState('Here is your estimate. Let us know if you have any questions. Thank you for choosing our service!');
  const [proposedAt, setProposedAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canCancel = allowedTransitions.includes('CANCELED' as QuoteStatus);
  const isComplex = jobComplexity === 'COMPLEX';

  async function cancelQuote() {
    if (!window.confirm('Cancel this quote? This cannot be undone.')) return;
    setBusy('CANCELED');
    setError(null);
    try {
      await api('PATCH', `/api/admin/quotes/${quoteId}/status`, { status: 'CANCELED' });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
    } finally { setBusy(null); }
  }

  async function deleteQuote() {
    if (!window.confirm('Delete this quote? It will be removed from the quote list. This cannot be undone.')) return;
    setBusy('DELETE');
    setError(null);
    try {
      await api('DELETE', `/api/admin/quotes/${quoteId}`);
      router.push('/admin/quotes');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
      setBusy(null);
    }
  }

  async function sendEstimate() {
    setBusy('estimate');
    setError(null);
    try {
      const amountCents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents < 0) throw new Error('Enter a valid amount');
      if (!proposedAt) throw new Error('Pick a proposed start date and time');
      const start = new Date(proposedAt); // datetime-local is in business local time
      if (Number.isNaN(start.getTime())) throw new Error('Invalid date');
      // Short jobs run a single day; complex jobs reserve a 3-day span.
      const end = isComplex
        ? new Date(start.getTime() + 3 * 24 * 60 * 60_000)
        : new Date(start.getTime() + 2 * 60 * 60_000);

      // 1) Send the estimate (moves the quote to ESTIMATE_SENT).
      await api('POST', `/api/admin/quotes/${quoteId}/estimate`, { amountCents, message, validForDays: 14 });
      // 2) Propose the time window for the customer to approve.
      await api('POST', '/api/appointments/propose', {
        quoteRequestId: quoteId,
        windows: [{ startAt: start.toISOString(), endAt: end.toISOString() }],
      });
      setShowEstimate(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally { setBusy(null); }
  }

  return (
    <div className="card p-5">
      <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Actions</div>

      {canSendEstimate && (
        <>
          <button className="btn-primary w-full" onClick={() => setShowEstimate(true)}>
            {currentEstimateCents != null ? 'Resend estimate & time' : 'Send estimate & propose time'}
          </button>
          {showEstimate && (
            <div className="mt-4 space-y-3 pt-4 border-t" style={{ borderColor: 'var(--surface-200)' }}>
              <div>
                <label className="label">Amount ($)</label>
                <input className="input" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
                {computedTotalCents != null && (
                  <div className="help">Computed total: ${(computedTotalCents / 100).toFixed(2)}</div>
                )}
              </div>
              <div>
                <label className="label">Proposed start</label>
                <input className="input" type="datetime-local" value={proposedAt} onChange={e => setProposedAt(e.target.value)} />
                <div className="help">
                  Reserves {isComplex ? 'a 3-day span (complex job)' : 'a single day (short job)'}.
                  The customer approves this time or picks a conflict-free alternative.
                </div>
              </div>
              <div>
                <label className="label">Message to customer</label>
                <textarea className="input" rows={4} value={message} onChange={e => setMessage(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={sendEstimate} disabled={busy === 'estimate'}>
                  {busy === 'estimate' ? 'Sending…' : 'Send'}
                </button>
                <button className="btn-secondary" onClick={() => setShowEstimate(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {canCancel && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--surface-200)' }}>
          <button
            className="btn-secondary w-full text-sm py-2"
            style={{ color: '#b91c1c' }}
            disabled={busy === 'CANCELED'}
            onClick={cancelQuote}
          >
            {busy === 'CANCELED' ? 'Canceling…' : 'Cancel quote'}
          </button>
        </div>
      )}

      {canDelete && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--surface-200)' }}>
          <button
            className="btn-secondary w-full text-sm py-2"
            style={{ color: '#b91c1c', borderColor: '#fecaca' }}
            disabled={busy === 'DELETE'}
            onClick={deleteQuote}
          >
            {busy === 'DELETE' ? 'Deleting…' : 'Delete quote'}
          </button>
        </div>
      )}

      {error && <div className="mt-3 text-sm" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  );
}
