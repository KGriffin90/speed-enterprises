/**
 * BookingPanel — native mirror of web's
 * apps/web/src/app/dashboard/quotes/[id]/BookingSection.tsx.
 *
 * Same state machine as web:
 *   confirmed appointment            → ConfirmedView (reschedule / cancel)
 *   owner proposed windows           → ProposedChooser (approve or see alternatives)
 *   accepted + short job             → SelfServePicker (hold → confirm)
 *   accepted + long/complex job      → "scheduling in progress" note
 *
 * Reschedule navigates to app/book/reschedule/[token] — the same standalone
 * screen the emailed link opens — rather than duplicating the picker inline,
 * mirroring how web links out to /book/reschedule/<token>.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { apiCall, ApiError } from '@/lib/api';
import {
  CUSTOMER_TZ, SELF_SERVE_MAX_MINUTES, fmtInZone, humanZone,
  type Appointment, type Slot,
} from '@/lib/appointments';
import { SlotButton } from '@/components/BookingShell';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Button, Input } from '@/components/ui';

interface Props {
  quoteId: string;
  status: string;
  accepted: boolean;
  durationMinutes: number | null;
  /** Called after any change that alters the quote — parent re-fetches. */
  onChanged: () => void;
}

export function BookingPanel({ quoteId, status, accepted, durationMinutes, onChanged }: Props) {
  const t = useTheme();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);

  // Scheduling opens once the customer approves the estimate (status stays
  // ESTIMATE_SENT until a time is confirmed), and stays visible while SCHEDULED.
  const active = (status === 'ESTIMATE_SENT' && accepted) || status === 'SCHEDULED';

  const loadAppointments = useCallback(async () => {
    try {
      const list = await apiCall<Appointment[]>('GET', `/api/quotes/${quoteId}/appointments`);
      // Most recent active appointment wins (list is desc by createdAt).
      setAppt(list.find(a => a.status === 'CONFIRMED' || a.status === 'PROPOSED') ?? null);
    } catch {
      setAppt(null);
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    if (active) loadAppointments();
    else setLoading(false);
  }, [active, loadAppointments]);

  if (!active) return null;
  if (loading) return null;

  const refresh = () => { loadAppointments(); onChanged(); };

  if (appt?.status === 'CONFIRMED' && appt.startAt) {
    return <ConfirmedView t={t} appt={appt} onChanged={refresh} />;
  }

  if (appt?.status === 'PROPOSED' && appt.proposedSlots?.length) {
    return (
      <ProposedChooser
        t={t}
        appt={appt}
        quoteId={quoteId}
        durationMinutes={durationMinutes ?? 120}
        onConfirmed={refresh}
      />
    );
  }

  // Accepted but not yet scheduled.
  const selfServeEligible = durationMinutes != null && durationMinutes <= SELF_SERVE_MAX_MINUTES;
  if (selfServeEligible) {
    return <SelfServePicker t={t} quoteId={quoteId} durationMinutes={durationMinutes!} onBooked={refresh} />;
  }

  // Long/complex job — owner will propose windows.
  return (
    <PanelCard t={t}>
      <Text style={[s.title, { color: t.ink[900] }]}>Scheduling in progress</Text>
      <Text style={[s.body, { color: t.ink[700] }]}>
        Thanks for accepting! Because this job spans more than a day, our team will
        email you a few appointment windows to choose from shortly.
      </Text>
    </PanelCard>
  );
}

// ── Self-serve slot picker ────────────────────────────────────────────────────

