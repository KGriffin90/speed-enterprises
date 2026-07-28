'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

type Complexity = 'SIMPLE' | 'COMPLEX' | null;

// Professional default the owner can edit. Shown to the customer on COMPLEX jobs.
const DEFAULT_COMPLEX_NOTE =
  'This is a larger, multi-day project. Because of its scope, our team will review the ' +
  'details and coordinate the schedule with you across more than one visit. We’ll propose ' +
  'a few time windows for you to choose from once the estimate is accepted.';

/**
 * Owner-only: classify a received quote as a short job or a complex (multi-day)
 * job. SIMPLE jobs use the normal self-book / short-window scheduling; COMPLEX
 * jobs carry a customer-facing note explaining the multi-day plan. Saved on the
 * quote so both the owner and the customer see it through the rest of the flow.
 */
export function ComplexityPanel({ quoteId, initialComplexity, initialNote, canEdit }: {
  quoteId: string;
  initialComplexity: Complexity;
  initialNote: string | null;
  canEdit: boolean;
}): JSX.Element {
  const router = useRouter();
  const [complexity, setComplexity] = useState<Complexity>(initialComplexity);
  const [note, setNote] = useState(initialNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: Complexity) {
    if (!canEdit) return;
    setBusy(true); setError(null); setSaved(false);
    // COMPLEX keeps/sets the customer note (default if blank); SIMPLE clears it.
    const outNote = next === 'COMPLEX' ? (note.trim() || DEFAULT_COMPLEX_NOTE) : null;
    try {
      await api('PATCH', `/api/admin/quotes/${quoteId}`, { jobComplexity: next, complexityNote: outNote });
      setComplexity(next);
      setNote(outNote ?? '');
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.');
    } finally { setBusy(false); }
  }

  async function saveNote() {
    if (!canEdit) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await api('PATCH', `/api/admin/quotes/${quoteId}`, { complexityNote: note.trim() || DEFAULT_COMPLEX_NOTE });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the note.');
    } finally { setBusy(false); }
  }

  const pill = (kind: 'SIMPLE' | 'COMPLEX', label: string, sub: string) => {
    const on = complexity === kind;
    return (
      <button
        type="button"
        disabled={!canEdit || busy}
        onClick={() => save(kind)}
        className="flex-1 text-left rounded-xl border p-3 transition-colors disabled:opacity-60"
        style={on
          ? { borderColor: 'var(--brand-500)', background: 'color-mix(in srgb, var(--brand-500) 8%, var(--surface-0))' }
          : { borderColor: 'var(--surface-200)', background: 'var(--surface-0)' }}
      >
        <div className="text-sm font-bold" style={{ color: on ? 'var(--brand-700)' : 'var(--ink-900)' }}>
          {on ? '✓ ' : ''}{label}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>{sub}</div>
      </button>
    );
  };

  return (
    <div className="card p-5">
      <div className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>Job complexity</div>
      <p className="text-sm mb-3" style={{ color: 'var(--ink-500)' }}>
        Review the request and classify it. Short jobs schedule normally; complex jobs add a
        multi-day note for the customer.
      </p>

      <div className="flex gap-2">
        {pill('SIMPLE', 'Short job', 'Self-book / short windows')}
        {pill('COMPLEX', 'Complex job', 'Multi-day, coordinated plan')}
      </div>

      {complexity === 'COMPLEX' && (
        <div className="mt-4">
          <label className="label">Note to customer</label>
          <textarea
            className="input"
            rows={4}
            value={note}
            disabled={!canEdit || busy}
            placeholder={DEFAULT_COMPLEX_NOTE}
            onChange={e => setNote(e.target.value)}
          />
          <p className="text-xs mt-1.5" style={{ color: 'var(--ink-500)' }}>
            Shown to the customer on their quote. Explain why it spans more than a day and what to expect.
          </p>
          {canEdit && (
            <button className="btn-secondary text-sm mt-2" onClick={saveNote} disabled={busy}>
              {busy ? 'Saving…' : 'Save note'}
            </button>
          )}
        </div>
      )}

      {error && <div className="text-sm mt-2" style={{ color: '#dc2626' }}>{error}</div>}
      {saved && !error && <div className="text-xs mt-2" style={{ color: '#059669' }}>Saved.</div>}
    </div>
  );
}
