import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiCall, ApiError } from '@/lib/api';
import { startBackgroundLocation, stopBackgroundLocation } from '@/lib/locationTask';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Heading } from '@/components/ui';

interface TimeEntry {
  id: string; clockedInAt: string; clockedOutAt: string | null;
  breakMinutes: number; status: string;
  notesByStaff: string | null; notesByAdmin: string | null;
}

function elapsed(from: string) {
  const s = Math.floor((Date.now() - new Date(from).getTime()) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtDur(inAt: string, outAt: string, brk: number) {
  const mins = Math.max(0, Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60_000) - brk);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface Pay {
  workedMinutes: number; basePayCents: number; grossPayCents: number; payType: string;
  from: string; to: string;
}
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const hm  = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

export default function TimesheetScreen() {
  const t = useTheme();
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [tick, setTick] = useState('00:00:00');
  const [note, setNote] = useState('');
  const [brk, setBrk] = useState('0');
  const [busy, setBusy] = useState(false);
  const [gpsOn, setGpsOn] = useState(false);
  const [pay, setPay] = useState<Pay | null>(null);
  const routeIdRef = useRef<string | null>(null);

  async function load() {
    const [cur, list, payInfo] = await Promise.all([
      apiCall<TimeEntry | null>('GET', '/api/me/time/current').catch(() => null),
      apiCall<TimeEntry[]>('GET', '/api/me/time').catch(() => []),
      apiCall<Pay>('GET', '/api/me/pay').catch(() => null),
    ]);
    setActive(cur);
    setEntries(list.filter(e => e.status !== 'ACTIVE'));
    setPay(payInfo);
    if (cur) setTick(elapsed(cur.clockedInAt));
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(elapsed(active.clockedInAt)), 1000);
    return () => clearInterval(id);
  }, [active]);

  async function startGps(entryId: string) {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      Alert.alert('Location off', 'Allow location access to record your work route and mileage.');
      return;
    }
    // Best-effort upgrade to background ("Always" on iOS) so the route keeps
    // recording when the app is backgrounded or the phone is locked. If denied,
    // the same task still tracks while the app is open in the foreground.
    await Location.requestBackgroundPermissionsAsync().catch(() => {});

    const route = await apiCall<{ id: string }>('POST', '/api/me/routes', { timeEntryId: entryId }).catch(() => null);
    if (!route) return;
    routeIdRef.current = route.id;
    setGpsOn(true);
    // Foreground + background GPS updates are posted by the TaskManager task
    // (src/lib/locationTask.ts), which the server geofences into stop check-ins.
    await startBackgroundLocation(route.id).catch(() => {});
  }

  async function stopGps() {
    await stopBackgroundLocation().catch(() => {});
    const rid = routeIdRef.current;
    if (rid) await apiCall('POST', `/api/me/routes/${rid}/end`).catch(() => {});
    routeIdRef.current = null;
    setGpsOn(false);
  }

  async function clockIn() {
    setBusy(true);
    try {
      const entry = await apiCall<TimeEntry>('POST', '/api/me/time/clock-in', { notesByStaff: note || undefined });
      setActive(entry); setNote('');
      await startGps(entry.id);
      await load();
    } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  function clockOut() {
    // Confirm — an accidental tap ends the shift AND the GPS route.
    Alert.alert('Clock out', 'End your shift now?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clock out', style: 'destructive', onPress: async () => {
          setBusy(true);
          await stopGps();
          try {
            await apiCall('POST', '/api/me/time/clock-out', { notesByStaff: note || undefined, breakMinutes: parseInt(brk) || 0 });
            setActive(null); setNote(''); setBrk('0');
            await load();
          } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : 'Failed'); }
          finally { setBusy(false); }
        },
      },
    ]);
  }

  const inputStyle = [s.input, { borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900], backgroundColor: t.surface[0] }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface[50] }} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <Heading style={{ marginBottom: 16 }}>Timesheet</Heading>

        {/* Clock widget */}
        <Card padding={16} style={{ marginBottom: 12 }}>
          <Text style={[s.subLabel, { color: t.ink[500] }]}>{active ? 'Clocked in' : 'Not clocked in'}</Text>
          <Text style={[s.ticker, { color: active ? t.brand.brand600 : t.surface[200] }]}>{active ? tick : '00:00:00'}</Text>
          {active && (
            <Text style={[s.subText, { color: t.ink[500] }]}>
              Since {new Date(active.clockedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {gpsOn ? '  ·  📍 GPS on' : ''}
            </Text>
          )}
          <TextInput
            style={inputStyle}
            value={note}
            onChangeText={setNote}
            placeholder={active ? 'Clock-out note (optional)' : 'Note (optional)'}
            placeholderTextColor={t.ink[300]}
          />
          {active && (
            <View style={s.row}>
              <Text style={[s.subLabel, { color: t.ink[500] }]}>Break (min)</Text>
              <TextInput style={[inputStyle, { width: 80, marginLeft: 8 }]} value={brk} onChangeText={setBrk} keyboardType="number-pad" placeholderTextColor={t.ink[300]} />
            </View>
          )}
          <TouchableOpacity
            style={[s.btn, { borderRadius: t.radius, backgroundColor: active ? '#dc2626' : t.brand.brand500 }, busy && { opacity: 0.6 }]}
            onPress={active ? clockOut : clockIn}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{active ? 'Clock out' : 'Clock in'}</Text>}
          </TouchableOpacity>
        </Card>

        {/* This period's pay — hours × your hourly rate */}
        {pay && (
          <Card padding={16} style={{ marginBottom: 12 }}>
            <Text style={[s.subLabel, { color: t.ink[500] }]}>This month’s pay</Text>
            <Text style={[s.payAmount, { color: t.ink[900] }]}>{usd(pay.grossPayCents)}</Text>
            <Text style={[s.subText, { color: t.ink[500], marginTop: 4, marginBottom: 0 }]}>
              {hm(pay.workedMinutes)} worked
              {pay.payType === 'HOURLY' && pay.basePayCents > 0 ? `  ·  ${usd(pay.basePayCents)}/hr` : ''}
            </Text>
          </Card>
        )}

        {/* Recent shifts */}
        <Text style={[s.sectionHeading, { color: t.ink[900] }]}>Recent shifts</Text>
        {entries.length === 0 && <Text style={[s.emptyText, { color: t.ink[300] }]}>No completed shifts yet.</Text>}
        {entries.map(e => (
          <Card key={e.id} padding={16} style={{ marginBottom: 12 }}>
            <View style={s.row}>
              <Text style={[s.dateText, { color: t.ink[900] }]}>{new Date(e.clockedInAt).toLocaleDateString()}</Text>
              {e.status === 'EDITED' && <Text style={[s.editedTag, { color: t.ink[500], backgroundColor: t.surface[100] }]}>edited</Text>}
            </View>
            <Text style={[s.subText, { color: t.ink[500] }]}>
              {new Date(e.clockedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {' → '}
              {e.clockedOutAt ? new Date(e.clockedOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </Text>
            {e.clockedOutAt && <Text style={[s.durText, { color: t.ink[900] }]}>{fmtDur(e.clockedInAt, e.clockedOutAt, e.breakMinutes)}</Text>}
            {(e.notesByAdmin || e.notesByStaff) && (
              <Text style={[s.noteText, { color: t.ink[500] }]}>{e.notesByAdmin ? `Admin: ${e.notesByAdmin}` : e.notesByStaff}</Text>
            )}
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  content: { padding: 20 },
  sectionHeading: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  subLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  ticker: { fontSize: 42, fontWeight: '700', fontVariant: ['tabular-nums'], marginVertical: 8 },
  payAmount: { fontSize: 32, fontWeight: '700', marginTop: 6 },
  subText: { fontSize: 13, marginBottom: 12 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  btn: { paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  dateText: { fontSize: 15, fontWeight: '600', flex: 1 },
  editedTag: { fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  durText: { fontSize: 18, fontWeight: '600', marginTop: 4 },
  noteText: { fontSize: 12, marginTop: 6 },
  emptyText: { textAlign: 'center', marginTop: 12, marginBottom: 24 },
});
