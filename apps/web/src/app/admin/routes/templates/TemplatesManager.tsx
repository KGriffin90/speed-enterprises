'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';

export interface Template {
  id: string;
  name: string;
  recurrence?: 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  startDate?: string | null;
  createdAt: string;
  _count?: { stops: number };
  assignees?: Array<{ membershipId: string }>;
}

interface Staff { id: string; name: string }

const RECURRENCE_LABEL: Record<string, string> = {
  DAILY: 'Daily', WEEKLY: 'Weekly', BIWEEKLY: 'Every 2 weeks', MONTHLY: 'Monthly',
};

type SortKey = 'newest' | 'az';
const SORT_KEY = 'route-templates-sort';

/**
 * Templates = reusable route blueprints. Pure CRUD — there is no "Run"/"Stop"
 * here: recurring templates auto-fill the Routes dashboard, and one-off routes
 * are started from "Create a route → Start from a template".
 */
export function TemplatesManager({ initial, staff }: { initial: Template[]; staff: Staff[] }): JSX.Element {
  const [templates, setTemplates] = useState<Template[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sort preference (newest-created first, or A–Z by name), remembered locally.
  const [sort, setSort] = useState<SortKey>('newest');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (saved === 'newest' || saved === 'az') setSort(saved);
    } catch { /* noop */ }
  }, []);
  function changeSort(next: SortKey) {
    setSort(next);
    try { localStorage.setItem(SORT_KEY, next); } catch { /* noop */ }
  }
  const sorted = useMemo(() => {
    const list = [...templates];
    if (sort === 'az') {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [templates, sort]);

  const staffName = useMemo(() => new Map(staff.map(s => [s.id, s.name])), [staff]);

  async function remove(t: Template) {
    if (!window.confirm(`Delete the template “${t.name}”? Routes already created from it are not affected.`)) return;
    setBusy(t.id); setError(null);
    try {
      await api('DELETE', `/api/admin/route-templates/${t.id}`);
      setTemplates(ts => ts.filter(x => x.id !== t.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the template.');
    } finally { setBusy(null); }
  }

  if (templates.length === 0) {
    return (
      <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-500)' }}>
        No templates yet. Create one with{' '}
        <Link href="/admin/routes/templates/new" className="link">+ New template</Link>. Recurring
        templates fill the Routes dashboard automatically; one-off templates can be started from
        “Create a route”.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3 mb-3">
        {templates.length > 1 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <label htmlFor="tpl-sort" className="text-xs" style={{ color: 'var(--ink-500)' }}>Sort</label>
            <select
              id="tpl-sort"
              className="input w-44 py-1.5 text-sm"
              value={sort}
              onChange={e => changeSort(e.target.value as SortKey)}
            >
              <option value="newest">Newest first</option>
              <option value="az">Name (A–Z)</option>
            </select>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {error && (
          <div className="rounded-xl p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>{error}</div>
        )}
        {sorted.map(t => (
          <div key={t.id} className="card p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-bold truncate" style={{ color: 'var(--ink-900)' }}>{t.name}</div>
                {t.recurrence && t.recurrence !== 'NONE' && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-0))', color: 'var(--brand-700)' }}
                  >
                    ↻ {RECURRENCE_LABEL[t.recurrence] ?? t.recurrence}
                  </span>
                )}
              </div>
              <div className="text-xs" style={{ color: 'var(--ink-500)' }}>
                {t._count?.stops ?? 0} stop{(t._count?.stops ?? 0) === 1 ? '' : 's'} · saved {new Date(t.createdAt).toLocaleDateString()}
              </div>
              <div className="text-xs mt-0.5">
                {(() => {
                  const crew = (t.assignees ?? []).map(a => staffName.get(a.membershipId)).filter(Boolean);
                  if (t.recurrence && t.recurrence !== 'NONE' && crew.length === 0) {
                    return <span style={{ color: '#b45309' }}>No crew — won’t auto-run</span>;
                  }
                  return crew.length === 0
                    ? <span style={{ color: 'var(--ink-500)' }}>No default crew</span>
                    : <span style={{ color: 'var(--ink-500)' }}>Crew: {crew.join(', ')}</span>;
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 text-sm">
              <Link href={`/admin/routes/templates/${t.id}/edit`} className="btn-secondary text-sm py-1.5 px-3">Edit</Link>
              <button type="button" className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-40" style={{ color: '#b91c1c' }} disabled={busy === t.id} onClick={() => remove(t)}>
                {busy === t.id ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
