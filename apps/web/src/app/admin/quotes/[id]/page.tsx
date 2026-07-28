import type { JSX } from 'react';
import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import { AdminActions } from './AdminActions';
import { SchedulingPanel } from './SchedulingPanel';
import { ComplexityPanel } from './ComplexityPanel';
import { LEGAL_STATUS_TRANSITIONS, type QuoteStatus } from '@speed-enterprises/shared';

interface AdminQuoteDetail {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  service: { id: string; name: string; slug: string; questions: any[]; pricingMode: string };
  propertyKind: 'RESIDENTIAL' | 'COMMERCIAL';
  addressLine: string; city: string; state: string; postalCode: string;
  guestName: string | null; guestEmail: string | null; guestPhone: string | null;
  user: { email: string } | null;
  answers: Record<string, unknown>;
  customerNotes: string | null;
  internalNotes: string | null;
  jobComplexity: 'SIMPLE' | 'COMPLEX' | null;
  complexityNote: string | null;
  pricingBreakdown: { steps?: Array<{ label: string; deltaCents: number; runningCents: number }>; totalCents?: number } | null;
  estimateAmountCents: number | null;
  estimateSentAt: string | null;
  preferredAtNote: string | null;
  lineItems: any[];
  images: any[];
  statusHistory: Array<{ fromStatus: QuoteStatus; toStatus: QuoteStatus; createdAt: string; note: string | null }>;
}

export const metadata = { title: 'Admin · Quote' };

export default async function AdminQuoteDetail({ params }: { params: { id: string } }): Promise<JSX.Element> {
  const me = requireTenantRole('STAFF');
  const q = await apiServer<AdminQuoteDetail>('GET', `/api/admin/quotes/${params.id}`);
  const allowed = LEGAL_STATUS_TRANSITIONS[q.status] ?? [];
  const isAdmin = me.tenant?.role === 'OWNER';

  return (
    <div>
      <Link href="/admin" className="link text-sm">← All quotes</Link>
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
            {q.guestName ?? q.user?.email ?? 'Customer'}
          </h1>
          <div className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
            {q.service.name} · {q.propertyKind.toLowerCase()} · {new Date(q.createdAt).toLocaleString()}
          </div>
        </div>
        <StatusPill status={q.status} />
      </div>

      <div className="grid md:grid-cols-3 gap-5 mt-6">
        <div className="card p-5 md:col-span-2 space-y-5">
          <Section label="Customer">
            <div>{q.guestEmail ?? q.user?.email ?? '—'}</div>
            <div>{q.guestPhone ?? '—'}</div>
          </Section>
          <Section label="Service address">
            <div>{q.addressLine}</div>
            <div>{q.city}, {q.state} {q.postalCode}</div>
          </Section>
          <Section label="Answers">
            <dl className="divide-y" style={{ borderColor: 'var(--surface-200)' }}>
              {q.service.questions
                .filter((qq: any) => q.answers[qq.id] !== undefined)
                .map((qq: any) => (
                  <div key={qq.id} className="grid grid-cols-3 py-2 text-sm">
                    <dt className="col-span-1" style={{ color: 'var(--ink-500)' }}>{qq.label}</dt>
                    <dd className="col-span-2" style={{ color: 'var(--ink-900)' }}>{renderAnswer(q.answers[qq.id])}</dd>
                  </div>
                ))}
            </dl>
          </Section>
          {q.customerNotes && (
            <Section label="Customer notes"><p className="text-sm">{q.customerNotes}</p></Section>
          )}
          {q.preferredAtNote && (
            <Section label="Preferred time"><p className="text-sm">{q.preferredAtNote}</p></Section>
          )}
          {q.statusHistory.length > 0 && (
            <Section label="History">
              <ul className="text-sm space-y-2">
                {q.statusHistory.map((h, i) => (
                  <li key={i} style={{ color: 'var(--ink-700)' }}>
                    <span className="font-medium">{h.fromStatus} → {h.toStatus}</span>
                    <span className="text-xs" style={{ color: 'var(--ink-500)' }}> · {new Date(h.createdAt).toLocaleString()}</span>
                    {h.note && <div className="text-xs" style={{ color: 'var(--ink-500)' }}>{h.note}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {q.estimateAmountCents != null && (
            <div className="card p-5">
              <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-500)' }}>Current estimate</div>
              <div className="text-3xl font-extrabold mt-1" style={{ color: 'var(--ink-900)' }}>
                ${(q.estimateAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          )}

          {q.pricingBreakdown?.steps && (
            <div className="card p-5">
              <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Computed price</div>
              <ul className="text-sm space-y-1">
                {q.pricingBreakdown.steps.map((s, i) => (
                  <li key={i} className="flex justify-between" style={{ color: 'var(--ink-700)' }}>
                    <span>{s.label}</span>
                    <span>{s.deltaCents >= 0 ? '+' : ''}${(s.deltaCents / 100).toFixed(2)}</span>
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

          <ComplexityPanel
            quoteId={q.id}
            initialComplexity={q.jobComplexity}
            initialNote={q.complexityNote}
            canEdit={isAdmin}
          />

          <AdminActions
            quoteId={q.id}
            currentStatus={q.status}
            allowedTransitions={allowed as QuoteStatus[]}
            canSendEstimate={isAdmin}
            canDelete={isAdmin}
            currentEstimateCents={q.estimateAmountCents}
            computedTotalCents={q.pricingBreakdown?.totalCents ?? null}
            jobComplexity={q.jobComplexity}
          />

          <SchedulingPanel quoteId={q.id} status={q.status} />
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
