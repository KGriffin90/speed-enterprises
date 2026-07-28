'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPhone } from '@/lib/formatPhone';
import { api, ApiError } from '@/lib/api-client';
import type { Service, Question, PropertyKind, Industry } from '@speed-enterprises/shared';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

// sessionStorage key for an anonymous visitor's in-progress quote. The wizard
// stashes the completed draft here, sends them to sign-up, then resumes and
// submits it once they're verified and back on the (now-authed) quote page.
const QUOTE_DRAFT_KEY = 'tp_quote_draft';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrefillAddress { line1: string; city: string; state: string; postalCode: string }
interface Prefill {
  fullName?: string;
  email?: string;
  phone?: string;
  address?: PrefillAddress;
}

interface Props {
  tenantSlug: string;
  tenantName: string;
  service: Service;
  industry: Industry;
  residentialEnabled: boolean;
  commercialEnabled: boolean;
  isAuthed: boolean;
  prefill?: Prefill;
  /** True when returning from sign-up to auto-submit a saved anonymous draft. */
  resume?: boolean;
}

type Answers = Record<string, unknown>;
type StepId = 'property' | 'job' | 'contact';

interface QuoteDraft {
  tenantSlug: string;
  serviceSlug: string;
  propertyKind: PropertyKind;
  answers: Answers;
  address: { line1: string; city: string; state: string; postalCode: string; country?: string };
  notes: string;
  preferredAt: string;
  contact: { fullName: string; email: string; phone: string };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function QuoteWizard({
  tenantSlug,
  tenantName,
  service,
  industry,
  residentialEnabled,
  commercialEnabled,
  isAuthed,
  prefill,
  resume,
}: Props): JSX.Element {
  const router = useRouter();

  const showResidential = residentialEnabled && (service.category === 'RESIDENTIAL' || service.category === 'BOTH');
  const showCommercial  = commercialEnabled  && (service.category === 'COMMERCIAL'  || service.category === 'BOTH');
  const needsPropertyStep = showResidential && showCommercial;

  // Build ordered step list
  const steps: StepId[] = useMemo(
    () => [...(needsPropertyStep ? (['property'] as StepId[]) : []), 'job', 'contact'],
    [needsPropertyStep],
  );

  // Service-specific questions: prefer configured, fall back to industry defaults
  const configuredQuestions = useMemo(
    () => {
      const qs = service.questions.filter(q => !q.internal);
      // Window cleaning: surface the window-count question first (mirrors the
      // mobile quote flow), regardless of its position in the configured list.
      const i = qs.findIndex(q => q.type === 'number' && (q.id === 'window_count' || q.unit === 'windows'));
      if (i > 0) {
        const [countQ] = qs.splice(i, 1);
        if (countQ) qs.unshift(countQ);
      }
      return qs;
    },
    [service.questions],
  );
  const effectiveQuestions: Question[] = configuredQuestions.length > 0
    ? configuredQuestions
    : INDUSTRY_DEFAULT_QUESTIONS[industry] ?? GENERIC_DEFAULT_QUESTIONS;

  // ── State ──────────────────────────────────────────────────────────────────
  const [stepIndex, setStepIndex]   = useState(0);
  const [propertyKind, setPropertyKind] = useState<PropertyKind>(showResidential ? 'RESIDENTIAL' : 'COMMERCIAL');
  const [answers, setAnswers]       = useState<Answers>({});
  const [contact, setContact]       = useState({
    fullName: prefill?.fullName ?? '',
    email:    prefill?.email    ?? '',
    phone:    prefill?.phone    ?? '',
  });
  const [address, setAddress]       = useState({
    line1:      prefill?.address?.line1      ?? '',
    city:       prefill?.address?.city       ?? '',
    state:      prefill?.address?.state      ?? '',
    postalCode: prefill?.address?.postalCode ?? '',
  });
  const [notes, setNotes]           = useState('');
  const [preferredAt, setPreferredAt] = useState('');
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // One-time soft prompt shown when the customer leaves the job step without
  // attaching any photos. They can still continue — photos are optional.
  const [showPhotoNudge, setShowPhotoNudge] = useState(false);
  const [photoNudgeAck, setPhotoNudgeAck]   = useState(false);

  const currentStep = steps[stepIndex] as StepId;
  const isLastStep  = stepIndex === steps.length - 1;

  const visibleQuestions = useMemo(
    () => effectiveQuestions.filter(q => isVisible(q, answers)),
    [effectiveQuestions, answers],
  );

  // Photos are optional, but attaching at least one lets the business send an
  // instant quote. Detect when the job step offers photo questions yet none
  // have an upload.
  const photoQuestions = useMemo(
    () => visibleQuestions.filter(q => q.type === 'photo'),
    [visibleQuestions],
  );
  const hasAnyPhoto = photoQuestions.some(q => {
    const v = answers[q.id];
    return Array.isArray(v) && v.length > 0;
  });
  const shouldNudgeForPhotos = photoQuestions.length > 0 && !hasAnyPhoto;

  // ── Validation ─────────────────────────────────────────────────────────────
  function validateStep(step: StepId): Record<string, string> {
    const e: Record<string, string> = {};
    if (step === 'job') {
      for (const q of visibleQuestions) {
        if (q.required) {
          const v = answers[q.id];
          if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
            e[q.id] = `${q.label} is required`;
          }
        }
      }
    }
    if (step === 'contact') {
      if (!contact.fullName.trim())                    e['contact.fullName']    = 'Full name is required';
      if (!/.+@.+\..+/.test(contact.email))            e['contact.email']       = 'Valid email is required';
      if (!contact.phone.trim())                        e['contact.phone']       = 'Phone number is required';
      if (!address.line1.trim())                        e['address.line1']       = 'Street address is required';
      if (!address.city.trim())                         e['address.city']        = 'City is required';
      if (!/^[A-Za-z]{2}$/.test(address.state))        e['address.state']       = '2-letter state code (e.g. CA)';
      if (!address.postalCode.trim())                   e['address.postalCode']  = 'ZIP / postal code is required';
    }
    return e;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function advance() {
    if (isLastStep) { void doSubmit(); } else { setStepIndex(i => i + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  function goNext() {
    const e = validateStep(currentStep);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setErrors({});
    // Prompt once (per session) before leaving the job step with no photos.
    if (currentStep === 'job' && shouldNudgeForPhotos && !photoNudgeAck) {
      setShowPhotoNudge(true);
      return;
    }
    advance();
  }

  function continueWithoutPhotos() {
    setPhotoNudgeAck(true);
    setShowPhotoNudge(false);
    advance();
  }

  function goBack() {
    setErrors({});
    setStepIndex(i => i - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  // Create the quote against the signed-in customer's account, then submit it so
  // the tenant is notified. Shared by the normal authed submit and by the resume
  // path after an anonymous visitor signs up.
  async function submitAuthed(p: {
    propertyKind: PropertyKind;
    address: { line1: string; city: string; state: string; postalCode: string; country?: string };
    answers: Answers;
    customerNotes?: string;
    preferredAt?: string;
  }) {
    const created = await api<{ id: string }>('POST', '/api/quotes', {
      serviceId:    service.id,
      propertyKind: p.propertyKind,
      address:      { ...p.address, country: p.address.country ?? 'US' },
      answers:      p.answers,
      customerNotes: p.customerNotes,
      preferredAt:  p.preferredAt,
    });
    await api('POST', `/api/quotes/${created.id}/submit`, {});
    router.push(`/quote/thanks?id=${encodeURIComponent(created.id)}`);
  }

  async function doSubmit() {
    setSubmitting(true);
    setServerError(null);
    const fullAddress = { ...address, state: address.state.toUpperCase(), country: 'US' };
    try {
      if (isAuthed) {
        await submitAuthed({ propertyKind, address: fullAddress, answers, customerNotes: notes || undefined, preferredAt: preferredAt || undefined });
        return;
      }
      // Anonymous: the customer has completed the ENTIRE quote. Stash it, send
      // them to create an account, then resume + submit once they're verified.
      // Account creation is the gate at SUBMISSION — never before the wizard.
      const draft: QuoteDraft = {
        tenantSlug, serviceSlug: service.slug, propertyKind,
        answers, address: fullAddress, notes, preferredAt, contact,
      };
      try { sessionStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode */ }
      // Carry the contact details forward so the sign-up form is prefilled and
      // the customer only has to set a password.
      const params = new URLSearchParams({ tenant: tenantSlug, next: `/quote/${service.slug}?resume=1` });
      if (contact.fullName) params.set('name', contact.fullName);
      if (contact.email)    params.set('email', contact.email);
      if (contact.phone)    params.set('phone', contact.phone);
      router.push(`/auth/sign-up?${params.toString()}`);
    } catch (err: any) {
      setServerError(err instanceof ApiError ? err.message : (err?.message ?? 'Network error. Please try again.'));
      setSubmitting(false);
    }
  }

  // Resume after sign-up: returning here authenticated with ?resume=1, restore
  // the saved draft and submit it automatically. On failure, hydrate the form
  // (last step) so the customer can review and resubmit.
  useEffect(() => {
    if (!resume || !isAuthed) return;
    let draft: QuoteDraft | null = null;
    try {
      const raw = sessionStorage.getItem(QUOTE_DRAFT_KEY);
      if (raw) draft = JSON.parse(raw) as QuoteDraft;
    } catch { /* ignore */ }
    if (!draft || draft.serviceSlug !== service.slug) return;
    const d = draft;
    try { sessionStorage.removeItem(QUOTE_DRAFT_KEY); } catch { /* ignore */ }
    setSubmitting(true);
    void submitAuthed({ propertyKind: d.propertyKind, address: d.address, answers: d.answers, customerNotes: d.notes || undefined, preferredAt: d.preferredAt || undefined })
      .catch((err: any) => {
        setServerError(err instanceof ApiError ? err.message : (err?.message ?? 'Could not submit your saved quote — please review and submit again.'));
        setAnswers(d.answers);
        setPropertyKind(d.propertyKind);
        setAddress({ line1: d.address.line1, city: d.address.city, state: d.address.state, postalCode: d.address.postalCode });
        setNotes(d.notes);
        setPreferredAt(d.preferredAt ?? '');
        setStepIndex(steps.length - 1);
        setSubmitting(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function setAnswer(qid: string, v: unknown) {
    setAnswers(a => ({ ...a, [qid]: v }));
    setErrors(e => { const n = { ...e }; delete n[qid]; return n; });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const STEP_LABELS: Record<StepId, string> = {
    property: 'Property type',
    job:      'About the job',
    contact:  'Your details',
  };

  return (
    <div className="mt-8">

      {/* ── Progress indicator ── */}
      <div className="mb-8">
        <div className="flex items-center gap-0">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              {/* Dot */}
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    background: i <= stepIndex ? 'var(--brand-500)' : 'var(--surface-200)',
                    color:      i <= stepIndex ? 'var(--on-brand)'  : 'var(--ink-400)',
                  }}
                >
                  {i < stepIndex ? <CheckmarkIcon /> : i + 1}
                </div>
                <span
                  className="text-xs font-medium whitespace-nowrap hidden sm:block"
                  style={{ color: i === stepIndex ? 'var(--brand-600)' : 'var(--ink-400)' }}
                >
                  {STEP_LABELS[s]}
                </span>
              </div>
              {/* Connector */}
              {i < steps.length - 1 && (
                <div
                  className="flex-1 h-0.5 mx-2 mb-5 transition-all"
                  style={{ background: i < stepIndex ? 'var(--brand-500)' : 'var(--surface-200)' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step content ── */}
      <div className="card p-6 md:p-8">

        {/* Property step */}
        {currentStep === 'property' && (
          <PropertyStep
            showResidential={showResidential}
            showCommercial={showCommercial}
            value={propertyKind}
            onChange={setPropertyKind}
          />
        )}

        {/* Job step */}
        {currentStep === 'job' && (
          <JobStep
            service={service}
            questions={visibleQuestions}
            answers={answers}
            errors={errors}
            notes={notes}
            onChange={setAnswer}
            onNotes={setNotes}
          />
        )}

        {/* Contact step */}
        {currentStep === 'contact' && (
          <ContactStep
            contact={contact}
            address={address}
            errors={errors}
            preferredAt={preferredAt}
            onContact={setContact}
            onAddress={setAddress}
            onPreferredAt={setPreferredAt}
          />
        )}

        {/* Server error */}
        {serverError && (
          <div className="mt-5 rounded-xl p-4 text-sm"
            style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {serverError}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between gap-4">
          {stepIndex > 0
            ? (
              <button
                type="button"
                onClick={goBack}
                className="btn-secondary py-2.5 px-5 text-sm"
              >
                ← Back
              </button>
            )
            : <span />
          }

          <div className="flex items-center gap-3">
            <span className="text-xs hidden sm:block" style={{ color: 'var(--ink-400)' }}>
              Step {stepIndex + 1} of {steps.length}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={submitting}
              className="btn-primary py-2.5 px-7"
            >
              {submitting ? 'Submitting…' : isLastStep ? (isAuthed ? 'Submit request' : 'Create account & submit') : 'Continue →'}
            </button>
          </div>
        </div>
      </div>

      {/* Consent note — only on last step */}
      {isLastStep && (
        <p className="mt-4 text-xs text-center" style={{ color: 'var(--ink-400)' }}>
          {isAuthed
            ? `By submitting you agree to be contacted by ${tenantName} regarding your service request.`
            : `Next, create a quick account to send your request — we’ll save everything you entered. By submitting you agree to be contacted by ${tenantName} regarding your service request.`}
        </p>
      )}

      {/* Optional-photos prompt: photos aren't required, but they enable an
          instant quote. Dismissing or clicking the backdrop keeps the customer
          on the job step; "Continue without photos" proceeds anyway. */}
      {showPhotoNudge && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.55)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="photo-nudge-title"
          onClick={() => setShowPhotoNudge(false)}
        >
          <div className="card p-6 md:p-7 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="text-3xl mb-2" aria-hidden>📸</div>
            <h3 id="photo-nudge-title" className="text-lg font-bold" style={{ color: 'var(--ink-900)' }}>
              Add photos for an instant quote?
            </h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-500)' }}>
              Photos aren’t required — but adding a few greatly speeds things up. With
              them we can often send your quote instantly, so you don’t have to wait or
              talk to anyone to get your price.
            </p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
              <button
                type="button"
                className="btn-secondary flex-1 py-2.5"
                onClick={continueWithoutPhotos}
              >
                Continue without photos
              </button>
              <button
                type="button"
                className="btn-primary flex-1 py-2.5"
                onClick={() => setShowPhotoNudge(false)}
              >
                Add photos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step: Property type ───────────────────────────────────────────────────────

function PropertyStep({
  showResidential, showCommercial, value, onChange,
}: {
  showResidential: boolean; showCommercial: boolean;
  value: PropertyKind; onChange: (v: PropertyKind) => void;
}): JSX.Element {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--ink-900)' }}>
        What type of property?
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        This helps us send the right crew and equipment.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {showResidential && (
          <PropertyCard
            selected={value === 'RESIDENTIAL'}
            onClick={() => onChange('RESIDENTIAL')}
            icon="🏠"
            title="Residential"
            sub="My home or apartment"
          />
        )}
        {showCommercial && (
          <PropertyCard
            selected={value === 'COMMERCIAL'}
            onClick={() => onChange('COMMERCIAL')}
            icon="🏢"
            title="Commercial"
            sub="Office, retail, or other business"
          />
        )}
      </div>
    </div>
  );
}

function PropertyCard({ selected, onClick, icon, title, sub }: {
  selected: boolean; onClick: () => void;
  icon: string; title: string; sub: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl p-5 text-left transition-all border-2"
      style={{
        background:    selected ? 'color-mix(in srgb, var(--brand-500) 8%, var(--surface-0))' : 'var(--surface-50)',
        borderColor:   selected ? 'var(--brand-500)' : 'var(--surface-200)',
        boxShadow:     selected ? '0 0 0 4px color-mix(in srgb, var(--brand-500) 12%, transparent)' : 'none',
      }}
    >
      <div className="text-3xl mb-3">{icon}</div>
      <div className="font-bold text-base" style={{ color: 'var(--ink-900)' }}>{title}</div>
      <div className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>{sub}</div>
    </button>
  );
}

// ── Step: Job details ─────────────────────────────────────────────────────────

function JobStep({ service, questions, answers, errors, notes, onChange, onNotes }: {
  service: Service;
  questions: Question[];
  answers: Answers;
  errors: Record<string, string>;
  notes: string;
  onChange: (qid: string, v: unknown) => void;
  onNotes: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--ink-900)' }}>
        Tell us about the job
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        The more detail you provide, the more accurate your estimate will be.
      </p>

      {questions.length > 0 ? (
        <div className="space-y-6">
          {questions.map(q => (
            <QuestionField
              key={q.id}
              q={q}
              value={answers[q.id]}
              onChange={v => onChange(q.id, v)}
              error={errors[q.id]}
            />
          ))}
        </div>
      ) : (
        <div>
          <label className="label">Describe what you need done <span style={{ color: 'var(--brand-500)' }}>*</span></label>
          <textarea
            className="input"
            rows={5}
            placeholder={`Tell us about your ${service.name.toLowerCase()} needs…`}
            value={notes}
            onChange={e => onNotes(e.target.value)}
          />
        </div>
      )}

      {/* Additional notes at the bottom of the job step when questions exist */}
      {questions.length > 0 && (
        <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--surface-200)' }}>
          <label className="label">Any additional notes?</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Anything else we should know before preparing your estimate…"
            value={notes}
            onChange={e => onNotes(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

// ── Step: Contact + address ────────────────────────────────────────────────────

function ContactStep({ contact, address, errors, preferredAt, onContact, onAddress, onPreferredAt }: {
  contact: { fullName: string; email: string; phone: string };
  address: { line1: string; city: string; state: string; postalCode: string };
  errors: Record<string, string>;
  preferredAt: string;
  onContact: (c: typeof contact) => void;
  onAddress: (a: typeof address) => void;
  onPreferredAt: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--ink-900)' }}>
        Your details
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        We'll send your estimate here and use the address to schedule service.
      </p>

      {/* Contact fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full name" required error={errors['contact.fullName']}>
          <input
            className="input"
            autoComplete="name"
            value={contact.fullName}
            onChange={e => onContact({ ...contact, fullName: e.target.value })}
          />
        </Field>
        <Field label="Phone number" required error={errors['contact.phone']}>
          <input
            className="input"
            type="tel"
            autoComplete="tel"
            placeholder="(555) 000-0000"
            value={contact.phone}
            onChange={e => onContact({ ...contact, phone: e.target.value })}
            onBlur={e => onContact({ ...contact, phone: formatPhone(e.target.value) })}
          />
        </Field>
        <Field label="Email address" required error={errors['contact.email']} className="md:col-span-2">
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={contact.email}
            onChange={e => onContact({ ...contact, email: e.target.value })}
          />
        </Field>
      </div>

      {/* Address */}
      <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--surface-200)' }}>
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-700)' }}>Service address</p>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <Field label="Street address" required error={errors['address.line1']} className="md:col-span-6">
            <input
              className="input"
              autoComplete="street-address"
              value={address.line1}
              onChange={e => onAddress({ ...address, line1: e.target.value })}
            />
          </Field>
          <Field label="City" required error={errors['address.city']} className="md:col-span-3">
            <input
              className="input"
              autoComplete="address-level2"
              value={address.city}
              onChange={e => onAddress({ ...address, city: e.target.value })}
            />
          </Field>
          <Field label="State" required error={errors['address.state']} className="md:col-span-1">
            <input
              className="input"
              autoComplete="address-level1"
              maxLength={2}
              placeholder="CA"
              value={address.state}
              onChange={e => onAddress({ ...address, state: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="ZIP code" required error={errors['address.postalCode']} className="md:col-span-2">
            <input
              className="input"
              autoComplete="postal-code"
              value={address.postalCode}
              onChange={e => onAddress({ ...address, postalCode: e.target.value })}
            />
          </Field>
        </div>
      </div>

      {/* Preferred time — free text; the business uses it to schedule. */}
      <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--surface-200)' }}>
        <Field label="Preferred time (optional)">
          <input
            className="input"
            placeholder="e.g. Weekday mornings, or after 3pm on Fridays"
            value={preferredAt}
            onChange={e => onPreferredAt(e.target.value)}
          />
          <p className="text-xs mt-1.5" style={{ color: 'var(--ink-500)' }}>
            Let us know when works best — we&apos;ll do our best to match it.
          </p>
        </Field>
      </div>
    </div>
  );
}

// ── Shared field wrapper ──────────────────────────────────────────────────────

function Field({
  label, required, error, className, children,
}: {
  label: string; required?: boolean; error?: string; className?: string; children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={className}>
      <label className="label">
        {label}{required && <span style={{ color: 'var(--brand-500)' }}> *</span>}
      </label>
      {children}
      {error && <div className="text-xs mt-1.5 font-medium" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  );
}

// ── Question renderer ─────────────────────────────────────────────────────────

function QuestionField({ q, value, onChange, error }: {
  q: Question; value: unknown; onChange: (v: unknown) => void; error?: string;
}): JSX.Element {
  return (
    <Field label={q.label + (q.unit ? ` (${q.unit})` : '')} required={q.required} error={error}>
      {renderInput(q, value, onChange)}
      {q.helpText && <div className="help mt-1.5">{q.helpText}</div>}
    </Field>
  );
}

function renderInput(q: Question, value: unknown, onChange: (v: unknown) => void): React.ReactNode {
  switch (q.type) {
    case 'text':
    case 'address':
      return <input className="input" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} placeholder={q.placeholder} />;

    case 'longtext':
      return <textarea className="input" rows={4} value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} placeholder={q.placeholder} />;

    case 'number':
    case 'currency':
    case 'rating':
      return (
        <input className="input" type="number" min={q.min} max={q.max} step={q.step}
          value={(value as number | undefined) ?? ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder={q.placeholder}
        />
      );

    case 'boolean':
      return (
        <div className="flex gap-3">
          <ChoiceBtn selected={value === true}  onClick={() => onChange(value === true ? undefined : true)}   label="Yes" />
          <ChoiceBtn selected={value === false} onClick={() => onChange(value === false ? undefined : false)} label="No" />
        </div>
      );

    case 'select':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {q.options?.map(o => (
            <ChoiceBtn key={o.value} selected={value === o.value} onClick={() => onChange(value === o.value ? undefined : o.value)} label={o.label} />
          ))}
        </div>
      );

    case 'multiselect': {
      const list = (value as string[]) ?? [];
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {q.options?.map(o => (
            <ChoiceBtn
              key={o.value}
              selected={list.includes(o.value)}
              onClick={() => onChange(list.includes(o.value) ? list.filter(x => x !== o.value) : [...list, o.value])}
              label={o.label}
            />
          ))}
        </div>
      );
    }

    case 'date':
      return <input className="input" type="date" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />;

    case 'time':
      return <input className="input" type="time" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />;

    case 'photo':
    case 'video':
    case 'file':
      return <FileUploadField q={q} value={value as UploadedFileRef[] | undefined} onChange={onChange as (v: UploadedFileRef[]) => void} />;

    case 'measurement':
      return (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--surface-100)', color: 'var(--ink-500)' }}>
          AR measurement is available in the mobile app. Attach photos instead using the question below.
        </div>
      );

    default:
      return <input className="input" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />;
  }
}

function ChoiceBtn({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-4 py-3 text-sm font-medium text-left transition-all border-2"
      style={{
        background:  selected ? 'color-mix(in srgb, var(--brand-500) 8%, var(--surface-0))' : 'var(--surface-50)',
        borderColor: selected ? 'var(--brand-500)' : 'var(--surface-200)',
        color:       selected ? 'var(--brand-700)' : 'var(--ink-700)',
      }}
    >
      {label}
    </button>
  );
}

// ── File upload ───────────────────────────────────────────────────────────────

interface UploadedFileRef { imageId: string; mimeType: string; filename: string }

function FileUploadField({ q, value, onChange }: {
  q: Question; value?: UploadedFileRef[]; onChange: (v: UploadedFileRef[]) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = value ?? [];
  const maxFiles = q.maxFiles ?? 6;
  const accept = q.acceptedMimeTypes?.join(',') ?? (
    q.type === 'photo' ? 'image/jpeg,image/png,image/heic,image/webp,video/mp4,video/quicktime'
    : q.type === 'video' ? 'video/mp4,video/quicktime'
    : 'image/jpeg,image/png,application/pdf'
  );

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (items.length + files.length > maxFiles) { setError(`Max ${maxFiles} files.`); return; }
    setBusy(true); setError(null);
    try {
      const tenantSlug = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('tenant_slug='))?.split('=')[1] ?? '';
      const uploaded: UploadedFileRef[] = [];
      for (const f of files) {
        const presign = await fetch(`${API_ORIGIN}/api/public/uploads/presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenantSlug },
          body: JSON.stringify({ filename: f.name, mimeType: f.type || 'application/octet-stream', byteSize: f.size }),
        });
        if (!presign.ok) throw new Error('Upload auth failed');
        const { imageId, method, uploadUrl, headers } = await presign.json();
        const put = await fetch(uploadUrl, { method, headers: new Headers(headers), body: f });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        uploaded.push({ imageId, mimeType: f.type, filename: f.name });
      }
      onChange([...items, ...uploaded]);
      e.target.value = '';
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="btn-secondary cursor-pointer text-sm py-2 px-4">
          <input type="file" multiple accept={accept} className="hidden" onChange={onPick} disabled={busy || items.length >= maxFiles} />
          {busy ? 'Uploading…' : items.length === 0 ? `Attach ${q.type === 'video' ? 'videos' : q.type === 'photo' ? 'photos or video' : 'files'}` : 'Add more'}
        </label>
        <span className="text-xs" style={{ color: 'var(--ink-400)' }}>{items.length}/{maxFiles} files</span>
      </div>
      {error && <div className="text-xs" style={{ color: '#dc2626' }}>{error}</div>}
      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((it, i) => (
            <li key={it.imageId} className="card p-2 text-xs flex items-center justify-between gap-1" style={{ color: 'var(--ink-700)' }}>
              <span className="truncate">{it.filename}</span>
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label="Remove" style={{ color: 'var(--ink-400)', flexShrink: 0 }}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckmarkIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6l3 3 5-5"/>
    </svg>
  );
}

// ── Conditional visibility ────────────────────────────────────────────────────

function isVisible(q: Question, answers: Answers): boolean {
  if (!q.conditional) return true;
  const all = q.conditional.all?.every(c => evalCond(c, answers)) ?? true;
  const any = q.conditional.any?.some(c => evalCond(c, answers))  ?? true;
  return all && any;
}

function evalCond(c: { questionId: string; op: string; value?: unknown }, a: Answers): boolean {
  const v = a[c.questionId];
  switch (c.op) {
    case 'eq':     return v === c.value;
    case 'neq':    return v !== c.value;
    case 'gt':     return Number(v) >  Number(c.value);
    case 'gte':    return Number(v) >= Number(c.value);
    case 'lt':     return Number(v) <  Number(c.value);
    case 'lte':    return Number(v) <= Number(c.value);
    case 'in':     return Array.isArray(c.value) && (c.value as unknown[]).includes(v);
    case 'nin':    return Array.isArray(c.value) && !(c.value as unknown[]).includes(v);
    case 'truthy': return Boolean(v);
    case 'falsy':  return !v;
    default:       return true;
  }
}

// ── Industry-specific default questions ──────────────────────────────────────
// Used only when a service has no questions configured by the admin.
// These give the wizard a sensible, trade-specific feel out of the box.

type Q = Question; // alias for brevity

function opt(value: string, label: string) { return { value, label }; }

function sel(id: string, label: string, options: ReturnType<typeof opt>[], required = true): Q {
  return { id, label, type: 'select', required, options, helpText: undefined, placeholder: undefined,
    defaultValue: undefined, min: undefined, max: undefined, step: undefined, unit: undefined,
    maxFiles: undefined, acceptedMimeTypes: undefined, conditional: undefined,
    affectsPricing: false, internal: false };
}

function num(id: string, label: string, required = false, unit?: string): Q {
  return { id, label, type: 'number', required, unit, helpText: undefined, placeholder: undefined,
    defaultValue: undefined, options: undefined, min: 0, max: undefined, step: 1,
    maxFiles: undefined, acceptedMimeTypes: undefined, conditional: undefined,
    affectsPricing: false, internal: false };
}

function txt(id: string, label: string, required = false, placeholder?: string): Q {
  return { id, label, type: 'longtext', required, placeholder, helpText: undefined,
    defaultValue: undefined, options: undefined, min: undefined, max: undefined, step: undefined,
    unit: undefined, maxFiles: undefined, acceptedMimeTypes: undefined, conditional: undefined,
    affectsPricing: false, internal: false };
}

function bool(id: string, label: string): Q {
  return { id, label, type: 'boolean', required: false, helpText: undefined, placeholder: undefined,
    defaultValue: undefined, options: undefined, min: undefined, max: undefined, step: undefined,
    unit: undefined, maxFiles: undefined, acceptedMimeTypes: undefined, conditional: undefined,
    affectsPricing: false, internal: false };
}

function photo(id: string, label: string): Q {
  return { id, label, type: 'photo', required: false, maxFiles: 6,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'],
    helpText: 'Clear photos help us give you the most accurate estimate.',
    placeholder: undefined, defaultValue: undefined, options: undefined,
    min: undefined, max: undefined, step: undefined, unit: undefined,
    conditional: undefined, affectsPricing: false, internal: false };
}

const INDUSTRY_DEFAULT_QUESTIONS: Partial<Record<Industry, Q[]>> = {

  WINDOW_CLEANING: [
    sel('wc_service_type',  'What type of window cleaning?', [
      opt('exterior',  'Exterior only'),
      opt('interior',  'Interior only'),
      opt('both',      'Interior & exterior'),
    ]),
    sel('wc_stories',       'How many stories is the building?', [
      opt('1',  '1 story'),
      opt('2',  '2 stories'),
      opt('3',  '3 stories'),
      opt('4+', '4+ stories'),
    ]),
    num('wc_window_count', 'Approximate number of windows', false, 'windows'),
    bool('wc_hard_water',   'Any hard water stains or mineral deposits?'),
    bool('wc_screens',      'Do windows have screens to be cleaned?'),
    photo('wc_photos',      'Photos of the property (optional)'),
  ],

  HVAC: [
    sel('hvac_service', 'What type of HVAC service?', [
      opt('repair',    'Repair — unit not working correctly'),
      opt('install',   'New unit installation'),
      opt('tune_up',   'Tune-up / maintenance'),
      opt('inspect',   'Inspection / diagnostics'),
    ]),
    sel('hvac_unit_type', 'Type of unit', [
      opt('central_ac',  'Central air conditioning'),
      opt('heat_pump',   'Heat pump'),
      opt('furnace',     'Furnace / heating'),
      opt('ductless',    'Ductless mini-split'),
      opt('other',       'Other / not sure'),
    ]),
    sel('hvac_age', 'Approximate age of the unit', [
      opt('unknown',  'Unknown'),
      opt('under5',   'Under 5 years'),
      opt('5_10',     '5–10 years'),
      opt('10_15',    '10–15 years'),
      opt('over15',   'Over 15 years'),
    ]),
    txt('hvac_issue', 'Describe the issue or work needed', true, 'E.g. "AC not cooling, makes a grinding noise when it starts…"'),
    photo('hvac_photos', 'Photos of the unit or affected area (optional)'),
  ],

  PLUMBING: [
    sel('plmb_work_type', 'What type of plumbing work?', [
      opt('leak',       'Leak repair'),
      opt('clog',       'Drain or sewer clog'),
      opt('install',    'New fixture installation'),
      opt('water_htr',  'Water heater'),
      opt('pipes',      'Pipe repair or replacement'),
      opt('other',      'Other'),
    ]),
    sel('plmb_location', 'Where is the issue?', [
      opt('kitchen',    'Kitchen'),
      opt('bathroom',   'Bathroom'),
      opt('basement',   'Basement / utility room'),
      opt('outdoor',    'Outdoors / yard'),
      opt('whole_home', 'Whole home / multiple areas'),
    ]),
    sel('plmb_urgency', 'How urgent is this?', [
      opt('emergency',  'Emergency — flooding or no water'),
      opt('urgent',     'Urgent — within 24 hours'),
      opt('soon',       'Within the week'),
      opt('flexible',   'Flexible, no rush'),
    ]),
    txt('plmb_desc', 'Describe the issue', true, 'E.g. "Kitchen sink drain is completely blocked, garbage disposal still works…"'),
    photo('plmb_photos', 'Photos of the problem area (strongly recommended)'),
  ],

  ELECTRICAL: [
    sel('elec_work', 'What electrical work do you need?', [
      opt('panel',    'Panel / breaker box upgrade'),
      opt('outlet',   'Outlets or switches'),
      opt('lighting', 'Lighting installation'),
      opt('fan',      'Ceiling fan'),
      opt('ev',       'EV charger installation'),
      opt('inspect',  'Safety inspection'),
      opt('other',    'Other'),
    ]),
    bool('elec_emergency', 'Is this an emergency (no power, sparks, burning smell)?'),
    sel('elec_property_type', 'Property type', [
      opt('residential', 'Residential home'),
      opt('condo',       'Condo / apartment'),
      opt('commercial',  'Commercial building'),
    ]),
    txt('elec_desc', 'Describe the work needed', true, 'E.g. "Need 3 outlets added to garage, one GFCI near water source…"'),
    photo('elec_photos', 'Photos (optional)'),
  ],

  LANDSCAPING: [
    sel('land_service', 'What landscaping service?', [
      opt('mowing',     'Lawn mowing'),
      opt('design',     'Landscaping design & install'),
      opt('trees',      'Tree trimming / removal'),
      opt('irrigation', 'Irrigation / sprinklers'),
      opt('sod',        'Sod / seeding'),
      opt('cleanup',    'Yard clean-up / haul-away'),
    ]),
    sel('land_size', 'Approximate property size', [
      opt('small',  'Small — under ¼ acre'),
      opt('medium', 'Medium — ¼ to ½ acre'),
      opt('large',  'Large — ½ to 1 acre'),
      opt('xlarge', 'Very large — 1+ acres'),
    ]),
    sel('land_freq', 'How often do you need service?', [
      opt('once',      'One-time'),
      opt('weekly',    'Weekly'),
      opt('biweekly',  'Every two weeks'),
      opt('monthly',   'Monthly'),
    ]),
    txt('land_desc', 'Describe the work', false, 'E.g. "Backyard overgrown, needs full clean-up and re-seeding…"'),
    photo('land_photos', 'Photos of the yard (recommended)'),
  ],

  CLEANING: [
    sel('clean_type', 'Type of cleaning', [
      opt('standard',     'Standard clean'),
      opt('deep',         'Deep clean'),
      opt('move_in_out',  'Move-in / move-out'),
      opt('post_const',   'Post-construction'),
      opt('commercial',   'Commercial space'),
    ]),
    sel('clean_freq', 'How often?', [
      opt('once',      'One-time'),
      opt('weekly',    'Weekly'),
      opt('biweekly',  'Bi-weekly'),
      opt('monthly',   'Monthly'),
    ]),
    sel('clean_bedrooms', 'Number of bedrooms', [
      opt('studio', 'Studio / 0 BR'),
      opt('1',      '1 bedroom'),
      opt('2',      '2 bedrooms'),
      opt('3',      '3 bedrooms'),
      opt('4',      '4 bedrooms'),
      opt('5plus',  '5+ bedrooms'),
    ]),
    num('clean_bathrooms', 'Number of bathrooms', false, 'bathrooms'),
    num('clean_sqft',      'Approximate square footage', false, 'sq ft'),
    txt('clean_notes',     'Any special requirements?', false, 'E.g. "Pets in home, focus on kitchen and master bath…"'),
  ],

  ROOFING: [
    sel('roof_service', 'Type of roofing service', [
      opt('repair',   'Repair — leak or damage'),
      opt('replace',  'Full replacement'),
      opt('inspect',  'Inspection'),
      opt('gutters',  'Gutter cleaning / repair'),
      opt('new',      'New construction / addition'),
    ]),
    sel('roof_material', 'Roof material (if known)', [
      opt('asphalt',  'Asphalt shingles'),
      opt('metal',    'Metal roofing'),
      opt('tile',     'Tile or slate'),
      opt('flat',     'Flat / TPO / modified bitumen'),
      opt('wood',     'Wood shake'),
      opt('unknown',  'Unknown'),
    ]),
    sel('roof_age', 'Approximate roof age', [
      opt('under5',   'Under 5 years'),
      opt('5_15',     '5–15 years'),
      opt('15_25',    '15–25 years'),
      opt('over25',   'Over 25 years'),
      opt('unknown',  'Unknown'),
    ]),
    txt('roof_desc',   'Describe the issue or scope of work', true, 'E.g. "Missing shingles after storm, small leak in master bedroom ceiling…"'),
    photo('roof_photos', 'Photos of roof or damage (strongly recommended)'),
  ],

  PAINTING: [
    sel('paint_type', 'Interior or exterior?', [
      opt('interior',   'Interior'),
      opt('exterior',   'Exterior'),
      opt('both',       'Both'),
    ]),
    sel('paint_scope', 'Scope of work', [
      opt('whole_home', 'Entire home'),
      opt('rooms',      'Specific rooms'),
      opt('trim',       'Trim, doors, or accents only'),
      opt('deck',       'Deck, fence, or exterior wood'),
    ]),
    num('paint_sqft',  'Approximate square footage', false, 'sq ft'),
    bool('paint_prep', 'Does the surface need preparation (scraping, sanding, patching)?'),
    txt('paint_colors', 'Color preferences or brand', false, 'E.g. "Benjamin Moore Chantilly Lace for walls, Sherwin-Williams Repose Gray trim…"'),
    photo('paint_photos', 'Photos of the area (helpful)'),
  ],

  PEST_CONTROL: [
    sel('pest_type', 'What type of pest?', [
      opt('rodents',   'Rodents (mice / rats)'),
      opt('ants',      'Ants'),
      opt('roaches',   'Cockroaches'),
      opt('termites',  'Termites'),
      opt('bed_bugs',  'Bed bugs'),
      opt('wasps',     'Wasps / bees'),
      opt('general',   'General pest control'),
    ]),
    sel('pest_severity', 'Severity', [
      opt('minor',    'Minor — occasional sightings'),
      opt('moderate', 'Moderate — regular sightings'),
      opt('severe',   'Severe — clear infestation'),
    ]),
    sel('pest_freq', 'Treatment frequency desired', [
      opt('once',      'One-time treatment'),
      opt('monthly',   'Monthly'),
      opt('quarterly', 'Quarterly'),
      opt('annual',    'Annual'),
    ]),
    txt('pest_notes', 'Any additional details', false, 'E.g. "Found droppings in kitchen cabinets and garage…"'),
    photo('pest_photos', 'Photos (optional)'),
  ],

  HANDYMAN: [
    sel('hmn_type', 'Type of work', [
      opt('assembly',    'Furniture / fixture assembly'),
      opt('drywall',     'Drywall repair / patching'),
      opt('doors',       'Door / window repair'),
      opt('plumbing',    'Minor plumbing (no permit needed)'),
      opt('electrical',  'Minor electrical (no permit needed)'),
      opt('paint',       'Painting touch-up'),
      opt('other',       'Other — describe below'),
    ]),
    sel('hmn_duration', 'Estimated time needed', [
      opt('under1',  'Less than 1 hour'),
      opt('1_3',     '1–3 hours'),
      opt('3_8',     '3–8 hours (full day)'),
      opt('multi',   'Multiple days'),
    ]),
    txt('hmn_desc', 'Describe what needs to be done', true, 'Be as specific as possible — include measurements if you have them'),
    photo('hmn_photos', 'Photos (recommended)'),
  ],

  GENERAL_CONTRACTING: [
    sel('gc_project', 'Type of project', [
      opt('kitchen',    'Kitchen remodel'),
      opt('bathroom',   'Bathroom remodel'),
      opt('addition',   'Home addition'),
      opt('basement',   'Basement finish'),
      opt('deck',       'Deck / patio'),
      opt('new_const',  'New construction'),
      opt('other',      'Other'),
    ]),
    sel('gc_scope', 'Project budget range', [
      opt('small',   'Under $10,000'),
      opt('medium',  '$10,000 – $50,000'),
      opt('large',   '$50,000 – $100,000'),
      opt('major',   'Over $100,000'),
      opt('unsure',  'Not sure yet'),
    ]),
    sel('gc_timeline', 'Desired start timeline', [
      opt('asap',    'As soon as possible'),
      opt('3mo',     'Within 3 months'),
      opt('6mo',     '3–6 months'),
      opt('over6',   '6+ months out'),
      opt('flexible','Flexible'),
    ]),
    txt('gc_desc', 'Describe your project', true, 'Include key requirements, desired materials, or design ideas…'),
    photo('gc_photos', 'Photos, sketches, or inspiration (optional)'),
  ],

  AUTO_DETAIL: [
    sel('auto_vehicle', 'Vehicle type', [
      opt('sedan',    'Sedan / coupe'),
      opt('suv',      'SUV / crossover'),
      opt('truck',    'Truck'),
      opt('minivan',  'Minivan'),
      opt('sports',   'Sports / performance'),
      opt('luxury',   'Luxury vehicle'),
    ]),
    sel('auto_service', 'Service package', [
      opt('basic',     'Basic exterior wash'),
      opt('full',      'Full detail (interior + exterior)'),
      opt('interior',  'Interior only'),
      opt('paint_cor', 'Paint correction'),
      opt('ceramic',   'Ceramic coating'),
    ]),
    sel('auto_condition', 'Current vehicle condition', [
      opt('good',  'Good — light cleaning needed'),
      opt('fair',  'Fair — moderate cleaning needed'),
      opt('poor',  'Poor — heavy cleaning / stains'),
    ]),
    txt('auto_notes', 'Any special requests or concerns?', false, 'E.g. "Pet hair in back seat, scratch on driver door…"'),
  ],

  POOL_SERVICE: [
    sel('pool_service', 'Type of pool service', [
      opt('weekly',   'Weekly maintenance'),
      opt('clean',    'One-time clean'),
      opt('repair',   'Repair'),
      opt('open',     'Opening / closing (seasonal)'),
      opt('chemical', 'Chemical balance / water test'),
      opt('equip',    'Equipment installation'),
    ]),
    sel('pool_type', 'Pool type', [
      opt('inground',  'In-ground'),
      opt('above',     'Above-ground'),
    ]),
    sel('pool_size', 'Approximate pool size', [
      opt('small',   'Small — under 10,000 gallons'),
      opt('medium',  'Medium — 10,000–20,000 gallons'),
      opt('large',   'Large — over 20,000 gallons'),
    ]),
    txt('pool_notes', 'Any additional details', false, 'E.g. "Pool hasn\'t been serviced in 2 months, water is green…"'),
    photo('pool_photos', 'Photos of the pool (optional)'),
  ],

  APPLIANCE_REPAIR: [
    sel('appl_type', 'Which appliance?', [
      opt('fridge',    'Refrigerator / freezer'),
      opt('washer',    'Washing machine'),
      opt('dryer',     'Dryer'),
      opt('dish',      'Dishwasher'),
      opt('oven',      'Oven / range / stove'),
      opt('micro',     'Microwave'),
      opt('other',     'Other'),
    ]),
    { ...txt('appl_brand', 'Brand (e.g. Samsung, LG, Whirlpool)', false), type: 'text' as const },
    { ...txt('appl_model', 'Model / serial number (if known)', false, 'Found on a sticker inside the door or on the back'), type: 'text' as const },
    txt('appl_issue', 'Describe the problem', true, 'E.g. "Fridge stopped cooling overnight, compressor running constantly but no cold air…"'),
    photo('appl_photos', 'Photos of the appliance or error codes (helpful)'),
  ],

  CONCRETE_ASPHALT: [
    sel('conc_work', 'Type of concrete / asphalt work', [
      opt('driveway',   'New driveway'),
      opt('repair',     'Repair / crack filling / patching'),
      opt('sidewalk',   'Sidewalk or walkway'),
      opt('parking',    'Parking lot'),
      opt('foundation', 'Foundation work'),
      opt('slab',       'Patio or slab'),
      opt('other',      'Other'),
    ]),
    num('conc_sqft',  'Approximate area', false, 'sq ft'),
    txt('conc_desc',  'Describe the scope', true, 'E.g. "200 sq ft driveway, 2 cracks about 10 ft long, surface pitting throughout…"'),
    photo('conc_photos', 'Photos (strongly recommended for accurate quote)'),
  ],
};

const GENERIC_DEFAULT_QUESTIONS: Q[] = [
  txt('generic_desc', 'Describe the work you need done', true,
    'Include as much detail as possible — scope, timeline, any specific requirements…'),
  photo('generic_photos', 'Photos of the area or problem (optional)'),
];
