import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { DateTimeField } from '@/components/DateTimeField';
import { ComplexityPanel } from '@/components/admin/ComplexityPanel';
import { SchedulingPanel } from '@/components/admin/SchedulingPanel';

interface QuoteDetail {
  id: string; status: QuoteStatus; createdAt: string;
  estimateAmountCents: number | null; estimateSentAt: string | null;
  service: { name: string; questions: any[]; pricingMode?: string };
  propertyKind: string;
  addressLine: string; city: string; state: string; postalCode: string;
  guestName: string | null; guestEmail: string | null; guestPhone: string | null;
  user: { email: string; customerProfiles?: { fullName: string }[] } | null;
  answers: Record<string, unknown>;
  customerNotes: string | null; internalNotes: string | null;
  preferredAtNote: string | null;
  jobComplexity: 'SIMPLE' | 'COMPLEX' | null;
  complexityNote: string | null;
  pricingBreakdown: { steps?: Array<{ label: string; deltaCents: number; runningCents: number }>; totalCents?: number } | null;
  statusHistory: Array<{ fromStatus: string; toStatus: string; createdAt: string; note: string | null }>;
}

/**
 * MUST mirror LEGAL_STATUS_TRANSITIONS in packages/shared/src/enums.ts —
 * the API rejects anything else. Copied (not imported) because
 * @speed-enterprises/shared is types-only for Metro; keep in sync by hand.
 */
const TRANSITIONS: Record<string, QuoteStatus[]> = {
  NEW:           ['REVIEWING', 'CANCELED'],
  REVIEWING:     ['ESTIMATE_SENT', 'CANCELED'],
  ESTIMATE_SENT: ['SCHEDULED', 'CANCELED'],
  SCHEDULED:     ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS:   ['COMPLETED', 'CANCELED'],
  COMPLETED:     ['PAID', 'CANCELED'],
  PAID:          [],
  CANCELED:      [],
};

/** Web's default estimate email body — editable before sending. */
const DEFAULT_ESTIMATE_MESSAGE =
  'Here is your estimate. Let us know if you have any questions. Thank you for choosing our service!';

/** Estimates stay valid for two weeks, same as web. */
const VALID_FOR_DAYS = 14;
/** Short jobs reserve a 2h window; complex jobs a 3-day span. */
const SHORT_JOB_MS = 2 * 60 * 60_000;
const COMPLEX_JOB_MS = 3 * 24 * 60 * 60_000;

function customerName(q: QuoteDetail) {
  return q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? q.user?.email ?? 'Customer';
}