function SelfServePicker({
  t, quoteId, durationMinutes, onBooked,
}: { t: Theme; quoteId: string; durationMinutes: number; onBooked: () => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    return apiCall<Slot[]>('GET', `/api/appointments/slots?durationMinutes=${durationMinutes}`);
  }, [durationMinutes]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await fetchSlots();
        if (active) setSlots(list);
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : 'Could not load times.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [fetchSlots]);

  async function pick(slot: Slot) {
    setBusy(true); setError(null);
    try {
      // 1) Hold the slot for 10 minutes (server enforces uniqueness — no race).
      const hold = await apiCall<{ holdToken: string }>(
        'POST', '/api/appointments/holds',
        { startAt: slot.startAt, endAt: slot.endAt },
      );
      // 2) Immediately confirm the booking using that hold.
      await apiCall('POST', '/api/appointments/confirm-self-serve', {
        holdToken: hold.holdToken,
        quoteRequestId: quoteId,
        customerTimezone: CUSTOMER_TZ,
      });
      onBooked();
    } catch (e) {
      // 409 = someone grabbed it first; refresh the list.
      setError(e instanceof ApiError ? e.message : 'Could not book that time.');
      if (e instanceof ApiError && e.status === 409) {
        setSlots(await fetchSlots().catch(() => []));
      }
    } finally { setBusy(false); }
  }

  return (
    <PanelCard t={t}>
      <Text style={[s.title, { color: t.ink[900] }]}>Schedule your appointment</Text>
      <Text style={[s.help, { color: t.ink[500] }]}>
        Pick a time that works for you. Times shown in {humanZone(CUSTOMER_TZ)}.
      </Text>

      {loading && <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 12 }} />}
      {!loading && slots.length === 0 && (
        <Text style={[s.help, { color: t.ink[500] }]}>
          No open times right now — our team will reach out to schedule.
        </Text>
      )}

      <View style={{ gap: 8, marginTop: 4 }}>
        {slots.map(slot => (
          <SlotButton key={slot.startAt} t={t} disabled={busy} onPress={() => pick(slot)}>
            {fmtInZone(slot.startAt, CUSTOMER_TZ)}
          </SlotButton>
        ))}
      </View>

      {busy && <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 8 }} />}
      <ErrorText error={error} />
    </PanelCard>
  );
}

// ── Proposed-slots chooser ────────────────────────────────────────────────────

function ProposedChooser({
  t, appt, quoteId, durationMinutes, onConfirmed,
}: { t: Theme; appt: Appointment; quoteId: string; durationMinutes: number; onConfirmed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Which proposed window the customer wants. The owner may have proposed up to
  // three; the confirm endpoint takes the index, and the proposal email links
  // each window separately (?slot=N). Defaulting to 0 keeps the single-window
  // case identical to before.
  const [chosen, setChosen] = useState(0);

  const proposed = appt.proposedSlots ?? [];
  const multiple = proposed.length > 1;

  async function approveProposed() {
    setBusy(true); setError(null);
    try {
      await apiCall('POST', `/api/appointments/${appt.id}/confirm-proposed`, {
        slotIndex: chosen,
        customerTimezone: CUSTOMER_TZ,
      });
      onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not confirm that time.');
    } finally { setBusy(false); }
  }

  // Load 3 conflict-free alternatives from the owner's availability.
  async function loadAlternatives() {
    setShowAlternatives(true); setLoadingSlots(true); setError(null);
    try {
      const list = await apiCall<Slot[]>('GET', `/api/appointments/slots?durationMinutes=${durationMinutes}`);
      setSlots(list.slice(0, 3));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load other times.');
    } finally { setLoadingSlots(false); }
  }

  async function pickAlternative(slot: Slot) {
    setBusy(true); setError(null);
    try {
      const hold = await apiCall<{ holdToken: string }>(
        'POST', '/api/appointments/holds',
        { startAt: slot.startAt, endAt: slot.endAt },
      );
      await apiCall('POST', '/api/appointments/confirm-self-serve', {
        holdToken: hold.holdToken,
        quoteRequestId: quoteId,
        customerTimezone: CUSTOMER_TZ,
      });
      onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not book that time.');
      if (e instanceof ApiError && e.status === 409) loadAlternatives();
    } finally { setBusy(false); }
  }

  return (
    <PanelCard t={t}>
      <Text style={[s.title, { color: t.ink[900] }]}>Approve your appointment time</Text>
      <Text style={[s.help, { color: t.ink[500] }]}>
        {showAlternatives
          ? `Pick one of these open times. Times in ${humanZone(CUSTOMER_TZ)}.`
          : multiple
            ? `Our team proposed these times. Choose one to approve, or see other options. Times in ${humanZone(CUSTOMER_TZ)}.`
            : `Our team proposed this time. Approve it, or see other options. Times in ${humanZone(CUSTOMER_TZ)}.`}
      </Text>

      {!showAlternatives ? (
        <>
          <View style={{ gap: 8, marginTop: 4 }}>
            {proposed.map((slot, i) => (
              <SlotButton
                key={i}
                t={t}
                selected={multiple ? chosen === i : true}
                disabled={busy || !multiple}
                onPress={() => setChosen(i)}
              >
                {fmtInZone(slot.startAt, CUSTOMER_TZ)}
              </SlotButton>
            ))}
          </View>
          <View style={{ gap: 10, marginTop: 12 }}>
            <Button
              title={busy ? 'Confirming…' : multiple ? 'Approve selected time' : 'Approve this time'}
              onPress={approveProposed}
              loading={busy}
            />
            <Button title="These times don't work" variant="secondary" onPress={loadAlternatives} disabled={busy} />
          </View>
        </>
      ) : (
        <>
          {loadingSlots && <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 12 }} />}
          {!loadingSlots && slots.length === 0 && (
            <Text style={[s.help, { color: t.ink[500] }]}>
              No other open times right now — our team will reach out.
            </Text>
          )}
          <View style={{ gap: 8, marginTop: 4 }}>
            {slots.map(slot => (
              <SlotButton key={slot.startAt} t={t} disabled={busy} onPress={() => pickAlternative(slot)}>
                {fmtInZone(slot.startAt, CUSTOMER_TZ)}
              </SlotButton>
            ))}
          </View>
          <TouchableOpacity onPress={() => setShowAlternatives(false)} disabled={busy} style={{ marginTop: 12 }}>
            <Text style={[s.link, { color: t.brand.brand600 }]}>← Back to proposed {multiple ? 'times' : 'time'}</Text>
          </TouchableOpacity>
        </>
      )}
      <ErrorText error={error} />
    </PanelCard>
  );
}

