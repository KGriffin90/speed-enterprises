import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTenantConfig, UnknownTenantError } from '@/lib/tenant';
import { readMe, apiServer } from '@/lib/server-auth';
import { QuoteWizard } from './QuoteWizard';

interface MeProfile {
  profile: {
    fullName: string | null; phone: string | null;
    addressLine: string | null; city: string | null; state: string | null; postalCode: string | null;
  } | null;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { serviceSlug: string } }) {
  try {
    const cfg = await loadTenantConfig();
    const s = cfg.services.find(s => s.slug === params.serviceSlug);
    return { title: s ? `${s.name} quote` : 'Quote' };
  } catch { return { title: 'Quote' }; }
}

export default async function QuotePage({ params, searchParams }: { params: { serviceSlug: string }; searchParams: { resume?: string } }): Promise<JSX.Element> {
  let cfg;
  try { cfg = await loadTenantConfig(); }
  catch (e) {
    if (e instanceof UnknownTenantError) notFound();
    throw e;
  }

  // Quote routes are PUBLIC: anonymous visitors complete the wizard and sign up
  // at submission. readMe() tells us whether to prefill from an existing account
  // and which submit path the wizard takes (authenticated vs. sign-up-then-resume).
  const me = readMe();

  const service = cfg.services.find(s => s.slug === params.serviceSlug && s.active && s.visibleOnPublicSite);
  if (!service) notFound();

  // For signed-in customers, prefill contact/address from their profile so the
  // only thing they have to type is the service address. Anonymous visitors get
  // an empty form and are routed to sign-up at submit.
  let prefill: React.ComponentProps<typeof QuoteWizard>['prefill'];
  if (me) {
    const me_profile = await apiServer<MeProfile>('GET', '/api/me/profile').catch(() => null);
    const p = me_profile?.profile;
    const savedAddress = p?.addressLine
      ? { line1: p.addressLine, city: p.city ?? '', state: p.state ?? '', postalCode: p.postalCode ?? '' }
      : undefined;
    prefill = {
      fullName: p?.fullName ?? me.user.fullName ?? '',
      email:    me.user.email,
      phone:    p?.phone ?? '',
      address:  savedAddress,
    };
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <Link href="/quote/new" className="link text-sm">← Choose a different service</Link>
      <h1 className="mt-4 text-3xl font-extrabold" style={{ color: 'var(--ink-900)' }}>{service.name}</h1>
      <p className="mt-2" style={{ color: 'var(--ink-500)' }}>{service.description}</p>

      <QuoteWizard
        tenantSlug={cfg.slug}
        service={service}
        industry={cfg.industry}
        tenantName={cfg.businessName}
        residentialEnabled={cfg.features.residentialEnabled}
        commercialEnabled={cfg.features.commercialEnabled}
        isAuthed={!!me}
        prefill={prefill}
        resume={searchParams.resume === '1'}
      />
    </div>
  );
}
