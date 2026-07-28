import { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { apiCall, ApiError } from '@/lib/api';
import { CUSTOMER_TZ } from '@/lib/appointments';
import { BookingShell } from '@/components/BookingShell';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from '@/components/ui';

/**
 * One-click confirm of a proposed window — native mirror of web's
 * /book/confirm-proposed/[appointmentId].
 *
 * The owner's proposal email emits one link per window (`?slot=0`, `?slot=1`…),
 * so the slot the customer tapped arrives as a query param. Unauthenticated:
 * POST /api/book/confirm-proposed/:id carries no auth guard and resolves the
 * tenant from the appointment row.
 */
export default function ConfirmProposedScreen() {
  const { appointmentId, slot } = useLocalSearchParams<{ appointmentId: string; slot?: string }>();
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slotIndex = slot ?? '0';

  async function confirm() {
    setBusy(true); setError(null);
    try {
      await apiCall('POST', `/api/book/confirm-proposed/${appointmentId}?slot=${slotIndex}`, {
        customerTimezone: CUSTOMER_TZ,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not confirm. The slot may have been taken.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <BookingShell title="Appointment confirmed 🎉">
        <Text style={[s.body, { color: t.ink[700] }]}>
          You're all set. A confirmation email is on its way with the details and
          links to reschedule or cancel if you need to.
        </Text>
      </BookingShell>
    );
  }

  return (
    <BookingShell title="Confirm your appointment">
      <Text style={[s.body, { color: t.ink[700] }]}>
        Tap below to lock in the time you selected. We'll email you a confirmation.
      </Text>
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Confirming…' : 'Confirm this time'} onPress={confirm} loading={busy} />
    </BookingShell>
  );
}

const s = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13, color: '#dc2626' },
});