/** Web's renderAnswer — booleans read as Yes/No, multi-selects comma-joined. */
function renderAnswer(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export default function AdminQuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const { isAdmin } = useAuth(); // OWNER only

  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showEstModal, setShowEstModal] = useState(false);
  const [estInput, setEstInput] = useState('');
  const [estMessage, setEstMessage] = useState(DEFAULT_ESTIMATE_MESSAGE);
  const [proposedAt, setProposedAt] = useState<Date | null>(null);
  const [estError, setEstError] = useState<string | null>(null);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesInput, setNotesInput] = useState('');

  async function load() {
    try {
      const q = await apiCall<QuoteDetail>('GET', `/api/admin/quotes/${id}`);
      setQuote(q);
      setNotesInput(q.internalNotes ?? '');
      // Web seeds the amount from the current estimate, else the computed total.
      const seed = q.estimateAmountCents ?? q.pricingBreakdown?.totalCents ?? 0;
      setEstInput((seed / 100).toFixed(2));
    } catch { Alert.alert('Error', 'Could not load quote'); }
    finally { setLoading(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, [id]));

  /**
   * "Send estimate & propose time" does both at once, exactly like web: it emails
   * the estimate (→ ESTIMATE_SENT) and proposes a start window the customer
   * approves (→ SCHEDULED).
   */
  async function sendEstimate() {
    if (!quote) return;
    setEstError(null);
    const amountCents = Math.round(Number(estInput) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 0) { setEstError('Enter a valid amount'); return; }
    if (!proposedAt) { setEstError('Pick a proposed start date and time'); return; }

    setBusy(true);
    try {
      const isComplex = quote.jobComplexity === 'COMPLEX';
      const end = new Date(proposedAt.getTime() + (isComplex ? COMPLEX_JOB_MS : SHORT_JOB_MS));

      // 1) Send the estimate (moves the quote to ESTIMATE_SENT).
      await apiCall('POST', `/api/admin/quotes/${id}/estimate`, {
        amountCents,
        message: estMessage,
        validForDays: VALID_FOR_DAYS,
      });
      // 2) Propose the time window for the customer to approve.
      await apiCall('POST', '/api/appointments/propose', {
        quoteRequestId: id,
        windows: [{ startAt: proposedAt.toISOString(), endAt: end.toISOString() }],
      });
      setShowEstModal(false);
      setProposedAt(null);
      await load();
    } catch (e) {
      setEstError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally { setBusy(false); }
  }

  /**
   * The status lifecycle is otherwise automatic (estimate/booking transitions
   * happen server-side), so Cancel is the only manual status move — same rule
   * web enforces in AdminActions.
   */
  function cancelQuote() {
    Alert.alert('Cancel quote', 'Cancel this quote? This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel quote', style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await apiCall('PATCH', `/api/admin/quotes/${id}/status`, { status: 'CANCELED' });
            await load();
          } catch (e: any) { Alert.alert('Error', e?.message ?? 'Failed'); }
          finally { setBusy(false); }
        },
      },
    ]);
  }

  async function saveNotes() {
    setBusy(true);
    try {
      await apiCall('PATCH', `/api/admin/quotes/${id}`, { internalNotes: notesInput });
      setShowNotesModal(false);
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setBusy(false); }
  }

  function deleteQuote() {
    Alert.alert(
      'Delete quote',
      'This removes the quote from the quote list. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await apiCall('DELETE', `/api/admin/quotes/${id}`);
              router.back();
            } catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not delete quote'); setBusy(false); }
          },
        },
      ],
    );
  }

  if (loading) return <View style={[s.center, { backgroundColor: t.surface[50] }]}><ActivityIndicator color={t.brand.brand500} /></View>;
  if (!quote) {
    return (
      <View style={[s.center, { backgroundColor: t.surface[50] }]}>
        <Text style={{ color: t.ink[700] }}>Quote not found</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <Text style={{ color: t.brand.brand600, fontWeight: '600', marginTop: 12 }}>← Back to quotes</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const allowed = TRANSITIONS[quote.status] ?? [];
  const canCancel = allowed.includes('CANCELED' as QuoteStatus);
  const questions: any[] = quote.service.questions ?? [];
  const steps = quote.pricingBreakdown?.steps ?? [];
  const computedTotalCents = quote.pricingBreakdown?.totalCents ?? null;
  const isComplex = quote.jobComplexity === 'COMPLEX';
  const modalInput = [m.input, { borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900], backgroundColor: t.surface[50] }];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={t.brand.brand600} />
          <Text style={[s.backText, { color: t.brand.brand600 }]}>Quotes</Text>
        </TouchableOpacity>

        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.heading, { color: t.ink[900] }]}>{customerName(quote)}</Text>
            <Text style={[s.sub, { color: t.ink[300] }]}>{quote.service.name} · {quote.propertyKind.toLowerCase()} · {new Date(quote.createdAt).toLocaleString()}</Text>
          </View>
          <StatusBadge status={quote.status} />
        </View>

        {/* Actions — estimate + notes + cancel/delete. Sending an estimate and
            deleting are owner-only on web (canSendEstimate/canDelete = isAdmin). */}
        <View style={s.actionRow}>
          {isAdmin && (
            <ActionChip
              t={t}
              icon="cash-outline"
              label={quote.estimateAmountCents != null ? 'Resend estimate & time' : 'Send estimate & propose time'}
              onPress={() => { setEstError(null); setShowEstModal(true); }}
              disabled={busy}
            />
          )}
          <ActionChip t={t} icon="create-outline" label="Notes" onPress={() => setShowNotesModal(true)} disabled={busy} />
          {canCancel && (
            <ActionChip t={t} icon="close-circle-outline" label="Cancel quote" onPress={cancelQuote} disabled={busy} danger />
          )}
          {isAdmin && (
            <ActionChip t={t} icon="trash-outline" label="Delete" onPress={deleteQuote} disabled={busy} danger />
          )}
        </View>

        {quote.estimateAmountCents != null && (
          <View style={[s.estimateCard, { borderRadius: t.radius }]}>
            <Text style={s.estimateLabel}>Current estimate</Text>
            <Text style={s.estimateAmt}>${(quote.estimateAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
            {quote.estimateSentAt && <Text style={[s.estimateSent, { color: t.ink[500] }]}>Sent {new Date(quote.estimateSentAt).toLocaleDateString()}</Text>}
          </View>
        )}

        {/* Computed price — the pricing engine's step-by-step breakdown. */}
        {steps.length > 0 && (
          <Section t={t} title="Computed price">
            {steps.map((step, i) => (
              <View key={i} style={s.priceRow}>
                <Text style={[s.priceLabel, { color: t.ink[700] }]}>{step.label}</Text>
                <Text style={[s.priceValue, { color: t.ink[700] }]}>
                  {step.deltaCents >= 0 ? '+' : ''}${(step.deltaCents / 100).toFixed(2)}
                </Text>
              </View>
            ))}
            {computedTotalCents != null && (
              <View style={[s.priceRow, s.priceTotal, { borderTopColor: t.surface[200] }]}>
                <Text style={[s.priceLabel, { color: t.ink[900], fontWeight: '700' }]}>Total</Text>
                <Text style={[s.priceValue, { color: t.ink[900], fontWeight: '700' }]}>
                  ${(computedTotalCents / 100).toFixed(2)}
                </Text>
              </View>
            )}
          </Section>
        )}

        <ComplexityPanel
          quoteId={quote.id}
          initialComplexity={quote.jobComplexity}
          initialNote={quote.complexityNote}
          canEdit={isAdmin}
          onSaved={load}
        />

        <SchedulingPanel quoteId={quote.id} status={quote.status} onChanged={load} />

        <Section t={t} title="Customer">
          <InfoRow t={t} label="Email" value={quote.guestEmail ?? quote.user?.email ?? '—'} />
          <InfoRow t={t} label="Phone" value={quote.guestPhone ?? '—'} />
          <InfoRow t={t} label="Type" value={quote.propertyKind} />
        </Section>

        <Section t={t} title="Service address">
          <InfoRow t={t} label="Street" value={quote.addressLine} />
          <InfoRow t={t} label="City" value={`${quote.city}, ${quote.state} ${quote.postalCode}`} />
        </Section>

        {quote.preferredAtNote && (
          <Section t={t} title="Preferred time"><Text style={[s.bodyText, { color: t.ink[700] }]}>{quote.preferredAtNote}</Text></Section>
        )}

        {/* Staff see every answer, including internal-only questions. */}
        {questions.length > 0 && Object.keys(quote.answers).length > 0 && (
          <Section t={t} title="Answers">
            {questions.filter(q => quote.answers[q.id] !== undefined).map((q: any) => (
              <InfoRow key={q.id} t={t} label={q.label} value={renderAnswer(quote.answers[q.id])} />
            ))}
          </Section>
        )}

        {quote.customerNotes && (
          <Section t={t} title="Customer notes"><Text style={[s.bodyText, { color: t.ink[700] }]}>{quote.customerNotes}</Text></Section>
        )}
        {quote.internalNotes && (
          <Section t={t} title="Internal notes"><Text style={[s.bodyText, { color: t.ink[700] }]}>{quote.internalNotes}</Text></Section>
        )}

        <Section t={t} title="History">
          {quote.statusHistory.length === 0
            ? <Text style={{ fontSize: 13, color: t.ink[300] }}>No history yet.</Text>
            : quote.statusHistory.map((h, i) => (
                <View key={i} style={s.historyRow}>
                  <View style={[s.historyDot, { backgroundColor: t.brand.brand500 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.historyStatus, { color: t.ink[900] }]}>{h.fromStatus} → {h.toStatus}</Text>
                    <Text style={[s.historySub, { color: t.ink[300] }]}>{new Date(h.createdAt).toLocaleString()}</Text>
                    {h.note && <Text style={[s.historyNote, { color: t.ink[500] }]}>{h.note}</Text>}
                  </View>
                </View>
              ))}
        </Section>
      </ScrollView>

      {/* Estimate modal — amount + proposed start + customer message. */}
      <Modal visible={showEstModal} transparent animationType="slide" onRequestClose={() => setShowEstModal(false)}>
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              <Text style={[m.title, { color: t.ink[900] }]}>
                {quote.estimateAmountCents != null ? 'Resend estimate & time' : 'Send estimate & propose time'}
              </Text>

              <Text style={[m.label, { color: t.ink[700] }]}>Amount ($)</Text>
              <TextInput style={modalInput} value={estInput} onChangeText={setEstInput} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={t.ink[300]} />
              {computedTotalCents != null && (
                <Text style={[m.help, { color: t.ink[500] }]}>Computed total: ${(computedTotalCents / 100).toFixed(2)}</Text>
              )}

              <DateTimeField
                label="Proposed start"
                value={proposedAt}
                onChange={setProposedAt}
                disabled={busy}
                help={`Reserves ${isComplex ? 'a 3-day span (complex job)' : 'a single day (short job)'}. The customer approves this time or picks a conflict-free alternative.`}
              />

              <Text style={[m.label, { color: t.ink[700] }]}>Message to customer</Text>
              <TextInput
                style={[modalInput, { height: 110, textAlignVertical: 'top' }]}
                value={estMessage}
                onChangeText={setEstMessage}
                multiline
                placeholderTextColor={t.ink[300]}
              />

              {estError && <Text style={m.error}>{estError}</Text>}

              <View style={m.row}>
                <ModalCancel t={t} onPress={() => setShowEstModal(false)} />
                <ModalConfirm t={t} label={busy ? 'Sending…' : 'Send'} onPress={sendEstimate} disabled={busy} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Notes modal */}
      <Modal visible={showNotesModal} transparent animationType="slide" onRequestClose={() => setShowNotesModal(false)}>
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[m.title, { color: t.ink[900] }]}>Internal notes</Text>
            <TextInput style={[modalInput, { height: 100, textAlignVertical: 'top' }]} value={notesInput} onChangeText={setNotesInput} multiline placeholder="Staff-only notes…" placeholderTextColor={t.ink[300]} />
            <View style={m.row}>
              <ModalCancel t={t} onPress={() => setShowNotesModal(false)} />
              <ModalConfirm t={t} label={busy ? 'Saving…' : 'Save'} onPress={saveNotes} disabled={busy} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ActionChip({ t, icon, label, onPress, disabled, danger }: { t: Theme; icon: any; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const bg = danger ? '#fef2f2' : t.brand.brand50;
  const fg = danger ? '#b91c1c' : t.brand.brand600;
  return (
    <TouchableOpacity style={[s.actionBtn, { backgroundColor: bg }]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={16} color={fg} />
      <Text style={[s.actionBtnText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}
function ModalCancel({ t, onPress }: { t: Theme; onPress: () => void }) {
  return <TouchableOpacity style={[m.cancel, { backgroundColor: t.surface[100], borderRadius: t.radius }]} onPress={onPress}><Text style={[m.cancelText, { color: t.ink[700] }]}>Cancel</Text></TouchableOpacity>;
}
function ModalConfirm({ t, label, onPress, disabled }: { t: Theme; label: string; onPress: () => void; disabled?: boolean }) {
  return <TouchableOpacity style={[m.confirm, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={onPress} disabled={disabled}><Text style={[m.confirmText, { color: t.brand.onBrand }]}>{label}</Text></TouchableOpacity>;
}
function Section({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={[s.sectionTitle, { color: t.ink[300] }]}>{title}</Text>
      <View style={[s.sectionCard, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft]}>{children}</View>
    </View>
  );
}
function InfoRow({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={[s.infoLabel, { color: t.ink[300] }]}>{label}</Text>
      <Text style={[s.infoValue, { color: t.ink[900] }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  backText: { fontSize: 14, fontWeight: '500' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  actionBtnText: { fontSize: 13, fontWeight: '600' },
  estimateCard: { backgroundColor: '#f0fdf4', padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#bbf7d0' },
  estimateLabel: { fontSize: 11, fontWeight: '600', color: '#065f46', textTransform: 'uppercase', letterSpacing: 0.5 },
  estimateAmt: { fontSize: 28, fontWeight: '800', color: '#065f46', marginTop: 2 },
  estimateSent: { fontSize: 12, marginTop: 4 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sectionCard: { padding: 14, gap: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 13, fontWeight: '500', flex: 2, textAlign: 'right' },
  bodyText: { fontSize: 14, lineHeight: 20 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  priceTotal: { borderTopWidth: 1, paddingTop: 8, marginTop: 2 },
  priceLabel: { fontSize: 13, flex: 1 },
  priceValue: { fontSize: 13 },
  historyRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
  historyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  historyStatus: { fontSize: 13, fontWeight: '600' },
  historySub: { fontSize: 11, marginTop: 1 },
  historyNote: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },
});
const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600' },
  help: { fontSize: 12 },
  input: { borderWidth: 1, padding: 12, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirm: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '600' },
  error: { fontSize: 13, color: '#dc2626' },
});
