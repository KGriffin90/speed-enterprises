'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { setSession } from '@/lib/auth';
import type { SessionResponseDto } from '@speed-enterprises/shared';

export function SignInForm({ tenantSlug }: { tenantSlug: string | null }) {
  const router = useRouter();
  const search = useSearchParams();
  const explicitNext = search.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<SessionResponseDto>('POST', '/api/auth/login', {
        email, password, tenantSlug: tenantSlug ?? undefined,
      });
      setSession(res);
      const role = res.tenant?.role;
      const dest = explicitNext
        ?? (res.user.platformRole === 'PLATFORM_ADMIN' ? '/platform'
          : role && ['STAFF', 'OWNER'].includes(role) ? '/admin'
          : '/dashboard');
      router.push(dest);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign in failed');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label">Password</label>
        <div className="relative">
          <input
            className="input pr-10"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex items-center px-3"
            style={{ color: 'var(--ink-500)' }}
          >
            {showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && <div className="card p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>{error}</div>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
