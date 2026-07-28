import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTenantConfig, UnknownTenantError } from '@/lib/tenant';
import { serviceEmoji } from '@/lib/service-icons';
import { BackButton } from './BackButton';

export const metadata = { title: 'Get a quote' };

export default async function ChooseService(): Promise<JSX.Element> {
  let cfg;
  try { cfg = await loadTenantConfig(); }
  catch (e) {
    if (e instanceof UnknownTenantError) notFound();
    throw e;
  }

  // Public: anonymous visitors browse services and start a quote; the account
  // gate is at quote submission, not here.
  const services = cfg.services.filter(s => s.visibleOnPublicSite && s.active);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <BackButton />

      <div className="mt-4 mb-8">
        <h1 className="text-3xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
          What can we help with?
        </h1>
        <p className="mt-2" style={{ color: 'var(--ink-500)' }}>
          Pick a service to start your estimate — it only takes a few minutes.
        </p>
      </div>

      <div className="grid gap-10">
        {services.map(s => {
          const priceLine = s.pricingMode === 'QUOTE_REQUIRED'
            ? 'Custom quote'
            : s.basePriceCents > 0
              ? `From ${(s.basePriceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
              : null;

          return (
            <Link
              key={s.id}
              href={`/quote/${s.slug}`}
              className="card-hover p-7 flex items-center justify-between gap-5 group"
            >
              <div className="flex items-center gap-5">
                <div
                  className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-lg"
                  style={{ background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-0))' }}
                >
                  {serviceEmoji(s.iconKey)}
                </div>
                <div>
                  <div className="font-semibold text-base leading-snug" style={{ color: 'var(--ink-900)' }}>{s.name}</div>
                  <div className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-500)' }}>{s.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {priceLine && (
                  <span
                    className="hidden sm:block text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      background: s.pricingMode === 'QUOTE_REQUIRED'
                        ? 'var(--surface-100)'
                        : 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-0))',
                      color: s.pricingMode === 'QUOTE_REQUIRED' ? 'var(--ink-600)' : 'var(--brand-700)',
                    }}
                  >
                    {priceLine}
                  </span>
                )}
                <span
                  className="text-lg transition-transform group-hover:translate-x-1"
                  style={{ color: 'var(--brand-600)' }}
                >
                  →
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
