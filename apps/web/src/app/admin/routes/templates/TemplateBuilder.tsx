'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { StopsEditor, emptyStop, type StopForm } from '../StopsEditor';

export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

interface Staff { id: string; name: string }

const RECURRENCE_OPTIONS: Array<{ value: Recurrence; label: string }> = [
  { value: 'WEEKLY',   label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY',  label: 'Monthly' },
  { value: 'DAILY',    label: 'Daily' },
  { value: 'NONE',     label: 'No set schedule (run manually)' },
];

export interface TemplateInitial {
  id: string;
  name: string;
  recurrence: Recurrence;
  startDate: string | null;
  membershipIds: string[];
  stops: StopForm[];
}

/**
 * Builder for a route template (reusable blueprint). It captures the route's
 * stops, default crew, and recurrence schedule. A recurring template's stops are
 * cloned into a working route by the recurrence scheduler; a one-off can be
 * started from "Create a route → Start from a template". Reused with `initial` to edit.
 */
export function TemplateBuilder({ initial, staff }: { initial?: TemplateInitial; staff: Staff[] }): JSX.Element {
  const router = useRouter();
  const editing = !!initial;
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(initial?.name ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence ?? 'WEEKLY');
  const [startDate, setStartDate] = useState(initial?.startDate ? initial.startDate.slice(0, 10) : today);
  const [membershipIds, setMembershipIds] = useState<string[]>(initial?.membershipIds ?? []);
  const [stops, setStops] = useState<StopForm[]>(initial && initial.stops.length > 0 ? initial.stops : [emptyStop()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleStaff(id: string) {
    setMembershipIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) { setError('Give this template a name.'); return; }
    const cleanStops = stops
      .filter(s => s.label.trim())
      .map(s => ({
        label: s.label.trim(),
        addressLine: s.addressLine.trim() || undefined,
        city: s.city.trim() || undefined,
        state: s.state.trim() || undefined,
        postalCode: s.postalCode.trim() || undefined,
      }));
    if (cleanStops.length === 0) { setError('Add at least one stop (a label is required).'); return; }
    const body = {
      name: trimmed,
      recurrence,
      startDate: recurrence === 'NONE' ? null : startDate || null,
      membershipIds,
      stops: cleanStops,
    };
    setBusy(true);
    try {
      if (editing) {
        await api('PATCH', `/api/admin/route-templates/${initial!.id}`, body);
      } else {
        await api('POST', '/api/admin/route-templates', body);
      }
      router.push('/admin/routes/templates');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this route. Please try again.');
      setBusy(false);
    }
  }

  const recurring = recurrence !== 'NONE';

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Template name</label>
          <input className="input" placeholder="e.g. Mon–Fri — East side" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Repeats</label>
            <select className="input" value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}>
              {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {recurring && (
            <div>
              <label className="label">Starts on</label>
              <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
          )}
        </div>
        {recurring ? (
          <p className="text-xs" style={{ color: 'var(--ink-500)' }}>
            Routes are created automatically from this date onward (the cadence repeats from the start date),
            and appear on the dashboard as planned. It keeps running until you Stop it.
          </p>
        ) : (
          <p className="text-xs" style={{ color: 'var(--ink-500)' }}>
            No automatic schedule — this route is only created when you Run it.
          </p>
        )}

        <div>
          <label className="label">Crew <span style={{ color: 'var(--ink-400)' }}>(assigned automatically each time it runs)</span></label>
          {staff.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--ink-500)' }}>No staff available — add staff on the Team page first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staff.map(s => {
                const on = membershipIds.includes(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => toggleStaff(s.id)}
                    aria-pressed={on}
                    className="text-sm px-3 py-1.5 rounded-full border transition-colors"
                    style={on
                      ? { background: 'var(--brand-500)', color: 'var(--on-brand)', borderColor: 'var(--brand-500)' }
                      : { background: 'var(--surface-0)', color: 'var(--ink-700)', borderColor: 'var(--surface-200)' }}
                  >
                    {on ? '✓ ' : ''}{s.name}
                  </button>
                );
              })}
            </div>
          )}
          {membershipIds.length === 0 && (
            <p className="text-xs mt-2" style={{ color: '#b45309' }}>
              No crew assigned — {recurring ? 'this route won’t auto-create until you add crew.' : 'add crew so it can be run.'}
            </p>
          )}
        </div>
      </div>

      <StopsEditor stops={stops} onChange={setStops} />

      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>{error}</div>
      )}

      <div className="flex gap-3">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save route'}
        </button>
      </div>
    </form>
  );
}
