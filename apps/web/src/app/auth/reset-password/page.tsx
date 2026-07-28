'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('POST', '/api/auth/reset-password', { token, newPassword: password });
      router.push('/auth/sign-in?reset=ok');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reset failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Choose a new password</h1>
        {!token ? (
          <p className="mt-3 text-sm" style={{ color: '#991b1b' }}>Missing reset token. Request a new link.</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label">New password</label>
              <input className="input" type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
              <div className="help">At least 8 characters.</div>
            </div>
            {error && <div className="card p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>{error}</div>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
