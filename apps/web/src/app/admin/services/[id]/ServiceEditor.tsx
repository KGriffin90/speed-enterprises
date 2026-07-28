'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuestionOption { value: string; label: string; priceAdjustmentCents?: number }

interface Question {
  id: string; label: string; type: string; required: boolean;
  helpText?: string; placeholder?: string; unit?: string;
  options?: QuestionOption[]; min?: number; max?: number; step?: number;
  affectsPricing?: boolean; internal?: boolean;
}

type PricingEffectKind = 'add' | 'multiply' | 'per_unit' | 'min_price' | 'max_price';

interface PricingRule {
  id: string; label: string; order: number;
  effect: { kind: PricingEffectKind; cents?: number; factor?: number; questionId?: string };
}

interface Service {
  id: string; slug: string; name: string; description: string;
  category: string; pricingMode: string; basePriceCents: number;
  active: boolean; visibleOnPublicSite: boolean;
  estimatedDurationMinutes: number | null; requiresOnsiteEstimate: boolean;
  questions: Question[]; pricingRules: PricingRule[];
}

const QUESTION_TYPES = ['text','longtext','number','currency','select','multiselect','boolean','date','time','photo','file','measurement','rating'];

// ── Main editor ───────────────────────────────────────────────────────────────

export function ServiceEditor({ service }: { service: Service }) {
  const router = useRouter();
  const [tab, setTab] = useState<'details'|'questions'|'pricing'>('details');
  const [svc, setSvc]   = useState(service);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api('PATCH', `/api/services/${svc.id}`, {
        name:        svc.name,
        description: svc.description,
        category:    svc.category,
        pricingMode: svc.pricingMode,
        basePriceCents: svc.basePriceCents,
        active:      svc.active,
        visibleOnPublicSite: svc.visibleOnPublicSite,
        estimatedDurationMinutes: svc.estimatedDurationMinutes,
        requiresOnsiteEstimate:  svc.requiresOnsiteEstimate,
        questions:    svc.questions,
        pricingRules: svc.pricingRules,
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <a href="/admin/services" className="link text-sm">← Services</a>
          <h1 className="text-2xl font-extrabold mt-1" style={{ color: 'var(--ink-900)' }}>{svc.name}</h1>
          <div className="text-sm mt-0.5" style={{ color: 'var(--ink-500)' }}>/quote/{svc.slug}</div>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs" style={{ color: '#059669' }}>Saved.</span>}
          {error && <span className="text-xs" style={{ color: '#dc2626' }}>{error}</span>}
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--surface-200)' }}>
        {(['details','questions','pricing'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium capitalize"
            style={{
              borderBottom: tab === t ? '2px solid var(--brand-500)' : '2px solid transparent',
              color: tab === t ? 'var(--brand-600)' : 'var(--ink-500)',
              marginBottom: -1,
            }}
          >
            {t}{t === 'questions' ? ` (${svc.questions.length})` : ''}
            {t === 'pricing' ? ` (${svc.pricingRules.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'details'   && <DetailsTab   svc={svc} onChange={setSvc} />}
      {tab === 'questions' && <QuestionsTab svc={svc} onChange={setSvc} />}
      {tab === 'pricing'   && <PricingTab   svc={svc} onChange={setSvc} />}
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({ svc, onChange }: { svc: Service; onChange: (s: Service) => void }) {
  const set = (patch: Partial<Service>) => onChange({ ...svc, ...patch });
  return (
    <div className="card p-6 space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={svc.name} onChange={e => set({ name: e.target.value })} />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={svc.category} onChange={e => set({ category: e.target.value })}>
            <option value="RESIDENTIAL">Residential</option>
            <option value="COMMERCIAL">Commercial</option>
            <option value="BOTH">Both</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={svc.description} onChange={e => set({ description: e.target.value })} />
        </div>
        <div>
          <label className="label">Pricing mode</label>
          <select className="input" value={svc.pricingMode} onChange={e => set({ pricingMode: e.target.value })}>
            <option value="FIXED">Fixed price</option>
            <option value="COMPUTED">Computed (rules)</option>
            <option value="QUOTE_REQUIRED">Quote required</option>
          </select>
        </div>
        <div>
          <label className="label">Base price ($)</label>
          <input className="input" type="number" min={0} step={0.01}
            value={svc.basePriceCents / 100}
            onChange={e => set({ basePriceCents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
        </div>
        <div>
          <label className="label">Est. duration (min)</label>
          <input className="input" type="number" min={0} step={15}
            value={svc.estimatedDurationMinutes ?? ''}
            onChange={e => set({ estimatedDurationMinutes: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </div>
      <div className="flex gap-6 flex-wrap">
        <Toggle label="Active" v={svc.active} on={v => set({ active: v })} />
        <Toggle label="Visible on public site" v={svc.visibleOnPublicSite} on={v => set({ visibleOnPublicSite: v })} />
        <Toggle label="Requires onsite estimate" v={svc.requiresOnsiteEstimate} on={v => set({ requiresOnsiteEstimate: v })} />
      </div>
    </div>
  );
}

// ── Questions tab ─────────────────────────────────────────────────────────────

function QuestionsTab({ svc, onChange }: { svc: Service; onChange: (s: Service) => void }) {
  const setQs = (qs: Question[]) => onChange({ ...svc, questions: qs });

  function addQuestion() {
    const id = `q_${Date.now()}`;
    setQs([...svc.questions, { id, label: 'New question', type: 'text', required: false }]);
  }

  function move(i: number, dir: -1 | 1) {
    const arr = [...svc.questions];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    setQs(arr);
  }

  function update(i: number, patch: Partial<Question>) {
    const arr = [...svc.questions];
    arr[i] = { ...arr[i]!, ...patch };
    setQs(arr);
  }

  function remove(i: number) {
    setQs(svc.questions.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {svc.questions.length === 0 && (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-500)' }}>No questions yet. Add one below.</div>
      )}
      {svc.questions.map((q, i) => (
        <QuestionRow
          key={q.id} q={q} index={i} total={svc.questions.length}
          onMove={move} onUpdate={p => update(i, p)} onRemove={() => remove(i)}
        />
      ))}
      <button className="btn-secondary w-full text-sm py-2" onClick={addQuestion}>+ Add question</button>
    </div>
  );
}

function QuestionRow({ q, index, total, onMove, onUpdate, onRemove }: {
  q: Question; index: number; total: number;
  onMove: (i: number, d: -1|1) => void;
  onUpdate: (p: Partial<Question>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasOptions = q.type === 'select' || q.type === 'multiselect';

  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex items-center gap-3">
        <div className="flex flex-col gap-0.5">
          <button className="text-xs leading-none" style={{ color: 'var(--ink-400)' }} onClick={() => onMove(index, -1)} disabled={index === 0}>▲</button>
          <button className="text-xs leading-none" style={{ color: 'var(--ink-400)' }} onClick={() => onMove(index, 1)}  disabled={index === total - 1}>▼</button>
        </div>
        <div className="flex-1 min-w-0">
          <input
            className="input text-sm py-1"
            value={q.label}
            onChange={e => onUpdate({ label: e.target.value })}
            placeholder="Question label"
          />
        </div>
        <select className="input text-sm py-1 w-36" value={q.type} onChange={e => onUpdate({ type: e.target.value })}>
          {QUESTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: 'var(--ink-600)' }}>
          <input type="checkbox" checked={q.required} onChange={e => onUpdate({ required: e.target.checked })} />
          Required
        </label>
        <button className="text-xs link" onClick={() => setOpen(o => !o)}>{open ? 'Less' : 'More'}</button>
        <button onClick={onRemove} className="text-xs" style={{ color: '#dc2626' }}>✕</button>
      </div>

      {open && (
        <div className="px-4 pb-4 grid md:grid-cols-2 gap-3 border-t" style={{ borderColor: 'var(--surface-100)' }}>
          <div>
            <label className="label text-xs">Help text</label>
            <input className="input text-sm" value={q.helpText ?? ''} onChange={e => onUpdate({ helpText: e.target.value })} placeholder="Shown below the field" />
          </div>
          <div>
            <label className="label text-xs">Placeholder</label>
            <input className="input text-sm" value={q.placeholder ?? ''} onChange={e => onUpdate({ placeholder: e.target.value })} />
          </div>
          {['number','currency','rating','measurement'].includes(q.type) && (
            <>
              <div><label className="label text-xs">Unit</label><input className="input text-sm" value={q.unit ?? ''} onChange={e => onUpdate({ unit: e.target.value })} placeholder="sqft, ft, windows…" /></div>
              <div className="flex gap-2">
                <div><label className="label text-xs">Min</label><input className="input text-sm w-20" type="number" value={q.min ?? ''} onChange={e => onUpdate({ min: e.target.value ? Number(e.target.value) : undefined })} /></div>
                <div><label className="label text-xs">Max</label><input className="input text-sm w-20" type="number" value={q.max ?? ''} onChange={e => onUpdate({ max: e.target.value ? Number(e.target.value) : undefined })} /></div>
              </div>
            </>
          )}
          {hasOptions && (
            <div className="md:col-span-2">
              <label className="label text-xs">Options <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>(one per line: value|Label|priceCents)</span></label>
              <textarea
                className="input text-xs font-mono"
                rows={4}
                value={(q.options ?? []).map(o => `${o.value}|${o.label}${o.priceAdjustmentCents ? `|${o.priceAdjustmentCents}` : ''}`).join('\n')}
                onChange={e => {
                  const opts = e.target.value.split('\n').map(line => {
                    const [value, label, cents] = line.split('|');
                    return { value: value?.trim() ?? '', label: label?.trim() ?? value?.trim() ?? '', priceAdjustmentCents: cents ? parseInt(cents) : undefined };
                  }).filter(o => o.value);
                  onUpdate({ options: opts });
                }}
              />
            </div>
          )}
          <div className="md:col-span-2 flex gap-4">
            <Toggle label="Affects pricing" v={!!q.affectsPricing} on={v => onUpdate({ affectsPricing: v })} />
            <Toggle label="Internal (staff only)" v={!!q.internal} on={v => onUpdate({ internal: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pricing rules tab ─────────────────────────────────────────────────────────

function PricingTab({ svc, onChange }: { svc: Service; onChange: (s: Service) => void }) {
  const setRules = (r: PricingRule[]) => onChange({ ...svc, pricingRules: r });

  function addRule() {
    const id = `r_${Date.now()}`;
    setRules([...svc.pricingRules, { id, label: 'New rule', order: svc.pricingRules.length, effect: { kind: 'add', cents: 0 } }]);
  }

  function update(i: number, patch: Partial<PricingRule>) {
    const arr = [...svc.pricingRules];
    arr[i] = { ...arr[i]!, ...patch };
    setRules(arr);
  }

  function move(i: number, dir: -1|1) {
    const arr = [...svc.pricingRules];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    setRules(arr.map((r, idx) => ({ ...r, order: idx })));
  }

  function remove(i: number) { setRules(svc.pricingRules.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-3">
      <div className="card p-4 text-sm" style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
        Rules run top-to-bottom. Each rule adds, multiplies, or applies a per-unit price on top of the base price.
        Only active when pricing mode is <strong>Computed</strong>.
      </div>
      {svc.pricingRules.length === 0 && (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-500)' }}>No rules yet.</div>
      )}
      {svc.pricingRules.map((rule, i) => (
        <RuleRow
          key={rule.id} rule={rule} index={i} total={svc.pricingRules.length}
          questions={svc.questions}
          onMove={move} onUpdate={p => update(i, p)} onRemove={() => remove(i)}
        />
      ))}
      <button className="btn-secondary w-full text-sm py-2" onClick={addRule}>+ Add rule</button>
    </div>
  );
}

function RuleRow({ rule, index, total, questions, onMove, onUpdate, onRemove }: {
  rule: PricingRule; index: number; total: number; questions: Question[];
  onMove: (i: number, d: -1|1) => void;
  onUpdate: (p: Partial<PricingRule>) => void;
  onRemove: () => void;
}) {
  const eff = rule.effect;
  const needsQuestion = eff.kind === 'per_unit';

  function setEffect(patch: Partial<typeof eff>) {
    onUpdate({ effect: { ...eff, ...patch } as any });
  }

  return (
    <div className="card p-4 flex items-start gap-3">
      <div className="flex flex-col gap-0.5 mt-1">
        <button className="text-xs" style={{ color: 'var(--ink-400)' }} onClick={() => onMove(index, -1)} disabled={index === 0}>▲</button>
        <button className="text-xs" style={{ color: 'var(--ink-400)' }} onClick={() => onMove(index, 1)}  disabled={index === total - 1}>▼</button>
      </div>

      <div className="flex-1 grid md:grid-cols-4 gap-3">
        <div>
          <label className="label text-xs">Rule label</label>
          <input className="input text-sm" value={rule.label} onChange={e => onUpdate({ label: e.target.value })} />
        </div>
        <div>
          <label className="label text-xs">Effect</label>
          <select className="input text-sm" value={eff.kind} onChange={e => setEffect({ kind: e.target.value as PricingEffectKind })}>
            <option value="add">Add flat amount</option>
            <option value="multiply">Multiply price</option>
            <option value="per_unit">Per unit (question)</option>
            <option value="min_price">Minimum price</option>
            <option value="max_price">Maximum price</option>
          </select>
        </div>

        {(eff.kind === 'add' || eff.kind === 'min_price' || eff.kind === 'max_price') && (
          <div>
            <label className="label text-xs">Amount ($)</label>
            <input className="input text-sm" type="number" step={0.01}
              value={(eff.cents ?? 0) / 100}
              onChange={e => setEffect({ cents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
          </div>
        )}

        {eff.kind === 'multiply' && (
          <div>
            <label className="label text-xs">Factor (e.g. 1.5 = +50%)</label>
            <input className="input text-sm" type="number" step={0.01} min={0}
              value={eff.factor ?? 1}
              onChange={e => setEffect({ factor: parseFloat(e.target.value || '1') })} />
          </div>
        )}

        {eff.kind === 'per_unit' && (
          <>
            <div>
              <label className="label text-xs">Price per unit ($)</label>
              <input className="input text-sm" type="number" step={0.01}
                value={(eff.cents ?? 0) / 100}
                onChange={e => setEffect({ cents: Math.round(parseFloat(e.target.value || '0') * 100) })} />
            </div>
            <div>
              <label className="label text-xs">Units from question</label>
              <select className="input text-sm" value={eff.questionId ?? ''} onChange={e => setEffect({ questionId: e.target.value })}>
                <option value="">— select —</option>
                {questions.filter(q => ['number','currency','rating','measurement'].includes(q.type)).map(q => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <button onClick={onRemove} className="text-xs mt-1" style={{ color: '#dc2626' }}>✕</button>
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
