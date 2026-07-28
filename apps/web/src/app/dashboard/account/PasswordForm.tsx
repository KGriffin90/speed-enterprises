'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { clearSession } from '@/lib/auth';

export function PasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('POST', '/api/me/change-password', { currentPassword: current, newPassword: next });
      // Server revoked all refresh tokens — sign out client-side and push to sign-in
      clearSession();
      setDone(true);
      router.push('/auth/sign-in?password=changed');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <h2 className="font-semibold" style={{ color: 'var(--ink-900)' }}>Change password</h2>
      <p className="text-sm" style={{ color: 'var(--ink-500)' }}>
        You'll be signed out of all sessions when you change your password.
      </p>
      <div>
        <label className="label">Current password</label>
        <input className="input" type="password" required value={current} onChange={e => setCurrent(e.target.value)} />
      </div>
      <div>
        <label className="label">New password</label>
        <input className="input" type="password" required minLength={8} value={next} onChange={e => setNext(e.target.value)} />
        <div className="help">At least 8 characters.</div>
      </div>
      {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}
      {done && <div className="text-sm" style={{ color: '#059669' }}>Password updated.</div>}
      <div className="flex justify-end">
        <button className="btn-secondary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </div>
    </form>
  );
}
