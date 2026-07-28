'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { formatPhone } from '@/lib/formatPhone';

interface Initial {
  fullName: string; phone: string;
  addressLine: string | null; city: string | null; state: string | null; postalCode: string | null;
  marketingConsent: boolean;
}

export function ProfileForm({ initial }: { initial: Initial | null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: initial?.fullName ?? '',
    phone:    initial?.phone ?? '',
    addressLine: initial?.addressLine ?? '',
    city:        initial?.city ?? '',
    state:       initial?.state ?? '',
    postalCode:  initial?.postalCode ?? '',
    marketingConsent: initial?.marketingConsent ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm({ ...form, [k]: v });
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('PATCH', '/api/me/profile', form);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold" style={{ color: 'var(--ink-900)' }}>Profile</h2>
        {saved && <span className="text-xs" style={{ color: '#059669' }}>Saved.</span>}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div><label className="label">Full name</label><input className="input" value={form.fullName} onChange={e => set('fullName', e.target.value)} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatPhone(e.target.value))} /></div>
      </div>
      <div className="grid md:grid-cols-6 gap-4">
        <div className="md:col-span-6"><label className="label">Street</label><input className="input" value={form.addressLine} onChange={e => set('addressLine', e.target.value)} /></div>
        <div className="md:col-span-3"><label className="label">City</label><input className="input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
        <div className="md:col-span-1"><label className="label">State</label><input className="input" maxLength={2} value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} /></div>
        <div className="md:col-span-2"><label className="label">ZIP</label><input className="input" value={form.postalCode} onChange={e => set('postalCode', e.target.value)} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-700)' }}>
        <input type="checkbox" checked={form.marketingConsent} onChange={e => set('marketingConsent', e.target.checked)} />
        Send me reminders, follow-ups, and seasonal offers.
      </label>
      {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}
