'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

export function CustomerActions({ quoteId, status, accepted, validUntil }: { quoteId: string; status: string; accepted: boolean; validUntil: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'accept' | 'decline'>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the pre-approval step lives here. Once approved, the time-approval step
  // (BookingSection) takes over while the quote is still ESTIMATE_SENT.
  if (status !== 'ESTIMATE_SENT' || accepted) return null;
  const expired = !!validUntil && new Date(validUntil) < new Date();

  async function accept() {
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/quotes/${quoteId}/accept`, { note: note || undefined });
      router.refresh();
      setMode(null); setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  async function decline() {
    if (!reason.trim()) { setError('Please share a quick reason so the team can follow up.'); return; }
    setBusy(true); setError(null);
    try {
      await api('POST', `/api/quotes/${quoteId}/decline`, { reason });
      router.refresh();
      setMode(null); setReason('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="card p-5">
      {expired ? (
        <p className="text-sm" style={{ color: '#dc2626' }}>
          This estimate has expired. Contact us to refresh it.
        </p>
      ) : !mode ? (
        <>
          <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Review your estimate</div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => setMode('accept')}>Approve estimate</button>
            <button className="btn-secondary" onClick={() => setMode('decline')}>Decline</button>
          </div>
          {validUntil && (
            <div className="help mt-3">Valid until {new Date(validUntil).toLocaleDateString()}.</div>
          )}
        </>
      ) : mode === 'accept' ? (
        <>
          <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Approve this estimate</div>
          <div className="space-y-3">
            <textarea className="input" rows={3} placeholder="Optional message for the team (preferred times, gate code, etc.)" value={note} onChange={e => setNote(e.target.value)} />
            {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}
            <p className="help">Next you'll approve a time for the job.</p>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={accept} disabled={busy}>{busy ? 'Approving…' : 'Approve estimate'}</button>
              <button className="btn-secondary" onClick={() => setMode(null)}>Cancel</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Decline estimate</div>
          <div className="space-y-3">
            <textarea className="input" rows={3} required placeholder="Reason — helps us improve" value={reason} onChange={e => setReason(e.target.value)} />
            {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={decline} disabled={busy}>{busy ? 'Submitting…' : 'Decline'}</button>
              <button className="btn-secondary" onClick={() => setMode(null)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
