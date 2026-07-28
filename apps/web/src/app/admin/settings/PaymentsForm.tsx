'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import type { BusinessConfig } from '@speed-enterprises/shared';

interface ConnectStatus {
  connected: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  businessName: string | null;
}

type DepositKind = 'none' | 'flat' | 'percent';
type TaxKind     = 'none' | 'flat_percent' | 'stripe_tax';

export function PaymentsForm({ cfg }: { cfg: BusinessConfig }) {
  const router = useRouter();
  const p = cfg.payments;

  const [status,  setStatus]  = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Payment settings state
  const [enabled,        setEnabled]        = useState(p.enabled);
  const [depositKind,    setDepositKind]    = useState<DepositKind>((p.depositPolicy.kind as DepositKind) ?? 'none');
  const [depositCents,   setDepositCents]   = useState((p.depositPolicy as any).cents ?? 0);
  const [depositPercent, setDepositPercent] = useState((p.depositPolicy as any).percent ?? 0);
  const [invoiceDueDays, setInvoiceDueDays] = useState(p.invoiceDueDays);
  const [taxKind,        setTaxKind]        = useState<TaxKind>((p.taxPolicy.kind as TaxKind) ?? 'none');
  const [taxPercent,     setTaxPercent]     = useState((p.taxPolicy as any).percent ?? 0);
  const [methods,        setMethods]        = useState<string[]>(p.acceptedMethods as string[]);

  useEffect(() => {
    api<ConnectStatus>('GET', '/api/payments/connect/status')
      .then(setStatus)
      .catch(() => setStatus({ connected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, businessName: null }))
      .finally(() => setLoading(false));
  }, []);

  async function startOnboarding() {
    setBusy(true); setError(null);
    try {
      const origin = window.location.origin;
      const { url } = await api<{ url: string }>('POST', '/api/payments/connect/start', {
        returnUrl:  `${origin}/admin/settings?stripe=success`,
        refreshUrl: `${origin}/admin/settings?stripe=refresh`,
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start onboarding');
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api('PATCH', '/api/me/config', {
        payments: {
          enabled,
          provider: 'stripe',
          stripeAccountId: status?.accountId ?? undefined,
          acceptedMethods: methods,
          depositPolicy: depositKind === 'none'    ? { kind: 'none' }
                       : depositKind === 'flat'    ? { kind: 'flat',    cents:   depositCents }
                       : { kind: 'percent', percent: depositPercent },
          invoiceDueDays,
          lateFeePolicy: { kind: 'none' },
          taxPolicy: taxKind === 'none'         ? { kind: 'none' }
                   : taxKind === 'stripe_tax'   ? { kind: 'stripe_tax' }
                   : { kind: 'flat_percent', percent: taxPercent },
        },
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  function toggleMethod(m: string) {
    setMethods(ms => ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]);
  }

  return (
    <section className="card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold" style={{ color: 'var(--ink-900)' }}>Payments</h2>
        {saved && <span className="text-xs" style={{ color: '#059669' }}>Saved.</span>}
      </div>

      {/* Stripe Connect status */}
      <div className="card p-4" style={{ background: 'var(--surface-50)' }}>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Stripe Connect</div>
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--ink-400)' }}>Checking…</div>
        ) : status?.connected ? (
          <div className="flex items-center justify-between">
            <div>
              {status.businessName && <div className="font-medium text-sm" style={{ color: 'var(--ink-900)' }}>{status.businessName}</div>}
              <div className="text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>
                {status.chargesEnabled ? '✓ Charges enabled' : '⚠ Charges not enabled'} ·{' '}
                {status.payoutsEnabled ? '✓ Payouts enabled' : '⚠ Payouts not enabled'}
              </div>
            </div>
            <button className="btn-secondary text-sm py-1.5 px-3" onClick={startOnboarding} disabled={busy}>
              Update account
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: 'var(--ink-600)' }}>Connect a Stripe account to accept payments.</p>
            <button className="btn-primary text-sm py-1.5 px-3" onClick={startOnboarding} disabled={busy}>
              {busy ? 'Redirecting…' : 'Connect Stripe'}
            </button>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-700)' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enable payment collection
      </label>

      {/* Payment methods */}
      <div>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Accepted methods</div>
        <div className="flex gap-4 flex-wrap text-sm">
          {['card', 'ach', 'apple_pay', 'google_pay'].map(m => (
            <label key={m} className="flex items-center gap-1.5" style={{ color: 'var(--ink-700)' }}>
              <input type="checkbox" checked={methods.includes(m)} onChange={() => toggleMethod(m)} />
              {m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </label>
          ))}
        </div>
      </div>

      {/* Deposit policy */}
      <div>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Deposit policy</div>
        <div className="flex items-center gap-3 flex-wrap">
          <select className="input w-36" value={depositKind} onChange={e => setDepositKind(e.target.value as DepositKind)}>
            <option value="none">No deposit</option>
            <option value="flat">Flat amount</option>
            <option value="percent">Percentage</option>
          </select>
          {depositKind === 'flat' && (
            <div className="flex items-center gap-1">
              <span className="text-sm" style={{ color: 'var(--ink-500)' }}>$</span>
              <input className="input w-24" type="number" min={0} step={0.01} value={depositCents / 100}
                onChange={e => setDepositCents(Math.round(parseFloat(e.target.value || '0') * 100))} />
            </div>
          )}
          {depositKind === 'percent' && (
            <div className="flex items-center gap-1">
              <input className="input w-20" type="number" min={0} max={100} value={depositPercent}
                onChange={e => setDepositPercent(Number(e.target.value))} />
              <span className="text-sm" style={{ color: 'var(--ink-500)' }}>%</span>
            </div>
          )}
        </div>
      </div>

      {/* Tax policy */}
      <div>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Tax</div>
        <div className="flex items-center gap-3 flex-wrap">
          <select className="input w-40" value={taxKind} onChange={e => setTaxKind(e.target.value as TaxKind)}>
            <option value="none">No tax</option>
            <option value="flat_percent">Fixed %</option>
            <option value="stripe_tax">Stripe Tax (automatic)</option>
          </select>
          {taxKind === 'flat_percent' && (
            <div className="flex items-center gap-1">
              <input className="input w-20" type="number" min={0} max={100} step={0.1} value={taxPercent}
                onChange={e => setTaxPercent(Number(e.target.value))} />
              <span className="text-sm" style={{ color: 'var(--ink-500)' }}>%</span>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="label">Invoice due (days after issue)</label>
        <input className="input w-24" type="number" min={0} value={invoiceDueDays}
          onChange={e => setInvoiceDueDays(Number(e.target.value))} />
      </div>

      {error && <div className="text-sm" style={{ color: '#dc2626' }}>{error}</div>}

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save payments'}</button>
      </div>
    </section>
  );
}
