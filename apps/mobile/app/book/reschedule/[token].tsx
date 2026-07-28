import { useCallback, useEffect, useState } from 'react';
import { Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { apiCall, ApiError } from '@/lib/api';
import { CUSTOMER_TZ, fmtInZone, humanZone, type Slot } from '@/lib/appointments';
import { BookingShell, SlotButton } from '@/components/BookingShell';
import { useTheme } from '@/theme/ThemeProvider';

interface RescheduleData {
  appointment: {
    startAt: string | null;
    customerTimezone: string;
    quoteRequest?: { service?: { name?: string } };
  };
  availableSlots: Slot[];
}

/**
 * Reschedule from the emailed link — native mirror of web's
 * /book/reschedule/[token]. Also the in-app destination from a confirmed
 * appointment, matching how web's BookingSection links here rather than
 * duplicating the picker.
 */
export default function RescheduleBookingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const [data, setData] = useState<RescheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiCall<RescheduleData>('GET', `/api/book/reschedule/${token}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reschedule link not found.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function pick(slot: Slot) {
    setBusy(true); setError(null);
    try {
      await apiCall('POST', `/api/book/reschedule/${token}`, {
        startAt: slot.startAt,
        endAt: slot.endAt,
        customerTimezone: CUSTOMER_TZ,
      });
      setDone(slot.startAt);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reschedule.');
      // Slot may have been taken — refresh the list.
      if (e instanceof ApiError && e.status === 409) load();
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <BookingShell title="Loading…">
        <ActivityIndicator color={t.brand.brand500} />
        <Text style={[s.body, { color: t.ink[700] }]}>Fetching available times…</Text>
      </BookingShell>
    );
  }

  if (done) {
    return (
      <BookingShell title="Rescheduled 🎉">
        <Text style={[s.body, { color: t.ink[700] }]}>
          Your appointment is now set for {fmtInZone(done, CUSTOMER_TZ)}. A confirmation
          email is on its way.
        </Text>
      </BookingShell>
    );
  }

  if (error && !data) {
    return (
      <BookingShell title="Link not available">
        <Text style={s.error}>{error}</Text>
      </BookingShell>
    );
  }

  return (
    <BookingShell title="Reschedule your appointment">
      {data?.appointment.startAt && (
        <Text style={[s.body, { color: t.ink[700] }]}>
          Currently scheduled for {fmtInZone(data.appointment.startAt, CUSTOMER_TZ)}. Pick a
          new time below.
        </Text>
      )}
      <Text style={[s.help, { color: t.ink[500] }]}>Times shown in {humanZone(CUSTOMER_TZ)}.</Text>

      {data?.availableSlots.length === 0 && (
        <Text style={[s.body, { color: t.ink[700] }]}>
          No open times right now — please contact the business directly.
        </Text>
      )}

      <View style={{ gap: 8 }}>
        {data?.availableSlots.map(slot => (
          <SlotButton key={slot.startAt} t={t} disabled={busy} onPress={() => pick(slot)}>
            {fmtInZone(slot.startAt, CUSTOMER_TZ)}
          </SlotButton>
        ))}
      </View>

      {busy && <ActivityIndicator color={t.brand.brand500} />}
      {error && <Text style={s.error}>{error}</Text>}
    </BookingShell>
  );
}

const s = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  help: { fontSize: 12 },
  error: { fontSize: 13, color: '#dc2626' },
});
