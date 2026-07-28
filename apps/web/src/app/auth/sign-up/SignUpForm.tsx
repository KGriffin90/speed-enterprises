'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { formatPhone } from '@/lib/formatPhone';
import { LEGAL_VERSIONS } from '@/content/legal/config';

interface Props {
  tenantSlug: string;
  next: string;
  /** Prefill from a quote the customer just completed, so they only set a password. */
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
}

export function SignUpForm({ tenantSlug, next, initialName, initialEmail, initialPhone }: Props): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: initialName  ?? '',
    email:    initialEmail ?? '',
    password: '',
    phone:    initialPhone ?? '',
  });
  const [showPass, setShowPass] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agreed) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue.');
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/api/auth/register', {
        tenantSlug,
        email:    form.email,
        password: form.password,
        fullName: form.fullName,
        phone:    form.phone,
        acceptTerms:            true,
        acceptedTermsVersion:   LEGAL_VERSIONS.terms,
        acceptedPrivacyVersion: LEGAL_VERSIONS.privacy,
        marketingConsent:       marketing,
      });
      const params = new URLSearchParams({ email: form.email });
      if (next) params.set('next', next);
      router.push(`/auth/verify?${params.toString()}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-up failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const signInHref = next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : '/auth/sign-in';

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="label">Full name <Required /></label>
        <input
          className="input"
          required
          autoComplete="name"
          placeholder="Jane Smith"
          value={form.fullName}
          onChange={e => set('fullName', e.target.value)}
        />
      </div>

      {/* Email */}
      <div>
        <label className="label">Email address <Required /></label>
        <input
          className="input"
          type="email"
          required
          autoComplete="email"
          placeholder="jane@example.com"
          value={form.email}
          onChange={e => set('email', e.target.value)}
        />
      </div>

      {/* Phone */}
      <div>
        <label className="label">Phone number <Required /></label>
        <input
          className="input"
          type="tel"
          required
          autoComplete="tel"
          placeholder="(801) 555-0100"
          value={form.phone}
          onChange={e => set('phone', e.target.value)}
          onBlur={e => set('phone', formatPhone(e.target.value))}
        />
      </div>

      {/* Password */}
      <div>
        <label className="label">Password <Required /></label>
        <div className="relative">
          <input
            className="input pr-12"
            type={showPass ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            value={form.password}
            onChange={e => set('password', e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPass(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium"
            style={{ color: 'var(--ink-400)' }}
          >
            {showPass ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Consent — required agreement to Terms + Privacy */}
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          aria-required="true"
        />
        <span className="text-xs leading-relaxed" style={{ color: 'var(--ink-500)' }}>
          I agree to the{' '}
          <a href="/legal/terms-of-service" target="_blank" rel="noopener noreferrer" className="link font-semibold">Terms of Service</a>,{' '}
          <a href="/legal/eula" target="_blank" rel="noopener noreferrer" className="link font-semibold">EULA</a>, and{' '}
          <a href="/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="link font-semibold">Privacy Policy</a>, and I consent to receive transactional messages about my service requests. <Required />
        </span>
      </label>

      {/* Optional marketing consent */}
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={marketing}
          onChange={e => setMarketing(e.target.checked)}
        />
        <span className="text-xs leading-relaxed" style={{ color: 'var(--ink-500)' }}>
          (Optional) Send me occasional updates, offers, and tips. You can unsubscribe anytime.
        </span>
      </label>

      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <button className="btn-primary w-full py-3.5 text-base" disabled={busy || !agreed}>
        {busy ? 'Creating account…' : 'Create account & continue'}
      </button>

      <p className="text-center text-sm" style={{ color: 'var(--ink-500)' }}>
        Already have an account?{' '}
        <a href={signInHref} className="link font-semibold">Sign in</a>
      </p>
    </form>
  );
}

function Required() {
  return <span style={{ color: 'var(--brand-500)' }}> *</span>;
}
