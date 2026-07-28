import type { JSX } from 'react';
import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import type { QuoteStatus } from '@speed-enterprises/shared';

interface JobDetail {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  service: { name: string; questions: any[] };
  propertyKind: 'RESIDENTIAL' | 'COMMERCIAL';
  addressLine: string; city: string; state: string; postalCode: string;
  guestName: string | null; guestEmail: string | null; guestPhone: string | null;
  user: { email: string; customerProfiles: { fullName: string }[] } | null;
  answers: Record<string, unknown>;
  customerNotes: string | null;
  preferredAtNote: string | null;
  statusHistory: Array<{ fromStatus: QuoteStatus; toStatus: QuoteStatus; createdAt: string; note: string | null }>;
}

export const metadata = { title: 'Job detail' };

export default async function StaffJobDetail({ params }: { params: { id: string } }): Promise<JSX.Element> {
  requireTenantRole('STAFF');
  const q = await apiServer<JobDetail>('GET', `/api/admin/quotes/${params.id}`);

  const questions: Array<{ id: string; label: string; unit?: string }> = q.service.questions ?? [];

  return (
    <div>
      <Link href="/dashboard/jobs" className="link text-sm">← Jobs</Link>

      <div className="mt-3 flex items-baseline justify-between gap-4 flex-wrap">
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
            <Row label="Name" value={q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? '—'} />
          </Section>

          <Section label="Service address">
            <div style={{ color: 'var(--ink-700)' }}>{q.addressLine}</div>
            <div style={{ color: 'var(--ink-700)' }}>{q.city}, {q.state} {q.postalCode}</div>
          </Section>

          {q.preferredAtNote && (
            <Section label="Preferred timing">
              <div style={{ color: 'var(--ink-700)' }}>{q.preferredAtNote}</div>
            </Section>
          )}

          {questions.length > 0 && Object.keys(q.answers).length > 0 && (
            <Section label="Job details">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
                {questions
                  .filter(qn => q.answers[qn.id] !== undefined && q.answers[qn.id] !== '')
                  .map(qn => (
                    <div key={qn.id}>
                      <dt className="text-xs mb-0.5" style={{ color: 'var(--ink-500)' }}>
                        {qn.label}{qn.unit ? ` (${qn.unit})` : ''}
                      </dt>
                      <dd style={{ color: 'var(--ink-900)' }}>
                        {Array.isArray(q.answers[qn.id])
                          ? (q.answers[qn.id] as string[]).join(', ')
                          : String(q.answers[qn.id])}
                      </dd>
                    </div>
                  ))}
              </dl>
            </Section>
          )}

          {q.customerNotes && (
            <Section label="Customer notes">
              <p style={{ color: 'var(--ink-700)' }}>{q.customerNotes}</p>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--ink-500)' }}>Status history</div>
            {q.statusHistory.length === 0 ? (
              <div className="text-sm" style={{ color: 'var(--ink-400)' }}>No history yet.</div>
            ) : (
              <ol className="space-y-2">
                {q.statusHistory.map((h, i) => {
                  const isLatest = i === 0;
                  return (
                    <li key={i} className="flex gap-3 items-start">
                      {/* Dot + line */}
                      <div className="flex flex-col items-center pt-1 flex-shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: isLatest ? '#16a34a' : 'var(--surface-300)' }} />
                        {i < q.statusHistory.length - 1 && (
                          <div className="w-px mt-1" style={{ background: 'var(--surface-200)', minHeight: 14, flex: 1 }} />
                        )}
                      </div>

                      {/* Content */}
                      <div
                        className={`flex-1 rounded-xl px-3 py-2.5 mb-1 ${isLatest ? 'border' : ''}`}
                        style={isLatest ? { background: '#f0fdf4', borderColor: '#86efac' } : {}}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{
                            color:      isLatest ? '#14532d' : 'var(--ink-600)' as any,
                            fontWeight: isLatest ? 700 : 500,
                            fontSize:   isLatest ? 14 : 13,
                          }}>
                            {h.fromStatus.replace(/_/g,' ')} → {h.toStatus.replace(/_/g,' ')}
                          </span>
                          {isLatest && (
                            <span className="text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                              style={{ background: '#bbf7d0', color: '#14532d', fontSize: 10 }}>
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: isLatest ? '#166534' : 'var(--ink-400)' as any }}>
                          {new Date(h.createdAt).toLocaleString()}
                        </div>
                        {h.note && (
                          <div className="text-xs mt-1 italic" style={{ color: isLatest ? '#166534' : 'var(--ink-500)' as any }}>
                            {h.note}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span style={{ color: 'var(--ink-500)', minWidth: '3.5rem' }}>{label}</span>
      <span style={{ color: 'var(--ink-900)' }}>{value}</span>
    </div>
  );
}
