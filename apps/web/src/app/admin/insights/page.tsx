'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';

interface InsightsData {
  summary: string;
  bullets: string[];
}

export default function InsightsPage() {
  const [data, setData]   = useState<InsightsData | null>(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const res = await api<InsightsData>('GET', '/api/ai/insights');
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load insights');
    } finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-3xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Business insights</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>Analysis of your last 30 days. Requires AI → Business insights enabled in your Settings.</p>
        </div>
        <button className="btn-secondary text-sm py-2 px-3" onClick={load} disabled={busy}>
          {busy ? 'Analyzing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        error.includes('not enabled') ? (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">🤖</div>
            <h2 className="font-semibold mb-2" style={{ color: 'var(--ink-900)' }}>AI Insights not enabled</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--ink-500)' }}>
              Turn on <strong>Business insights</strong> under Settings → AI assistants to use this feature.
            </p>
            <a href="/admin/settings" className="btn-primary text-sm">Go to Settings</a>
          </div>
        ) : (
          <div className="card p-5" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>
            {error}
          </div>
        )
      )}

      {busy && !data && (
        <div className="card p-10 text-center text-sm animate-pulse" style={{ color: 'var(--ink-500)' }}>
          Analyzing your business data…
        </div>
      )}

      {data && (
        <div className="space-y-5">
          <div className="card p-6">
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Summary</div>
            <p className="text-base leading-relaxed" style={{ color: 'var(--ink-900)' }}>{data.summary}</p>
          </div>

          {data.bullets.length > 0 && (
            <div className="card p-6">
              <div className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--ink-500)' }}>Key insights</div>
              <ul className="space-y-3">
                {data.bullets.map((b, i) => (
                  <li key={i} className="flex gap-3 text-sm" style={{ color: 'var(--ink-800)' }}>
                    <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>{i + 1}</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs" style={{ color: 'var(--ink-400)' }}>
            Based on last 30 days of quote data · Refresh to re-analyze data with latest quotes 
          </p>
        </div>
      )}
    </div>
  );
}