// ── Confirmed view ────────────────────────────────────────────────────────────

function ConfirmedView({ t, appt, onChanged }: { t: Theme; appt: Appointment; onChanged: () => void }) {
  const router = useRouter();
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameZone = appt.customerTimezone === appt.businessTimezone;

  async function cancel() {
    if (!appt.cancelToken) return;
    setBusy(true); setError(null);
    try {
      await apiCall('POST', `/api/book/cancel/${appt.cancelToken}`, { reason });
      setCanceling(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel.');
    } finally { setBusy(false); }
  }

  return (
    <View style={[s.card, s.confirmedCard, { borderRadius: t.radius }]}>
      <View style={s.confirmedBadge}>
        <Text style={s.confirmedBadgeText}>Confirmed</Text>
      </View>
      <Text style={s.confirmedTime}>{fmtInZone(appt.startAt!, appt.customerTimezone)}</Text>
      <Text style={[s.help, { color: t.ink[500] }]}>
        Your time zone ({humanZone(appt.customerTimezone)})
      </Text>
      {!sameZone && (
        <Text style={[s.help, { color: t.ink[500] }]}>
          Business time: {fmtInZone(appt.startAt!, appt.businessTimezone)} ({humanZone(appt.businessTimezone)})
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        {appt.rescheduleToken && (
          <View style={{ flex: 1 }}>
            <Button
              title="Reschedule"
              variant="secondary"
              disabled={busy}
              onPress={() => router.push(`/book/reschedule/${appt.rescheduleToken}` as any)}
            />
          </View>
        )}
        {!canceling && (
          <Button title="Cancel" variant="secondary" fullWidth={false} onPress={() => setCanceling(true)} disabled={busy} />
        )}
      </View>

      {canceling && (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Input
            value={reason}
            onChangeText={setReason}
            placeholder="Reason for canceling (optional)"
            multiline
            style={{ height: 72, textAlignVertical: 'top' }}
          />
          <ErrorText error={error} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={busy ? 'Canceling…' : 'Confirm cancellation'}
                variant="secondary"
                onPress={cancel}
                loading={busy}
              />
            </View>
            <Button title="Keep it" variant="secondary" fullWidth={false} onPress={() => setCanceling(false)} />
          </View>
        </View>
      )}
    </View>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function PanelCard({ t, children }: { t: Theme; children: React.ReactNode }) {
  return (
    <View style={[s.card, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }, t.shadowSoft]}>
      {children}
    </View>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <Text style={s.error}>{error}</Text>;
}

const s = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, gap: 6, marginBottom: 16 },
  confirmedCard: { borderColor: '#86efac', backgroundColor: '#f0fdf4' },
  confirmedBadge: { alignSelf: 'flex-start', backgroundColor: '#bbf7d0', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4 },
  confirmedBadgeText: { fontSize: 10, fontWeight: '800', color: '#14532d', textTransform: 'uppercase', letterSpacing: 0.5 },
  confirmedTime: { fontSize: 18, fontWeight: '800', color: '#14532d' },
  title: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  help: { fontSize: 12, lineHeight: 17 },
  link: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 13, color: '#dc2626', marginTop: 8 },
});
