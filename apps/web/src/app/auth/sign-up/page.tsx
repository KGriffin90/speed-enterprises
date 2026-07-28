import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { loadTenantConfig, UnknownTenantError } from '@/lib/tenant';
import { SignUpForm } from './SignUpForm';

export const metadata = { title: 'Create account' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: { next?: string; name?: string; email?: string; phone?: string };
}): Promise<JSX.Element> {
  let cfg;
  try { cfg = await loadTenantConfig(); }
  catch (e) { if (e instanceof UnknownTenantError) notFound(); throw e; }

  const next = searchParams.next ?? '';

  // If `next` points to a specific service slug, surface the service name
  // so the sign-up page can show "to request a [Service] quote".
  const serviceSlugMatch = next.match(/^\/quote\/([^/?]+)/);
  const serviceSlug = serviceSlugMatch?.[1] ?? null;
  const service = serviceSlug
    ? cfg.services.find(s => s.slug === serviceSlug && s.visibleOnPublicSite && s.active)
    : null;

  const comingForQuote = next.startsWith('/quote');

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 rounded-2xl overflow-hidden shadow-2xl"
        style={{ border: '1px solid var(--surface-200)' }}>

        {/* ── Left panel: branding + context ───────────────────────── */}
        <div
          className="hidden md:flex flex-col justify-between p-10"
          style={{ background: 'var(--brand-600)' }}
        >
          {/* Logo */}
          <div className="flex items-center gap-3">
            {cfg.branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cfg.branding.logoUrl} alt="" className="h-10 w-10 rounded-xl object-cover"
                style={{ border: '2px solid rgba(255,255,255,0.2)' }} />
            )}
            <span className="font-extrabold text-lg" style={{ color: 'var(--on-brand)' }}>
              {cfg.branding.wordmarkText}
            </span>
          </div>

          {/* Context headline */}
          <div>
            {comingForQuote ? (
              <>
                <p className="text-sm font-semibold mb-3 opacity-70" style={{ color: 'var(--on-brand)' }}>
                  {service ? `Requesting a quote for` : 'Get a quote'}
                </p>
                {service ? (
                  <h2 className="text-2xl font-extrabold leading-snug" style={{ color: 'var(--on-brand)' }}>
                    {service.name}
                  </h2>
                ) : (
                  <h2 className="text-2xl font-extrabold leading-snug" style={{ color: 'var(--on-brand)' }}>
                    Quick, free estimate from {cfg.businessName}
                  </h2>
                )}
                {service?.description && (
                  <p className="mt-2 text-sm opacity-70 leading-relaxed" style={{ color: 'var(--on-brand)' }}>
                    {service.description}
                  </p>
                )}
              </>
            ) : (
              <h2 className="text-2xl font-extrabold" style={{ color: 'var(--on-brand)' }}>
                Your {cfg.businessName} account
              </h2>
            )}

            {/* Trust bullets */}
            <ul className="mt-8 space-y-3">
              {[
                'Track your quote status in real time',
                'Save your address for faster future requests',
                'Receive your estimate directly by email',
                'Book and manage service appointments',
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm" style={{ color: 'var(--on-brand)', opacity: 0.85 }}>
                  <CheckIcon />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Footer note */}
          <p className="text-xs opacity-40" style={{ color: 'var(--on-brand)' }}>
            {cfg.contact.publicPhone} · {cfg.contact.publicEmail}
          </p>
        </div>

        {/* ── Right panel: form ─────────────────────────────────────── */}
        <div className="flex flex-col justify-center p-8 md:p-10" style={{ background: 'var(--surface-0)' }}>
          {/* Mobile: show logo + business name */}
          <div className="flex items-center gap-3 mb-6 md:hidden">
            {cfg.branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cfg.branding.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
            )}
            <span className="font-bold text-sm" style={{ color: 'var(--ink-900)' }}>{cfg.branding.wordmarkText}</span>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
              Create your account
            </h1>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--ink-500)' }}>
              {comingForQuote
                ? 'One quick step before we build your estimate.'
                : `Join ${cfg.businessName} to manage your service requests.`}
            </p>
          </div>

          <SignUpForm
            tenantSlug={cfg.slug}
            next={next}
            initialName={searchParams.name}
            initialEmail={searchParams.email}
            initialPhone={searchParams.phone}
          />
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="8" cy="8" r="8" fill="rgba(255,255,255,0.2)" />
      <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
