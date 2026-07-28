'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';

interface Entry {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  breakMinutes: number;
  notesByAdmin: string | null;
}

interface Props {
  entry: Entry;
  onClose: () => void;
  onSaved: () => void;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditEntryModal({ entry, onClose, onSaved }: Props) {
  const [inAt,  setInAt]  = useState(toDatetimeLocal(entry.clockedInAt));
  const [outAt, setOutAt] = useState(entry.clockedOutAt ? toDatetimeLocal(entry.clockedOutAt) : '');
  const [brk,   setBrk]   = useState(entry.breakMinutes);
  const [note,  setNote]  = useState(entry.notesByAdmin ?? '');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('PATCH', `/api/admin/time/${entry.id}`, {
        clockedInAt:  new Date(inAt).toISOString(),
        clockedOutAt: outAt ? new Date(outAt).toISOString() : undefined,
        breakMinutes: brk,
        notesByAdmin: note || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <form
        className="card p-6 w-full max-w-md space-y-4"
        onClick={e => e.stopPropagation()}
        onSubmit={save}
      >
        <div className="font-semibold text-lg" style={{ color: 'var(--ink-900)' }}>Edit time entry</div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Clock in</label>
            <input className="input" type="datetime-local" value={inAt} onChange={e => setInAt(e.target.value)} required />
          </div>
          <div>
            <label className="label">Clock out</label>
            <input className="input" type="datetime-local" value={outAt} onChange={e => setOutAt(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Break (minutes)</label>
          <input className="input w-28" type="number" min={0} step={5} value={brk} onChange={e => setBrk(parseInt(e.target.value) || 0)} />
        </div>

        <div>
          <label className="label">Admin note</label>
          <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for edit…" />
        </div>

        {error && <div className="text-xs" style={{ color: '#dc2626' }}>{error}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
