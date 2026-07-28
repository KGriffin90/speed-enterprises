'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

interface Initial { subject: string | null; body: string; enabled: boolean; isCustomized: boolean }

const PLACEHOLDERS: Array<{ key: string; desc: string }> = [
  { key: 'businessName',      desc: "Your business's display name" },
  { key: 'businessEmail',     desc: 'Your public email' },
  { key: 'businessPhone',     desc: 'Your public phone' },
  { key: 'customerFirstName', desc: 'Customer first name' },
  { key: 'customerName',      desc: 'Customer full name' },
  { key: 'customerEmail',     desc: 'Customer email' },
  { key: 'customerPhone',     desc: 'Customer phone' },
  { key: 'serviceName',       desc: 'Name of the service' },
  { key: 'address',           desc: 'Service address' },
  { key: 'quoteId',           desc: 'Internal quote id' },
  { key: 'quoteUrl',          desc: 'Link to the quote detail page' },
  { key: 'quoteAmount',       desc: 'Estimate amount, formatted' },
  { key: 'estimateMessage',   desc: 'Admin-written message on estimate send' },
  { key: 'scheduledAt',       desc: 'ISO scheduled date/time' },
  { key: 'customerNotes',     desc: "Customer's notes on the quote" },
  { key: 'invoiceUrl',        desc: 'Link to pay the invoice' },
  { key: 'reviewUrl',         desc: 'Link to your review profile' },
];

export function TemplateEditor({ kind, channel, initial }: { kind: string; channel: string; initial: Initial }) {
  const router = useRouter();
  const [subject, setSubject] = useState(initial.subject ?? '');
  const [body,    setBody]    = useState(initial.body);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api('PATCH', `/api/me/automations/${encodeURIComponent(kind)}/${encodeURIComponent(channel)}`, {
        subject: channel === 'EMAIL' ? subject : undefined,
        body, enabled,
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  async function resetDefault() {
    if (!confirm('Reset this template to the platform default? Your edits will be lost.')) return;
    setBusy(true); setError(null);
    try {
      await api('DELETE', `/api/me/automations/${encodeURIComponent(kind)}/${encodeURIComponent(channel)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reset failed');
    } finally { setBusy(false); }
  }

  async function doPreview() {
    setPreviewing(true); setError(null);
    try {
      const r = await api<{ subject: string; html: string; text: string }>(
        'POST', `/api/me/automations/${encodeURIComponent(kind)}/${encodeURIComponent(channel)}/preview`,
        { subject: channel === 'EMAIL' ? subject : undefined, body },
      );
      setPreview(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Preview failed');
    } finally { setPreviewing(false); }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-700)' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Send this message
        </label>
        {channel === 'EMAIL' && (
          <div>
            <label className="label">Subject</label>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">Body</label>
          <textarea className="input font-mono text-sm" rows={16} value={body} onChange={e => setBody(e.target.value)} />
          <div className="help">Markdown is supported. Use {'{{placeholder}}'} for dynamic values.</div>
        </div>

        {error && <div className="card p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>{error}</div>}
        {saved && <div className="text-sm" style={{ color: '#059669' }}>Saved.</div>}

        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn-secondary" onClick={doPreview} disabled={previewing}>{previewing ? 'Rendering…' : 'Preview'}</button>
          {initial.isCustomized && (
            <button className="btn-secondary" onClick={resetDefault} disabled={busy} style={{ color: '#991b1b' }}>Reset to default</button>
          )}
        </div>

        {preview && channel === 'EMAIL' && (
          <div className="card p-0 mt-4 overflow-hidden">
            <div className="px-4 py-2 text-xs" style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
              Preview · subject: <strong style={{ color: 'var(--ink-900)' }}>{preview.subject}</strong>
            </div>
            <iframe srcDoc={preview.html} className="w-full" style={{ height: 480, border: 0 }} />
          </div>
        )}
        {preview && channel !== 'EMAIL' && (
          <pre className="card p-4 whitespace-pre-wrap text-sm" style={{ color: 'var(--ink-900)' }}>{preview.text}</pre>
        )}
      </div>

      <aside className="card p-4 lg:max-h-[600px] lg:overflow-auto">
        <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Placeholders</div>
        <ul className="text-xs space-y-2">
          {PLACEHOLDERS.map(p => (
            <li key={p.key}>
              <code style={{ color: 'var(--brand-700)' }}>{`{{${p.key}}}`}</code>
              <div style={{ color: 'var(--ink-500)' }}>{p.desc}</div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
