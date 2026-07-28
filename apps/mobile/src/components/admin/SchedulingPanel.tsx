/**
 * SchedulingPanel — native mirror of
 * apps/web/src/app/admin/quotes/[id]/SchedulingPanel.tsx.
 *
 * Owner-side scheduling control. Shows the current appointment state and — when
 * the quote is accepted but unscheduled — lets the owner propose up to 3 windows
 * for the customer to confirm (the complex/multi-day flow).
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, ApiError } from '@/lib/api';
import { CUSTOMER_TZ, fmtLocal, humanZone, type Appointment } from '@/lib/appointments';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Button } from '@/components/ui';
import { DateTimeField } from '@/components/DateTimeField';

/** Statuses where an appointment is meaningful — same gate as web. */
const SCHEDULABLE = ['ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS'];
const MAX_WINDOWS = 3;
/** Default window length; the real duration is enforced server-side. */
const WINDOW_MS = 2 * 60 * 60_000;

export function SchedulingPanel({
  quoteId, status, onChanged,
}: { quoteId: string; status: string; onChanged: () => void }) {
  const t = useTheme();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [windows, setWindows] = useState<(Date | null)[]>([null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiCall<Appointment[]>('GET', `/api/quotes/${quoteId}/appointments`);
      setAppt(list.find(a => a.status === 'CONFIRMED' || a.status === 'PROPOSED') ?? null);
    } catch {
      setAppt(null);
    } finally { setLoading(false); }
  }, [quoteId]);

  useEffect(() => {
    if (SCHEDULABLE.includes(status)) load();
    else setLoading(false);
  }, [status, load]);

  // Only relevant once the customer has accepted the estimate.
  if (!SCHEDULABLE.includes(status)) return null;
  if (loading) return null;

  async function submitProposal() {
    const valid = windows.filter((w): w is Date => w != null);
    if (valid.length < 1) { setError('Add at least one window.'); return; }
    setBusy(true); setError(null);
    try {
      const payload = valid.map(start => ({
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + WINDOW_MS).toISOString(),
      }));
      await apiCall('POST', '/api/appointments/propose', { quoteRequestId: quoteId, windows: payload });
      setProposing(false);
      setWindows([null]);
      onChanged();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not propose slots.');
    } finally { setBusy(false); }
  }

  async function cancelAppointment() {
    if (!appt) return;
    setBusy(true); setError(null);
    try {
      await apiCall('DELETE', `/api/appointments/${appt.id}`, { reason: 'Canceled by business' });
      onChanged();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel.');
    } finally { setBusy(false); }
  }

  // ── Confirmed appointment ──
  if (appt?.status === 'CONFIRMED' && appt.startAt) {
    return (
      <PanelCard t={t}>
        <Text style={[s.title, { color: t.ink[900] }]}>Appointment</Text>
        <Text style={[s.big, { color: t.ink[900] }]}>{fmtLocal(appt.startAt)}</Text>
        <Text style={[s.help, { color: t.ink[500] }]}>
          {humanZone(appt.businessTimezone)} · booked {appt.mode === 'SELF_SERVE' ? 'by customer' : 'via proposal'}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Button
            title={busy ? 'Canceling…' : 'Cancel appointment'}
            variant="secondary"
            fullWidth={false}
            onPress={cancelAppointment}
            loading={busy}
          />
        </View>
        {error && <Text style={s.error}>{error}</Text>}
      </PanelCard>
    );
  }

  // ── Proposed, awaiting customer pick ──
  if (appt?.status === 'PROPOSED' && appt.proposedSlots?.length) {
    return (
      <PanelCard t={t}>
        <Text style={[s.title, { color: t.ink[900] }]}>Awaiting customer</Text>
        <Text style={[s.help, { color: t.ink[500] }]}>
          You proposed these windows. The customer will confirm one:
        </Text>
        <View style={{ gap: 4, marginTop: 4 }}>
          {appt.proposedSlots.map((slot, i) => (
            <Text key={i} style={[s.body, { color: t.ink[700] }]}>• {fmtLocal(slot.startAt)}</Text>
          ))}
        </View>
        <View style={{ marginTop: 12 }}>
          <Button
            title={busy ? 'Withdrawing…' : 'Withdraw proposal'}
            variant="secondary"
            fullWidth={false}
            onPress={cancelAppointment}
            loading={busy}
          />
        </View>
        {error && <Text style={s.error}>{error}</Text>}
      </PanelCard>
    );
  }

  // ── Accepted, unscheduled → offer to propose windows ──
  return (
    <PanelCard t={t}>
      <Text style={[s.title, { color: t.ink[900] }]}>Scheduling</Text>
      <Text style={[s.help, { color: t.ink[500] }]}>
        Short jobs let the customer self-book. For multi-day or complex work, propose
        2–3 windows for them to choose from. Times in {humanZone(CUSTOMER_TZ)}.
      </Text>

      {!proposing ? (
        <View style={{ marginTop: 8 }}>
          <Button title="Propose appointment windows" onPress={() => setProposing(true)} />
        </View>
      ) : (
        <View style={{ gap: 12, marginTop: 8 }}>
          {windows.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <DateTimeField
                  value={w}
                  onChange={d => setWindows(ws => ws.map((x, j) => (j === i ? d : x)))}
                  placeholder={`Window ${i + 1}`}
                  disabled={busy}
                />
              </View>
              {windows.length > 1 && (
                <TouchableOpacity
                  accessibilityLabel={`Remove window ${i + 1}`}
                  onPress={() => setWindows(ws => ws.filter((_, j) => j !== i))}
                  style={[s.removeBtn, { borderColor: t.surface[200], borderRadius: t.radius }]}
                >
                  <Ionicons name="close" size={18} color={t.ink[500]} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {windows.length < MAX_WINDOWS && (
            <TouchableOpacity onPress={() => setWindows(ws => [...ws, null])}>
              <Text style={[s.link, { color: t.brand.brand600 }]}>+ Add another window</Text>
            </TouchableOpacity>
          )}
          {error && <Text style={s.error}>{error}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button title={busy ? 'Sending…' : 'Send to customer'} onPress={submitProposal} loading={busy} />
            </View>
            <Button
              title="Cancel"
              variant="secondary"
              fullWidth={false}
              onPress={() => { setProposing(false); setError(null); }}
              disabled={busy}
            />
          </View>
        </View>
      )}
    </PanelCard>
  );
}

function PanelCard({ t, children }: { t: Theme; children: React.ReactNode }) {
  return (
    <View style={[s.card, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }, t.shadowSoft]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, gap: 6, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700' },
  big: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  help: { fontSize: 12, lineHeight: 17 },
  link: { fontSize: 13, fontWeight: '600' },
  removeBtn: { borderWidth: 1, padding: 12, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 13, color: '#dc2626', marginTop: 8 },
});
