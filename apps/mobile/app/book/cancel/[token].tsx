import { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { apiCall, ApiError } from '@/lib/api';
import { BookingShell } from '@/components/BookingShell';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input } from '@/components/ui';

/**
 * Cancel an appointment from the emailed link — native mirror of web's
 * /book/cancel/[token]. Opened via App Link / Universal Link; works signed out
 * because the cancel token is the credential.
 */
export default function CancelBookingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true); setError(null);
    try {
      await apiCall('POST', `/api/book/cancel/${token}`, { reason });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <BookingShell title="Appointment canceled">
        <Text style={[s.body, { color: t.ink[700] }]}>
          Your appointment has been canceled. If you'd like to reschedule, contact the
          business and they'll get you set up again.
        </Text>
      </BookingShell>
    );
  }

  return (
    <BookingShell title="Cancel your appointment">
      <Text style={[s.body, { color: t.ink[700] }]}>
        Are you sure you want to cancel? Let us know why (optional) so we can improve.
      </Text>
      <Input
        value={reason}
        onChangeText={setReason}
        placeholder="Reason for canceling"
        multiline
        style={{ height: 88, textAlignVertical: 'top' }}
      />
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Canceling…' : 'Confirm cancellation'} onPress={cancel} loading={busy} />
    </BookingShell>
  );
}

const s = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13, color: '#dc2626' },
});
