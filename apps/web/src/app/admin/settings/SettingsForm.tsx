'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import type { BusinessConfig } from '@speed-enterprises/shared';

export function SettingsForm({ cfg }: { cfg: BusinessConfig }) {
  const router = useRouter();
  // Branding
  const [wordmarkText, setWordmarkText] = useState(cfg.branding.wordmarkText);
  const [logoUrl,    setLogoUrl]    = useState(cfg.branding.logoUrl);
  const [faviconUrl, setFaviconUrl] = useState(cfg.branding.faviconUrl);
  const [appIconUrl, setAppIconUrl] = useState(cfg.branding.appIconUrl);
  const [fontFamily, setFontFamily] = useState(cfg.branding.fontFamily);
  const [cornerRadius, setCornerRadius] = useState(cfg.branding.cornerRadius);
  const [colors, setColors] = useState(cfg.branding.colors);

  // Contact
  const [publicPhone, setPublicPhone]       = useState(cfg.contact.publicPhone);
  const [publicEmail, setPublicEmail]       = useState(cfg.contact.publicEmail);
  const [notificationEmails, setNotificationEmails] = useState(cfg.contact.notificationEmails.join(', '));
  const [emailFromName, setEmailFromName]   = useState(cfg.contact.emailFromName ?? '');
  const [emailFromAddress, setEmailFromAddress] = useState(cfg.contact.emailFromAddress ?? '');
  const [smsNumber, setSmsNumber] = useState(cfg.contact.smsNumber ?? '');

  // Features (subset; full list in BusinessConfig)
  const [features, setFeatures] = useState(cfg.features);
  // Automation
  const [automation, setAutomation] = useState(cfg.automation);
  // Scheduling
  const [scheduling, setScheduling] = useState(cfg.scheduling);
  // AI
  const [ai, setAi] = useState(cfg.ai);

  const [busy, setBusy]   = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    try {
      await api('PATCH', '/api/me/config', {
        branding: {
          wordmarkText, logoUrl, faviconUrl, appIconUrl,
          fontFamily: fontFamily as any, cornerRadius: cornerRadius as any,
          colors,
        },
        contact: {
          publicPhone, publicEmail,
          notificationEmails: notificationEmails.split(',').map(s => s.trim()).filter(Boolean),
          emailFromName:    emailFromName    || undefined,
          emailFromAddress: emailFromAddress || undefined,
          smsNumber:        smsNumber        || undefined,
        },
        features,
        automation,
        scheduling,
        ai,
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="card p-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--ink-900)' }}>Branding</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Wordmark</label><input className="input" value={wordmarkText} onChange={e => setWordmarkText(e.target.value)} /></div>
          <div>
            <label className="label">Font</label>
            <select className="input" value={fontFamily} onChange={e => setFontFamily(e.target.value as any)}>
              {(['inter','montserrat','manrope','plus-jakarta','dm-sans','system'] as const).map(f =>
                <option key={f} value={f}>{f}</option>
              )}
            </select>
          </div>
          <div className="md:col-span-2"><label className="label">Logo URL</label><input className="input" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} /></div>
          <div><label className="label">Favicon URL</label><input className="input" value={faviconUrl} onChange={e => setFaviconUrl(e.target.value)} /></div>
          <div><label className="label">App icon URL</label><input className="input" value={appIconUrl} onChange={e => setAppIconUrl(e.target.value)} /></div>
          <div>
            <label className="label">Corner style</label>
            <select className="input" value={cornerRadius} onChange={e => setCornerRadius(e.target.value as any)}>
              <option value="sharp">Sharp</option><option value="soft">Soft</option><option value="rounded">Rounded</option>
            </select>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Color tokens</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {([
              ['brand50','50'],['brand100','100'],['brand200','200'],['brand400','400'],['brand500','Primary'],
              ['brand600','600'],['brand700','700'],['brand900','900'],['accent','Accent'],['onBrand','On-brand text'],
            ] as const).map(([k, label]) => (
              <ColorField key={k} label={label} value={colors[k as keyof typeof colors]} onChange={v => setColors({ ...colors, [k]: v })} />
            ))}
          </div>
          <p className="help mt-2">
            Tip: keep brand500 as your dominant CTA color; brand100/200 are subtle tints; brand700/900 are dark backgrounds.
          </p>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--ink-900)' }}>Contact</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Public phone</label><input className="input" value={publicPhone} onChange={e => setPublicPhone(e.target.value)} /></div>
          <div><label className="label">Public email</label><input className="input" type="email" value={publicEmail} onChange={e => setPublicEmail(e.target.value)} /></div>
          <div className="md:col-span-2">
            <label className="label">Internal notification emails</label>
            <input className="input" value={notificationEmails} onChange={e => setNotificationEmails(e.target.value)} placeholder="ops@yourbiz.com, dispatch@yourbiz.com" />
            <div className="help">Comma-separated.</div>
          </div>
          <div><label className="label">From name (emails)</label><input className="input" value={emailFromName} onChange={e => setEmailFromName(e.target.value)} placeholder="Your Business" /></div>
          <div><label className="label">From address (emails)</label><input className="input" type="email" value={emailFromAddress} onChange={e => setEmailFromAddress(e.target.value)} placeholder="hello@yourbiz.com" /></div>
          <div><label className="label">SMS sender (E.164)</label><input className="input" value={smsNumber} onChange={e => setSmsNumber(e.target.value)} placeholder="+18015550100" /></div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--ink-900)' }}>Automation</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Toggle label="Send customer confirmation" v={automation.sendCustomerConfirmation} on={v => setAutomation({ ...automation, sendCustomerConfirmation: v })} />
          <Toggle label="Send admin notification" v={automation.sendAdminNotification} on={v => setAutomation({ ...automation, sendAdminNotification: v })} />
          <Toggle label="Follow up if no response" v={automation.sendFollowUpIfNoResponse} on={v => setAutomation({ ...automation, sendFollowUpIfNoResponse: v })} />
          <Toggle label="Review request after completion" v={automation.sendReviewRequestAfterCompletion} on={v => setAutomation({ ...automation, sendReviewRequestAfterCompletion: v })} />
          <div><label className="label">Follow up after (hours)</label>
            <input className="input" type="number" min={1} value={automation.followUpAfterHours}
              onChange={e => setAutomation({ ...automation, followUpAfterHours: Number(e.target.value) })} />
          </div>
          <div><label className="label">Review delay (hours)</label>
            <input className="input" type="number" min={0} value={automation.reviewRequestDelayHours}
              onChange={e => setAutomation({ ...automation, reviewRequestDelayHours: Number(e.target.value) })} />
          </div>
          <div><label className="label">Auto-expire estimates (days)</label>
            <input className="input" type="number" min={1} value={automation.autoExpireEstimatesDays}
              onChange={e => setAutomation({ ...automation, autoExpireEstimatesDays: Number(e.target.value) })} />
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--ink-900)' }}>Features</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <Toggle label="Residential customers" v={features.residentialEnabled} on={v => setFeatures({ ...features, residentialEnabled: v })} />
          <Toggle label="Commercial customers"  v={features.commercialEnabled}  on={v => setFeatures({ ...features, commercialEnabled: v })} />
          <Toggle label="Emergency requests"    v={features.emergencyRequests}  on={v => setFeatures({ ...features, emergencyRequests: v })} />
          <Toggle label="Public quote form"     v={features.publicQuoteFormEnabled} on={v => setFeatures({ ...features, publicQuoteFormEnabled: v })} />
          <Toggle label="Scheduling"            v={features.schedulingEnabled} on={v => setFeatures({ ...features, schedulingEnabled: v })} />
          <Toggle label="Reviews"               v={features.reviewsEnabled}    on={v => setFeatures({ ...features, reviewsEnabled: v })} />
          <Toggle label="Referrals"             v={features.referralsEnabled}  on={v => setFeatures({ ...features, referralsEnabled: v })} />
          <Toggle label="Recurring services"    v={features.recurringServicesEnabled} on={v => setFeatures({ ...features, recurringServicesEnabled: v })} />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--ink-900)' }}>Scheduling</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Timezone</label>
            <input className="input" value={scheduling.timezone} onChange={e => setScheduling({ ...scheduling, timezone: e.target.value })} placeholder="America/Denver" />
          </div>
          <div>
            <label className="label">Slot duration (min)</label>
            <input className="input" type="number" min={15} step={15} value={scheduling.slotDurationMinutes} onChange={e => setScheduling({ ...scheduling, slotDurationMinutes: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Booking lead time (hours)</label>
            <input className="input" type="number" min={0} value={scheduling.bookingLeadTimeHours} onChange={e => setScheduling({ ...scheduling, bookingLeadTimeHours: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Booking horizon (days)</label>
            <input className="input" type="number" min={1} value={scheduling.bookingHorizonDays} onChange={e => setScheduling({ ...scheduling, bookingHorizonDays: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Buffer between jobs (min)</label>
            <input className="input" type="number" min={0} step={5} value={scheduling.bufferMinutes} onChange={e => setScheduling({ ...scheduling, bufferMinutes: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Max concurrent jobs</label>
            <input className="input" type="number" min={1} value={scheduling.maxConcurrentJobs} onChange={e => setScheduling({ ...scheduling, maxConcurrentJobs: Number(e.target.value) })} />
          </div>
          <Toggle label="Emergency / after-hours available" v={scheduling.emergencyAvailable} on={v => setScheduling({ ...scheduling, emergencyAvailable: v })} />
        </div>

        <div className="mt-5">
          <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-500)' }}>Operating hours</div>
          <div className="grid md:grid-cols-2 gap-2">
            {(['mon','tue','wed','thu','fri','sat','sun'] as const).map(day => {
              const hours = scheduling.operatingHours[day];
              const closed = hours === 'closed' || !hours;
              return (
                <div key={day} className="flex items-center gap-3">
                  <span className="w-8 text-xs font-medium uppercase" style={{ color: 'var(--ink-500)' }}>{day}</span>
                  <input
                    type="checkbox"
                    checked={!closed}
                    onChange={e => setScheduling({ ...scheduling, operatingHours: { ...scheduling.operatingHours, [day]: e.target.checked ? { open: '08:00', close: '17:00' } : 'closed' } })}
                  />
                  {!closed && typeof hours === 'object' && (
                    <>
                      <input className="input py-1 w-24 text-sm" type="time" value={hours.open}  onChange={e => setScheduling({ ...scheduling, operatingHours: { ...scheduling.operatingHours, [day]: { ...(hours as any), open:  e.target.value } } })} />
                      <span className="text-xs" style={{ color: 'var(--ink-400)' }}>–</span>
                      <input className="input py-1 w-24 text-sm" type="time" value={hours.close} onChange={e => setScheduling({ ...scheduling, operatingHours: { ...scheduling.operatingHours, [day]: { ...(hours as any), close: e.target.value } } })} />
                    </>
                  )}
                  {closed && <span className="text-xs" style={{ color: 'var(--ink-400)' }}>Closed</span>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-1" style={{ color: 'var(--ink-900)' }}>AI assistants</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-500)' }}>Powered by Claude. Enable the master switch first, then turn on individual features.</p>
        <div className="grid md:grid-cols-2 gap-3">
          <Toggle label="Enable AI features" v={ai.enabled} on={v => setAi({ ...ai, enabled: v })} />
          <Toggle label="Quote assistant"      v={ai.quoteAssistant}      on={v => setAi({ ...ai, quoteAssistant: v })} />
          <Toggle label="Email drafting"       v={ai.emailAssistant}      on={v => setAi({ ...ai, emailAssistant: v })} />
          <Toggle label="Scheduling assistant" v={ai.schedulingAssistant} on={v => setAi({ ...ai, schedulingAssistant: v })} />
          <Toggle label="Business insights"    v={ai.businessInsights}    on={v => setAi({ ...ai, businessInsights: v })} />
          <Toggle label="Image analysis"       v={ai.imageAnalysis}       on={v => setAi({ ...ai, imageAnalysis: v })} />
        </div>
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Text model</label>
            <select className="input" value={ai.modelPreferences.text} onChange={e => setAi({ ...ai, modelPreferences: { ...ai.modelPreferences, text: e.target.value as any } })}>
              <option value="claude-haiku">Haiku (fastest, lowest cost)</option>
              <option value="claude-sonnet">Sonnet (balanced)</option>
              <option value="claude-opus">Opus (most capable)</option>
            </select>
          </div>
          <div>
            <label className="label">Vision model</label>
            <select className="input" value={ai.modelPreferences.vision} onChange={e => setAi({ ...ai, modelPreferences: { ...ai.modelPreferences, vision: e.target.value as any } })}>
              <option value="claude-sonnet">Sonnet</option>
              <option value="claude-opus">Opus</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Brand voice <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>(optional — guides tone in AI-drafted content)</span></label>
            <textarea className="input" rows={2} maxLength={2000} value={ai.brandVoice ?? ''} onChange={e => setAi({ ...ai, brandVoice: e.target.value })} placeholder="e.g. friendly but professional, avoids jargon, always solution-focused" />
          </div>
        </div>
      </section>

      {error && <div className="card p-3 text-sm" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>{error}</div>}
      {saved && <div className="text-sm" style={{ color: '#059669' }}>Saved. Browse a tenant page in another tab to see updates.</div>}

      <div className="flex justify-end gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input className="input flex-1 font-mono text-xs" value={value} onChange={e => onChange(e.target.value)} />
        <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 36, height: 36, borderRadius: 6, border: '1px solid var(--surface-200)' }} />
      </div>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-700)' }}>
      <input type="checkbox" checked={v} onChange={e => on(e.target.checked)} />
      {label}
    </label>
  );
}
