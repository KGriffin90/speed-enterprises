'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { setSession } from '@/lib/auth';
import type { SessionResponseDto } from '@speed-enterprises/shared';

export function VerifyForm({ initialEmail, initialToken, next }: { initialEmail: string; initialToken: string; next: string }): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  // If a token link arrived (initialToken non-empty), submit it immediately
  useEffect(() => {
    if (initialToken && email) {
      void submit(undefined, initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e?: React.FormEvent, tokenOverride?: string) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<SessionResponseDto>('POST', '/api/auth/verify-email', {
        email,
        ...(tokenOverride ? { token: tokenOverride } : { otp }),
      });
      setSession(res);
      const role = res.tenant?.role;
      const dest = next || (
        res.user.platformRole === 'PLATFORM_ADMIN' ? '/platform'
        : (role === 'OWNER') ? '/admin'
        : '/dashboard'
      );
      router.push(dest);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed');
    } finally { setBusy(false); }
  }

  async function resend() {
    setError(null);
    try {
      await api('POST', '/api/auth/resend-verification', { email });
      setResent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not resend');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label">6-digit code</label>
        <input className="input" inputMode="numeric" maxLength={6} pattern="\d{6}"
          value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          style={{ letterSpacing: '0.6em', fontSize: '1.25rem' }} />
        <p className="text-xs mt-1.5" style={{ color: 'var(--ink-500)' }}>
          The code can take a few minutes to arrive and expires 15 minutes after it&apos;s sent. Didn&apos;t get it? Resend below for a fresh one.
        </p>
      </div>
      {error && <div className="card p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>{error}</div>}
      {resent && <div className="text-sm" style={{ color: 'var(--ink-500)' }}>A new code is on its way — it can take a few minutes to arrive.</div>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
      <button type="button" className="btn-secondary w-full" onClick={resend}>Resend code</button>
    </form>
  );
}
