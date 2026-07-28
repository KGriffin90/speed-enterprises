import Link from 'next/link';
import { apiServer } from '@/lib/server-auth';

interface TemplateRow {
  id: string | null;
  kind: string;
  channel: string;
  subject: string | null;
  body: string;
  enabled: boolean;
  isCustomized: boolean;
}

const HUMAN_KIND: Record<string, string> = {
  verify_email:                'Email verification',
  password_reset:              'Password reset',
  quote_received_customer:     'Quote received — to customer',
  quote_received_internal:     'Quote received — internal',
  estimate_sent_customer:      'Estimate sent — to customer',
  quote_followup_no_response:  'Estimate follow-up',
  quote_accepted_internal:     'Quote accepted — internal',
  job_scheduled_customer:      'Job scheduled — to customer',
  job_reminder_customer:       'Job reminder',
  job_started_customer:        'Job started',
  job_completed_customer:      'Job completed — to customer',
  invoice_sent_customer:       'Invoice sent',
  payment_received_customer:   'Payment received',
  review_request_customer:     'Review request',
  referral_request_customer:   'Referral request',
};

export const metadata = { title: 'Admin · Automations' };

export default async function AdminAutomations() {
  const rows = await apiServer<TemplateRow[]>('GET', '/api/me/automations');

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Automations</h1>
        <span className="text-sm" style={{ color: 'var(--ink-500)' }}>
          {rows.filter(r => r.isCustomized).length}/{rows.length} customized
        </span>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        Edit the wording and subject lines of the automated messages your customers receive. Untouched messages fall through to platform defaults.
      </p>
      <ul className="grid gap-3">
        {rows.map(r => (
          <li key={`${r.kind}:${r.channel}`}>
            <Link href={`/admin/automations/${encodeURIComponent(r.kind)}/${encodeURIComponent(r.channel)}`} className="card p-5 flex items-center justify-between hover:shadow-lg transition">
              <div>
                <div className="font-semibold" style={{ color: 'var(--ink-900)' }}>
                  {HUMAN_KIND[r.kind] ?? r.kind}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--ink-500)' }}>
                  {r.channel} · {r.subject ?? '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-1 rounded-full font-medium" style={{
                  background: r.isCustomized ? 'var(--brand-100)' : 'var(--surface-100)',
                  color: r.isCustomized ? 'var(--brand-700)' : 'var(--ink-500)',
                }}>
                  {r.isCustomized ? 'Custom' : 'Default'}
                </span>
                {!r.enabled && <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#fef2f2', color: '#991b1b' }}>Off</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
