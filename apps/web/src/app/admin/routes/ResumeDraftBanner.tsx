'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// Must match DRAFT_KEY in admin/routes/new/RouteBuilder.tsx — the in-progress
// new route is auto-saved there; this surfaces it on the Routes list so the
// owner can resume (or discard) without opening the builder.
const DRAFT_KEY = 'route-builder-draft';

interface Draft { name?: string; stops?: Array<{ label?: string; addressLine?: string }> }

export function ResumeDraftBanner() {
  const [draft, setDraft] = useState<{ name: string; stopCount: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      const stops = (d.stops ?? []).filter(s => s?.label?.trim() || s?.addressLine?.trim());
      if (stops.length === 0 && !d.name?.trim()) { localStorage.removeItem(DRAFT_KEY); return; }
      setDraft({ name: d.name?.trim() || 'Untitled route', stopCount: stops.length });
    } catch { /* corrupt draft — ignore */ }
  }, []);

  if (!draft) return null;

  function discard() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
    setDraft(null);
  }

  return (
    <div
      className="card p-4 mb-5 flex items-center justify-between gap-4"
      style={{ borderColor: 'var(--brand-400)', background: 'color-mix(in srgb, var(--brand-500) 6%, var(--surface-0))' }}
    >
      <div className="min-w-0">
        <div className="font-semibold text-sm" style={{ color: 'var(--ink-900)' }}>↩ Unsaved route draft</div>
        <div className="text-xs truncate" style={{ color: 'var(--ink-500)' }}>
          “{draft.name}” · {draft.stopCount} stop{draft.stopCount === 1 ? '' : 's'} — not yet created
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 text-sm">
        <Link href="/admin/routes/new" className="link font-semibold">Resume →</Link>
        <button type="button" className="link" style={{ color: '#b91c1c' }} onClick={discard}>Discard</button>
      </div>
    </div>
  );
}
