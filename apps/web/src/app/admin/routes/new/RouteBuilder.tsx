'use client';

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { StopsEditor, emptyStop, type StopForm } from '../StopsEditor';

// In-progress new routes are auto-saved here so closing/leaving the builder
// doesn't lose work; restored on return, cleared once the route is created.
const DRAFT_KEY = 'route-builder-draft';

export interface RouteInitial {
  id: string;
  name: string | null;
  plannedForDate: string | null;
  membershipIds: string[];
  stops: StopForm[];
  /** When the route has already started, crew + stops are locked (only name/date editable). */
  lockStructure: boolean;
}

/**
 * Builder for a one-time route — a specific list of jobs for one day, assigned
 * to staff. Can be started blank or prefilled from a saved template (reusable
 * weekly/monthly blueprints are managed under /admin/routes/templates). Also
 * reused, with `initial`, to edit an existing route.
 */
export function RouteBuilder({ staff, initial, templates = [] }: { staff: Array<{ id: string; name: string }>; initial?: RouteInitial; templates?: Array<{ id: string; name: string }> }): JSX.Element {
  const router = useRouter();
  const editing = !!initial;
  const lockStructure = initial?.lockStructure ?? false;
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(initial?.name ?? '');
  const [membershipIds, setMembershipIds] = useState<string[]>(
    initial ? initial.membershipIds : staff[0] ? [staff[0].id] : [],
  );
  const [date, setDate] = useState(initial?.plannedForDate ? initial.plannedForDate.slice(0, 10) : today);
  const [stops, setStops] = useState<StopForm[]>(initial && initial.stops.length > 0 ? initial.stops : [emptyStop()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unsaved-changes guard + local draft. New-route mode only — edits to an
  // existing route are already persisted, so there's nothing to draft.
  const [dirty, setDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null); // pending nav target → shows the modal
  const [draftRestored, setDraftRestored] = useState(false);
  const restoredOnce = useRef(false);

  function toggleStaff(id: string) {
    setDirty(true);
    setMembershipIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }
  function changeStops(next: StopForm[]) { setDirty(true); setStops(next); }

  // Prefill the builder from a saved template (one-time route from a blueprint).
  async function applyTemplate(templateId: string) {
    if (!templateId) return;
    setError(null); setBusy(true);
    try {
      const tpl = await api<{
        name: string;
        assignees: Array<{ membershipId: string }>;
        stops: Array<{ label: string; addressLine: string | null; city: string | null; state: string | null; postalCode: string | null }>;
      }>('GET', `/api/admin/route-templates/${templateId}`);
      setName(prev => prev.trim() ? prev : tpl.name);
      if (tpl.assignees?.length) setMembershipIds(tpl.assignees.map(a => a.membershipId));
      const tplStops = (tpl.stops ?? []).map(s => ({
        label: s.label ?? '', addressLine: s.addressLine ?? '', city: s.city ?? '',
        state: s.state ?? '', postalCode: s.postalCode ?? '',
      }));
      if (tplStops.length) setStops(tplStops);
      setDirty(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that template.');
    } finally { setBusy(false); }
  }

  // ── Draft persistence + leave guard (new-route mode) ──────────────────────
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ } }

  // Restore a saved draft once, on first mount.
  useEffect(() => {
    if (editing || restoredOnce.current) return;
    restoredOnce.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { name?: string; membershipIds?: string[]; date?: string; stops?: StopForm[] };
      const hasContent = (d.stops ?? []).some(s => s?.label?.trim() || s?.addressLine?.trim()) || !!d.name?.trim();
      if (!hasContent) { clearDraft(); return; }
      if (d.name) setName(d.name);
      if (Array.isArray(d.membershipIds) && d.membershipIds.length) setMembershipIds(d.membershipIds);
      if (d.date) setDate(d.date);
      if (Array.isArray(d.stops) && d.stops.length) setStops(d.stops);
      setDraftRestored(true);
    } catch { /* corrupt draft — ignore */ }
  }, [editing]);

  // Auto-save the in-progress route whenever it changes.
  useEffect(() => {
    if (editing || !dirty) return;
    const hasContent = stops.some(s => s.label.trim() || s.addressLine.trim()) || name.trim();
    try {
      if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, membershipIds, date, stops }));
      else clearDraft();
    } catch { /* private mode / quota — best-effort */ }
  }, [editing, dirty, name, membershipIds, date, stops]);

  // Native "Leave site?" prompt for hard navigations (refresh, tab close).
  useEffect(() => {
    if (editing) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editing, dirty]);

  // In-app back link → confirm before leaving when there are unsaved changes.
  function requestLeave(href: string) {
    if (dirty) setLeaveTo(href);
    else router.push(href);
  }
  function leaveKeepingDraft() {
    const href = leaveTo ?? '/admin/routes';
    setDirty(false); setLeaveTo(null);
    router.push(href);
  }
  function leaveDiscarding() {
    const href = leaveTo ?? '/admin/routes';
    clearDraft();
    setDirty(false); setLeaveTo(null);
    router.push(href);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanStops = stops
      .filter(s => s.label.trim())
      .map(s => ({
        label: s.label.trim(),
        addressLine: s.addressLine.trim() || undefined,
        city: s.city.trim() || undefined,
        state: s.state.trim() || undefined,
        postalCode: s.postalCode.trim() || undefined,
      }));
    if (!lockStructure && membershipIds.length === 0) { setError('Assign at least one staff member to this route.'); return; }
    if (!lockStructure && cleanStops.length === 0) { setError('Add at least one stop (a label is required).'); return; }
    setBusy(true);
    try {
      if (editing) {
        // Name/date always go; crew + stops only when the route is still editable.
        await api('PATCH', `/api/admin/routes/${initial!.id}`, {
          name: name.trim() || undefined,
          plannedForDate: date || undefined,
          ...(lockStructure ? {} : { membershipIds, stops: cleanStops }),
        });
        router.push(`/admin/routes/${initial!.id}`);
        router.refresh();
      } else {
        const created = await api<{ id: string }>('POST', '/api/admin/routes', {
          name: name.trim() || undefined,
          membershipIds,
          plannedForDate: date || undefined,
          stops: cleanStops,
        });
        clearDraft(); setDirty(false);
        router.push(`/admin/routes/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${editing ? 'save' : 'create'} the route. Please try again.`);
      setBusy(false);
    }
  }

  return (
    <>
      {/* Guarded back link (new-route mode) — warns before discarding unsaved work. */}
      {!editing && (
        <button type="button" onClick={() => requestLeave('/admin/routes')} className="link text-sm">← Routes</button>
      )}

    <form onSubmit={submit} className="space-y-5">
      {!editing && draftRestored && (
        <div className="rounded-xl p-3 text-sm flex items-center justify-between gap-3" style={{ background: 'var(--surface-100)', color: 'var(--ink-700)' }}>
          <span>Restored your unsaved route from last time.</span>
          <button
            type="button"
            className="link text-xs flex-shrink-0"
            onClick={() => {
              clearDraft();
              setName(''); setMembershipIds(staff[0] ? [staff[0].id] : []); setDate(today); setStops([emptyStop()]);
              setDirty(false); setDraftRestored(false);
            }}
          >
            Start fresh
          </button>
        </div>
      )}

      {lockStructure && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
          This route has already started, so crew and stops are locked to protect the live check-in timing. You can still rename it or change its date.
        </div>
      )}

      {!editing && templates.length > 0 && (
        <div className="card p-5">
          <label className="label">Start from a template <span style={{ color: 'var(--ink-400)' }}>(optional)</span></label>
          <select
            className="input"
            defaultValue=""
            disabled={busy}
            onChange={e => { const id = e.target.value; e.target.value = ''; applyTemplate(id); }}
          >
            <option value="">— Blank route —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="text-xs mt-2" style={{ color: 'var(--ink-500)' }}>
            Loads the template&apos;s stops and crew below — tweak anything, then create the route for the date you choose.
          </p>
        </div>
      )}

      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Route name <span style={{ color: 'var(--ink-400)' }}>(optional)</span></label>
          <input className="input" placeholder="e.g. Tuesday — East side" value={name} onChange={e => { setName(e.target.value); setDirty(true); }} />
        </div>
        <div>
          <label className="label">Assign to <span style={{ color: 'var(--ink-400)' }}>(one or more — tap to toggle)</span></label>
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
                    disabled={lockStructure}
                    className="text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          {membershipIds.length > 1 && (
            <p className="text-xs mt-2" style={{ color: 'var(--ink-500)' }}>
              {membershipIds.length} employees assigned — any of them can work this route and check stops in.
            </p>
          )}
        </div>
        <div className="max-w-[12rem]">
          <label className="label">Date</label>
          <input className="input" type="date" value={date} onChange={e => { setDate(e.target.value); setDirty(true); }} />
        </div>
      </div>

      <StopsEditor stops={stops} onChange={changeStops} disabled={lockStructure} />

      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>{error}</div>
      )}

      <div className="flex gap-3">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create route'}
        </button>
      </div>
    </form>

    {/* Leave confirmation — only when there are unsaved changes. */}
    {leaveTo !== null && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(15, 23, 42, 0.55)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-route-title"
        onClick={() => setLeaveTo(null)}
      >
        <div className="card p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
          <h3 id="leave-route-title" className="text-lg font-bold" style={{ color: 'var(--ink-900)' }}>
            Leave without finishing?
          </h3>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-500)' }}>
            This route hasn&apos;t been created yet. We can keep it as a draft and bring it back the
            next time you open the route builder.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2">
            <button type="button" className="btn-primary flex-1 py-2.5" onClick={leaveKeepingDraft}>Save draft &amp; leave</button>
            <button type="button" className="btn-secondary flex-1 py-2.5" onClick={leaveDiscarding}>Discard &amp; leave</button>
            <button type="button" className="btn-secondary py-2.5 px-4" onClick={() => setLeaveTo(null)}>Keep editing</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
