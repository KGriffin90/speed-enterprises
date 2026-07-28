'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api('POST', '/api/auth/forgot-password', { email }); }
    finally { setBusy(false); setSent(true); }
  }

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Reset your password</h1>
        {sent ? (
          <p className="mt-3 text-sm" style={{ color: 'var(--ink-700)' }}>
            If the address exists on file, a reset link is on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
          </form>
        )}
        <div className="mt-6 text-sm">
          <Link href="/auth/sign-in" className="link">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
