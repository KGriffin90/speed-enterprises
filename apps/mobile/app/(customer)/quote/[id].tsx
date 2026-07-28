import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall, ApiError } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { BookingPanel } from '@/components/BookingPanel';
import { Button, Input } from '@/components/ui';

interface QuoteDetail {
  id: string; status: QuoteStatus; createdAt: string;
  estimateAmountCents: number | null; estimateSentAt: string | null; estimateValidUntil: string | null;
  acceptedAt: string | null;
  service: { name: string; questions: any[]; estimatedDurationMinutes: number | null };
  propertyKind: string;
  addressLine: string; city: string; state: string; postalCode: string;
  guestName: string | null; guestEmail: string | null; guestPhone: string | null;
  user: { email: string; customerProfiles?: { fullName: string; phone: string }[] } | null;
  customerNotes: string | null; preferredAtNote: string | null;
  jobComplexity: 'SIMPLE' | 'COMPLEX' | null;
  complexityNote: string | null;
  pricingBreakdown: { steps?: Array<{ label: string; deltaCents: number; runningCents: number }>; totalCents?: number } | null;
  answers: Record<string, unknown>;
  statusHistory: Array<{ fromStatus: string; toStatus: string; createdAt: string; note: string | null }>;
}

/** Web's renderAnswer — booleans read as Yes/No, multi-selects comma-joined. */
function renderAnswer(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export default function CustomerQuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'accept' | 'decline'>(null);
  const [note, setNote] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    try {
      const q = await apiCall<QuoteDetail>('GET', `/api/quotes/${id}`);
      setQuote(q);
    } catch { Alert.alert('Error', 'Could not load quote'); }
    finally { setLoading(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, [id]));

  async function accept() {
    setBusy(true); setActionError(null);
    try {
      await apiCall('POST', `/api/quotes/${id}/accept`, { note: note || undefined });
      setMode(null); setNote('');
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  async function decline() {
    // Web requires a reason before it will submit; keep the same validation.
    if (!declineReason.trim()) {
      setActionError('Please share a quick reason so the team can follow up.');
      return;
    }
    setBusy(true); setActionError(null);
    try {
      await apiCall('POST', `/api/quotes/${id}/decline`, { reason: declineReason });
      setMode(null); setDeclineReason('');
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  if (loading) return <View style={[s.center, { backgroundColor: t.surface[50] }]}><ActivityIndicator color={t.brand.brand500} /></View>;
  if (!quote) {
    return (
      <View style={[s.center, { backgroundColor: t.surface[50] }]}>
        <Text style={{ color: t.ink[700] }}>Quote not found</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <Text style={{ color: t.brand.brand600, fontWeight: '600', marginTop: 12 }}>← Back to my quotes</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const questions: any[] = quote.service.questions ?? [];
  const accepted = quote.acceptedAt != null;
  // Only the pre-approval step lives here. Once approved, the time-approval step
  // (BookingPanel) takes over while the quote is still ESTIMATE_SENT.
  const showActions = quote.status === 'ESTIMATE_SENT' && !accepted;
  const expired = !!quote.estimateValidUntil && new Date(quote.estimateValidUntil) < new Date();
  const steps = quote.pricingBreakdown?.steps ?? [];
  const contactName = quote.guestName ?? quote.user?.customerProfiles?.[0]?.fullName ?? '—';
  const contactEmail = quote.guestEmail ?? quote.user?.email ?? '—';
  const contactPhone = quote.guestPhone ?? quote.user?.customerProfiles?.[0]?.phone ?? '—';

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={t.brand.brand600} />
          <Text style={[s.backText, { color: t.brand.brand600 }]}>My quotes</Text>
        </TouchableOpacity>

        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.heading, { color: t.ink[900] }]}>{quote.service.name}</Text>
            <Text style={[s.sub, { color: t.ink[300] }]}>
              {quote.propertyKind === 'RESIDENTIAL' ? 'Residential' : 'Commercial'} · Submitted {new Date(quote.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <StatusBadge status={quote.status} />
        </View>

        {/* Multi-day project notice — web shows this above the estimate. */}
        {quote.jobComplexity === 'COMPLEX' && quote.complexityNote && (
          <View style={[s.complexCard, { borderRadius: t.radius }]}>
            <View style={s.complexHeader}>
              <Text>🗓️</Text>
              <Text style={s.complexTitle}>A larger, multi-day project</Text>
            </View>
            <Text style={s.complexBody}>{quote.complexityNote}</Text>
          </View>
        )}

        {/* Estimate banner */}
        {quote.estimateAmountCents != null && (
          <View style={[s.estimateCard, { backgroundColor: t.brand.brand50, borderColor: t.brand.brand200, borderRadius: t.radius }]}>
            <Text style={[s.estimateLabel, { color: t.brand.brand700 }]}>Your estimate</Text>
            <Text style={[s.estimateAmt, { color: t.brand.brand700 }]}>{money(quote.estimateAmountCents)}</Text>
            {quote.estimateSentAt && (
              <Text style={[s.estimateSub, { color: t.ink[500] }]}>Sent {new Date(quote.estimateSentAt).toLocaleDateString()}</Text>
            )}
          </View>
        )}

        {/* Approve / decline — mirrors web's CustomerActions card. */}
        {showActions && (
          <View style={[s.actionCard, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }, t.shadowSoft]}>
            {expired ? (
              <Text style={{ fontSize: 14, color: '#dc2626' }}>
                This estimate has expired. Contact us to refresh it.
              </Text>
            ) : (
              <>
                <Text style={[s.actionTitle, { color: t.ink[900] }]}>Review your estimate</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Approve estimate" onPress={() => { setActionError(null); setMode('accept'); }} disabled={busy} />
                  </View>
                  <Button title="Decline" variant="secondary" fullWidth={false} onPress={() => { setActionError(null); setMode('decline'); }} disabled={busy} />
                </View>
                {quote.estimateValidUntil && (
                  <Text style={[s.help, { color: t.ink[500] }]}>
                    Valid until {new Date(quote.estimateValidUntil).toLocaleDateString()}.
                  </Text>
                )}
              </>
            )}
          </View>
        )}

        {/* Scheduling — opens once the estimate is approved. */}
        <BookingPanel
          quoteId={quote.id}
          status={quote.status}
          accepted={accepted}
          durationMinutes={quote.service.estimatedDurationMinutes}
          onChanged={load}
        />

        <Section t={t} title="Your contact info">
          <InfoRow t={t} label="Name" value={contactName} />
          <InfoRow t={t} label="Email" value={contactEmail} />
          <InfoRow t={t} label="Phone" value={contactPhone} />
        </Section>

        <Section t={t} title="Service address">
          <InfoRow t={t} label="Street" value={quote.addressLine} />
          <InfoRow t={t} label="City" value={`${quote.city}, ${quote.state} ${quote.postalCode}`} />
        </Section>

        {quote.preferredAtNote && (
          <Section t={t} title="Preferred timing">
            <Text style={[s.bodyText, { color: t.ink[700] }]}>{quote.preferredAtNote}</Text>
          </Section>
        )}

        {/* Internal-only questions stay hidden from the customer (web filters on
            `!qq.internal`); showing them here would leak staff-facing notes. */}
        {questions.length > 0 && Object.keys(quote.answers).length > 0 && (
          <Section t={t} title="Your answers">
            {questions
              .filter((q: any) => !q.internal && quote.answers[q.id] !== undefined)
              .map((q: any) => (
                <InfoRow key={q.id} t={t} label={q.label} value={renderAnswer(quote.answers[q.id])} />
              ))}
          </Section>
        )}

        {quote.customerNotes && (
          <Section t={t} title="Notes">
            <Text style={[s.bodyText, { color: t.ink[700] }]}>{quote.customerNotes}</Text>
          </Section>
        )}

        <Section t={t} title="Activity">
          {quote.statusHistory.length === 0
            ? <Text style={{ fontSize: 13, color: t.ink[300] }}>No updates yet — we'll reach out soon.</Text>
            : quote.statusHistory.map((h, i) => {
                const isLatest = i === 0;
                return (
                  <View key={i} style={[s.histRow, isLatest && { backgroundColor: '#f0fdf4', borderRadius: 12, padding: 10, marginHorizontal: -10, borderWidth: 1, borderColor: '#86efac' }]}>
                    <View style={[s.histDot, { backgroundColor: isLatest ? '#16a34a' : t.surface[200] }, isLatest && { width: 10, height: 10, borderRadius: 5, marginTop: 4 }]} />
                    <View style={{ flex: 1 }}>
                      <View style={s.histTitleRow}>
                        <Text style={[isLatest ? { color: '#14532d', fontSize: 15, fontWeight: '800' } : { color: t.ink[500], fontSize: 13, fontWeight: '500' }]}>
                          {h.toStatus.replace(/_/g, ' ')}
                        </Text>
                        {isLatest && (
                          <View style={s.latestBadge}><Text style={s.latestBadgeText}>Latest</Text></View>
                        )}
                      </View>
                      <Text style={[s.histSub, { color: t.ink[300] }]}>{new Date(h.createdAt).toLocaleString()}</Text>
                      {h.note && <Text style={[s.histNote, { color: t.ink[500] }]}>{h.note}</Text>}
                    </View>
                  </View>
                );
              })}
        </Section>

        {/* Web renders the breakdown only when it adds detail beyond the total. */}
        {steps.length > 1 && (
          <Section t={t} title="How it's priced">
            {steps.map((step, i) => (
              <View key={i} style={s.priceRow}>
                <Text style={[s.priceLabel, { color: t.ink[700] }]}>{step.label}</Text>
                <Text style={[s.priceValue, { color: t.ink[700] }]}>
                  {step.deltaCents >= 0 ? '+' : ''}${(step.deltaCents / 100).toFixed(2)}
                </Text>
              </View>
            ))}
            {quote.pricingBreakdown?.totalCents != null && (
              <View style={[s.priceRow, s.priceTotal, { borderTopColor: t.surface[200] }]}>
                <Text style={[s.priceLabel, { color: t.ink[900], fontWeight: '700' }]}>Total</Text>
                <Text style={[s.priceValue, { color: t.ink[900], fontWeight: '700' }]}>
                  ${(quote.pricingBreakdown.totalCents / 100).toFixed(2)}
                </Text>
              </View>
            )}
          </Section>
        )}
      </ScrollView>

      {/* Approve sheet — the optional note web collects before accepting. */}
      <Modal visible={mode === 'accept'} transparent animationType="slide" onRequestClose={() => setMode(null)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[s.sheetTitle, { color: t.ink[900] }]}>Approve this estimate</Text>
            <Input
              value={note}
              onChangeText={setNote}
              placeholder="Optional message for the team (preferred times, gate code, etc.)"
              multiline
              style={{ height: 96, textAlignVertical: 'top' }}
            />
            {actionError && <Text style={s.error}>{actionError}</Text>}
            <Text style={[s.help, { color: t.ink[500] }]}>Next you'll approve a time for the job.</Text>
            <View style={s.sheetRow}>
              <View style={{ flex: 1 }}>
                <Button title={busy ? 'Approving…' : 'Approve estimate'} onPress={accept} loading={busy} />
              </View>
              <Button title="Cancel" variant="secondary" fullWidth={false} onPress={() => setMode(null)} disabled={busy} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Decline sheet — reason is required, same as web. */}
      <Modal visible={mode === 'decline'} transparent animationType="slide" onRequestClose={() => setMode(null)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[s.sheetTitle, { color: t.ink[900] }]}>Decline estimate</Text>
            <Input
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Reason — helps us improve"
              multiline
              style={{ height: 96, textAlignVertical: 'top' }}
            />
            {actionError && <Text style={s.error}>{actionError}</Text>}
            <View style={s.sheetRow}>
              <View style={{ flex: 1 }}>
                <TouchableOpacity
                  style={[s.danger, { borderRadius: t.radius, opacity: busy ? 0.6 : 1 }]}
                  onPress={decline}
                  disabled={busy}
                >
                  <Text style={s.dangerText}>{busy ? 'Submitting…' : 'Decline'}</Text>
                </TouchableOpacity>
              </View>
              <Button title="Cancel" variant="secondary" fullWidth={false} onPress={() => setMode(null)} disabled={busy} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
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
  complexCard: { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, padding: 16, marginBottom: 16, gap: 6 },
  complexHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  complexTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  complexBody: { fontSize: 14, lineHeight: 20, color: '#92400e' },
  estimateCard: { padding: 16, marginBottom: 16, borderWidth: 1, gap: 6 },
  estimateLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  estimateAmt: { fontSize: 32, fontWeight: '800' },
  estimateSub: { fontSize: 12 },
  actionCard: { padding: 20, borderWidth: 1, marginBottom: 16, gap: 12 },
  actionTitle: { fontSize: 16, fontWeight: '700' },
  help: { fontSize: 12, lineHeight: 17 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sectionCard: { padding: 14, gap: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 13, fontWeight: '500', flex: 2, textAlign: 'right' },
  bodyText: { fontSize: 14, lineHeight: 20 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  priceTotal: { borderTopWidth: 1, paddingTop: 8, marginTop: 2 },
  priceLabel: { fontSize: 13, flex: 1 },
  priceValue: { fontSize: 13 },
  histRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
  histDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  histTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  histSub: { fontSize: 11, marginTop: 1 },
  histNote: { fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  latestBadge: { backgroundColor: '#bbf7d0', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  latestBadgeText: { fontSize: 10, fontWeight: '800', color: '#14532d', textTransform: 'uppercase', letterSpacing: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetRow: { flexDirection: 'row', gap: 10 },
  error: { fontSize: 13, color: '#dc2626' },
  danger: { backgroundColor: '#dc2626', paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
