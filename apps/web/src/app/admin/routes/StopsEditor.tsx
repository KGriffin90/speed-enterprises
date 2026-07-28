'use client';

import type { JSX } from 'react';
import { useState } from 'react';

export interface StopForm { label: string; addressLine: string; city: string; state: string; postalCode: string }

export const emptyStop = (): StopForm => ({ label: '', addressLine: '', city: '', state: '', postalCode: '' });

// Parse a pasted block of addresses (blank-line-separated) into stops. Each block:
//   <Label>- <street>          (label before the first dash; street after)
//   [Unit / secondary line]    (optional)
//   City, ST  ZIP
//   United States              (country line — ignored)
const CITY_STATE_ZIP = /^(.+?),\s*([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?$/;
const COUNTRY_LINE = /^(united states(?: of america)?|usa|u\.s\.a?\.?)$/i;

export function parseAddressBlock(text: string): StopForm[] {
  const stops: StopForm[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    let lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (COUNTRY_LINE.test(lines[lines.length - 1]!)) lines = lines.slice(0, -1);
    if (lines.length === 0) continue;

    // Locate the "City, ST ZIP" line (search from the bottom).
    let cityIdx = -1, city = '', state = '', postalCode = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i]!.match(CITY_STATE_ZIP);
      if (m) { cityIdx = i; city = m[1]!.trim(); state = m[2]!.toUpperCase(); postalCode = m[3]!; break; }
    }

    // First line: "Label- street" (split on the first dash); no dash → all street.
    const first = lines[0]!;
    const dash = first.indexOf('-');
    const label0 = dash >= 0 ? first.slice(0, dash).trim() : '';
    const street0 = dash >= 0 ? first.slice(dash + 1).trim() : first.trim();

    // Lines between the first line and the city line are extra street/unit lines.
    const end = cityIdx >= 0 ? cityIdx : lines.length;
    const extra = lines.slice(1, end);
    const addressLine = [street0, ...extra].filter(Boolean).join(', ');
    const label = label0 || city || addressLine;

    if (!addressLine && !city) continue;
    stops.push({ label, addressLine, city, state, postalCode });
  }
  return stops;
}

/**
 * Shared, controlled stop-list editor used by both the route builder (one-time
 * routes) and the saved-route template builder. Owns the "Stops" section UI:
 * per-stop fields, reordering, remove, "+ Add stop", and the bulk paste parser.
 */
export function StopsEditor({
  stops,
  onChange,
  disabled = false,
}: {
  stops: StopForm[];
  onChange: (stops: StopForm[]) => void;
  disabled?: boolean;
}): JSX.Element {
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  function setStop(i: number, patch: Partial<StopForm>) {
    onChange(stops.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }
  function addStop() { onChange([...stops, emptyStop()]); }
  function removeStop(i: number) { if (stops.length > 1) onChange(stops.filter((_, idx) => idx !== i)); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  }

  // Parse the pasted block and append the stops (dropping any blank stops).
  function addBulkStops() {
    const parsed = parseAddressBlock(bulkText);
    if (parsed.length === 0) {
      setBulkMsg('Couldn’t find any addresses — separate each one with a blank line.');
      return;
    }
    const kept = stops.filter(s => s.label.trim() || s.addressLine.trim() || s.city.trim());
    onChange([...kept, ...parsed]);
    setShowBulk(false);
    setBulkText('');
    setBulkMsg(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold" style={{ color: 'var(--ink-900)' }}>Stops</h2>
        <div className="flex items-center gap-3">
          {!disabled && (
            <button type="button" onClick={() => { setBulkMsg(null); setShowBulk(v => !v); }} className="link text-xs">
              {showBulk ? '× Cancel' : '+ Paste a list'}
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--ink-500)' }}>{stops.length} stop{stops.length === 1 ? '' : 's'} — visited in order</span>
        </div>
      </div>

      {showBulk && !disabled && (
        <div className="card p-4 space-y-3">
          <div>
            <label className="label">Paste a list of addresses</label>
            <textarea
              className="input font-mono text-xs"
              rows={8}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder={'First stop- 100 Example St\nSalt Lake City, UT  84101\nUnited States\n\nSecond stop- 250 Sample Ave\nSuite 4\nProvo, UT  84601\nUnited States'}
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--ink-500)' }}>
              One address per block, separated by a blank line. Each block: an optional “Label- street” line, an optional unit line, then “City, ST ZIP”. Each becomes a separate stop.
            </p>
          </div>
          {bulkMsg && <div className="text-xs" style={{ color: '#b91c1c' }}>{bulkMsg}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary text-sm py-2 px-4" onClick={addBulkStops}>Add stops</button>
            <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => { setShowBulk(false); setBulkMsg(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {stops.map((s, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold" style={{ color: 'var(--brand-600)' }}>Stop {i + 1}</span>
            {!disabled && (
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="link disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === stops.length - 1} className="link disabled:opacity-30">↓</button>
                <button type="button" onClick={() => removeStop(i)} disabled={stops.length === 1} className="link disabled:opacity-30" style={{ color: '#b91c1c' }}>Remove</button>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <input className="input" placeholder="Job label (e.g. Smith residence — gutter install)" value={s.label} disabled={disabled} onChange={e => setStop(i, { label: e.target.value })} />
            <input className="input" placeholder="Street address" value={s.addressLine} disabled={disabled} onChange={e => setStop(i, { addressLine: e.target.value })} />
            <div className="grid grid-cols-3 gap-3">
              <input className="input" placeholder="City" value={s.city} disabled={disabled} onChange={e => setStop(i, { city: e.target.value })} />
              <input className="input" placeholder="State" maxLength={2} value={s.state} disabled={disabled} onChange={e => setStop(i, { state: e.target.value })} />
              <input className="input" placeholder="ZIP" value={s.postalCode} disabled={disabled} onChange={e => setStop(i, { postalCode: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      {!disabled && <button type="button" onClick={addStop} className="btn-secondary w-full">+ Add stop</button>}
    </div>
  );
}
