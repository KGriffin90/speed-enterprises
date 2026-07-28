import type { JSX } from 'react';
import Link from 'next/link';
import { apiServer } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import { CustomerActions } from './CustomerActions';
import { BookingSection } from './BookingSection';
import type { QuoteStatus } from '@speed-enterprises/shared';

interface QuoteDetail {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  scheduledAt: string | null;
  service: { name: string; slug: string; questions: any[]; estimatedDurationMinutes: number | null };
  propertyKind: 'RESIDENTIAL' | 'COMMERCIAL';
  addressLine: string; city: string; state: string; postalCode: string;
  guestName: string | null; guestEmail: string | null; guestPhone: string | null;
  user: { email: string; customerProfiles?: { fullName: string; phone: string }[] } | null;
  answers: Record<string, unknown>;
  customerNotes: string | null;
  jobComplexity: 'SIMPLE' | 'COMPLEX' | null;
  complexityNote: string | null;
  pricingBreakdown: { steps?: Array<{ label: string; deltaCents: number; runningCents: number }>; totalCents?: number } | null;
  estimateAmountCents: number | null;
  estimateSentAt: string | null;
  estimateValidUntil: string | null;
  acceptedAt: string | null;
  lineItems: any[];
  images: any[];
  statusHistory: Array<{ fromStatus: QuoteStatus; toStatus: QuoteStatus; createdAt: string; note: string | null }>;
}

export const metadata = { title: 'Quote details' };

export default async function CustomerQuoteDetail({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const q = await apiServer<QuoteDetail>('GET', `/api/quotes/${params.id}`);
  return (
    <div>
      <Link href="/dashboard" className="link text-sm">← All quotes</Link>
      <div className="mt-3 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>{q.service.name}</h1>
          <div className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
            {q.propertyKind === 'RESIDENTIAL' ? 'Residential' : 'Commercial'} · Submitted {new Date(q.createdAt).toLocaleDateString()}
          </div>
        </div>
        <StatusPill status={q.status} />
      </div>

      <div className="grid md:grid-cols-3 gap-5 mt-6">
        <div className="card p-5 md:col-span-2 space-y-5">
          <Section label="Your contact info">
            <div className="grid grid-cols-3 gap-y-2 text-sm">
              <span style={{ color: 'var(--ink-500)' }}>Name</span>
              <span className="col-span-2" style={{ color: 'var(--ink-900)' }}>
                {q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? '—'}
              </span>
              <span style={{ color: 'var(--ink-500)' }}>Email</span>
              <span className="col-span-2" style={{ color: 'var(--ink-900)' }}>
                {q.guestEmail ?? q.user?.email ?? '—'}
              </span>
              <span style={{ color: 'var(--ink-500)' }}>Phone</span>
              <span className="col-span-2" style={{ color: 'var(--ink-900)' }}>
                {q.guestPhone ?? q.user?.customerProfiles?.[0]?.phone ?? '—'}
              </span>
            </div>
          </Section>

          <Section label="Service address">
            <div>{q.addressLine}</div>
            <div>{q.city}, {q.state} {q.postalCode}</div>
          </Section>

          <Section label="Your answers">
            <dl className="divide-y" style={{ borderColor: 'var(--surface-200)' }}>
              {q.service.questions
                .filter((qq: any) => !qq.internal && q.answers[qq.id] !== undefined)
                .map((qq: any) => (
                  <div key={qq.id} className="grid grid-cols-3 py-2 text-sm">
                    <dt className="col-span-1" style={{ color: 'var(--ink-500)' }}>{qq.label}</dt>
                    <dd className="col-span-2" style={{ color: 'var(--ink-900)' }}>{renderAnswer(q.answers[qq.id])}</dd>
                  </div>
                ))}
            </dl>
          </Section>

          {q.customerNotes && (
            <Section label="Notes">
              <p className="text-sm">{q.customerNotes}</p>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {q.jobComplexity === 'COMPLEX' && q.complexityNote && (
            <div className="card p-5" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span aria-hidden>🗓️</span>
                <div className="text-sm font-bold" style={{ color: '#92400e' }}>A larger, multi-day project</div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: '#92400e' }}>{q.complexityNote}</p>
            </div>
          )}

          {q.estimateAmountCents != null && (
            <div className="card p-5">
              <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-500)' }}>Your estimate</div>
              <div className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ink-900)' }}>
                ${(q.estimateAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              {q.estimateSentAt && (
                <div className="text-xs mt-1" style={{ color: 'var(--ink-500)' }}>
                  Sent {new Date(q.estimateSentAt).toLocaleDateString()}
                </div>
              )}
            </div>
          )}

          <CustomerActions quoteId={q.id} status={q.status} accepted={q.acceptedAt != null} validUntil={q.estimateValidUntil} />

          <BookingSection
            quoteId={q.id}
            status={q.status}
            accepted={q.acceptedAt != null}
            durationMinutes={q.service.estimatedDurationMinutes}
          />

          {q.statusHistory && q.statusHistory.length > 0 && (
            <div className="card p-5">
              <div className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--ink-500)' }}>Activity</div>
              <ol className="space-y-3">
                {q.statusHistory.map((h, i) => {
                  const isLatest = i === 0;
                  return (
                    <li key={i} className="flex gap-3 items-start">
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center pt-1 flex-shrink-0">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: isLatest ? '#16a34a' : 'var(--surface-300)' }}
                        />
                        {i < q.statusHistory.length - 1 && (
                          <div className="w-px flex-1 mt-1" style={{ background: 'var(--surface-200)', minHeight: 16 }} />
                        )}
                      </div>

                      {/* Content */}
                      <div
                        className={`flex-1 rounded-xl px-3 py-2.5 ${isLatest ? 'border' : ''}`}
                        style={isLatest ? {
                          background: '#f0fdf4',
                          borderColor: '#86efac',
                        } : {}}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={isLatest ? 'text-sm font-bold' : 'text-sm font-medium'}
                            style={{ color: isLatest ? '#14532d' : 'var(--ink-600)' as any }}
                          >
                            {h.toStatus.replace(/_/g, ' ')}
                          </span>
                          {isLatest && (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: '#bbf7d0', color: '#14532d', fontSize: 10 }}>
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--ink-400)' }}>
                          {new Date(h.createdAt).toLocaleString()}
                        </div>
                        {h.note && (
                          <div className="text-xs mt-1 italic" style={{ color: 'var(--ink-500)' }}>{h.note}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {q.pricingBreakdown?.steps && q.pricingBreakdown.steps.length > 1 && (
            <div className="card p-5">
              <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>How it's priced</div>
              <ul className="text-sm space-y-1">
                {q.pricingBreakdown.steps.map((s, i) => (
                  <li key={i} className="flex justify-between" style={{ color: 'var(--ink-700)' }}>
                    <span>{s.label}</span>
                    <span className={s.deltaCents < 0 ? '' : ''}>
                      {s.deltaCents >= 0 ? '+' : ''}${(s.deltaCents / 100).toFixed(2)}
                    </span>
                  </li>
                ))}
                {q.pricingBreakdown.totalCents != null && (
                  <li className="flex justify-between pt-2 border-t font-semibold" style={{ borderColor: 'var(--surface-200)', color: 'var(--ink-900)' }}>
                    <span>Total</span>
                    <span>${(q.pricingBreakdown.totalCents / 100).toFixed(2)}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>{label}</div>
      <div style={{ color: 'var(--ink-900)' }}>{children}</div>
    </div>
  );
}

function renderAnswer(v: unknown): string {
  if (v === true)  return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
