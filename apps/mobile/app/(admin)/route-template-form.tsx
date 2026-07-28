import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { Input, Label } from '@/components/ui';

type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
const RECURRENCE: { value: Recurrence; label: string }[] = [
  { value: 'NONE', label: 'One-off' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 wks' },
  { value: 'MONTHLY', label: 'Monthly' },
];

interface Stop { label: string; addressLine: string; city: string; state: string; postalCode: string }
const emptyStop = (): Stop => ({ label: '', addressLine: '', city: '', state: '', postalCode: '' });
interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }

/** Create/edit a route template (reusable blueprint). Mirror of web TemplateBuilder. */
export default function RouteTemplateFormScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [name, setName] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('WEEKLY');
  const [startDate, setStartDate] = useState('');
  const [crew, setCrew] = useState<string[]>([]);
  const [stops, setStops] = useState<Stop[]>([emptyStop()]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const members = await apiCall<Member[]>('GET', '/api/me/team').catch(() => []);
        setStaff(members.filter(m => m.active && m.role !== 'CUSTOMER').map(m => ({ id: m.id, name: m.fullName ?? m.user.email })));
        if (editing) {
          const tpl = await apiCall<{
            name: string; recurrence: Recurrence | null; startDate: string | null;
            assignees: { membershipId: string }[];
            stops: { label: string; addressLine: string | null; city: string | null; state: string | null; postalCode: string | null }[];
          }>('GET', `/api/admin/route-templates/${id}`);
          setName(tpl.name);
          setRecurrence(tpl.recurrence ?? 'WEEKLY');
          setStartDate(tpl.startDate ? tpl.startDate.slice(0, 10) : '');
          setCrew(tpl.assignees.map(a => a.membershipId));
          setStops(tpl.stops.length
            ? tpl.stops.map(s => ({ label: s.label ?? '', addressLine: s.addressLine ?? '', city: s.city ?? '', state: s.state ?? '', postalCode: s.postalCode ?? '' }))
            : [emptyStop()]);
        }
      } finally { setLoading(false); }
    })();
  }, [id, editing]);

  function toggleCrew(memberId: string) {
    setCrew(c => c.includes(memberId) ? c.filter(x => x !== memberId) : [...c, memberId]);
  }
  function setStop(i: number, patch: Partial<Stop>) {
    setStops(ss => ss.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  async function save() {
    setError(null);
    if (!name.trim()) { setError('Give this template a name.'); return; }
    const cleanStops = stops.filter(s => s.label.trim()).map(s => ({
      label: s.label.trim(),
      addressLine: s.addressLine.trim() || undefined,
      city: s.city.trim() || undefined,
      state: s.state.trim() || undefined,
      postalCode: s.postalCode.trim() || undefined,
    }));
    if (cleanStops.length === 0) { setError('Add at least one stop (a label is required).'); return; }
    const body = {
      name: name.trim(),
      recurrence,
      startDate: recurrence === 'NONE' ? null : (startDate || null),
      membershipIds: crew,
      stops: cleanStops,
    };
    setBusy(true);
    try {
      if (editing) await apiCall('PATCH', `/api/admin/route-templates/${id}`, body);
      else await apiCall('POST', '/api/admin/route-templates', body);
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the template.');
      setBusy(false);
    }
  }

  if (loading) {
    return <View style={[s.center, { backgroundColor: t.surface[50] }]}><ActivityIndicator color={t.brand.brand500} /></View>;
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={t.brand.brand600} />
          <Text style={[s.backText, { color: t.brand.brand600 }]}>Templates</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: t.ink[900] }]}>{editing ? 'Edit template' : 'New template'}</Text>
        <View style={{ width: 90 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Input label="Template name" placeholder="e.g. Mon–Fri — East side" value={name} onChangeText={setName} />

          <Label>Schedule</Label>
          <View style={s.recRow}>
            {RECURRENCE.map(r => {
              const on = recurrence === r.value;
              return (
                <TouchableOpacity key={r.value} onPress={() => setRecurrence(r.value)}
                  style={[s.recChip, { backgroundColor: on ? t.brand.brand600 : t.surface[100] }]}>
                  <Text style={[s.recText, { color: on ? t.brand.onBrand : t.ink[700] }]}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {recurrence !== 'NONE' && (
            <Input label="Start date (YYYY-MM-DD)" placeholder="2026-07-01" value={startDate} onChangeText={setStartDate} autoCapitalize="none" />
          )}

          <Label>Crew {recurrence !== 'NONE' ? '(required to auto-run)' : '(default)'}</Label>
          <View style={s.crewRow}>
            {staff.length === 0
              ? <Text style={[s.dim, { color: t.ink[500] }]}>No staff — add staff on the Team page first.</Text>
              : staff.map(m => {
                const on = crew.includes(m.id);
                return (
                  <TouchableOpacity key={m.id} onPress={() => toggleCrew(m.id)}
                    style={[s.crewChip, { backgroundColor: on ? t.brand.brand500 : t.surface[0], borderColor: on ? t.brand.brand500 : t.surface[200] }]}>
                    <Text style={[s.crewText, { color: on ? t.brand.onBrand : t.ink[700] }]}>{on ? '✓ ' : ''}{m.name}</Text>
                  </TouchableOpacity>
                );
              })}
          </View>

          <Label>Stops</Label>
          {stops.map((stop, i) => (
            <View key={i} style={[s.stopCard, { backgroundColor: t.surface[0], borderColor: t.surface[200] }]}>
              <View style={s.stopTop}>
                <Text style={[s.stopNum, { color: t.ink[500] }]}>Stop {i + 1}</Text>
                {stops.length > 1 && (
                  <TouchableOpacity onPress={() => setStops(ss => ss.filter((_, idx) => idx !== i))} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={t.ink[300]} />
                  </TouchableOpacity>
                )}
              </View>
              <Input placeholder="Label (e.g. Smith residence)" value={stop.label} onChangeText={v => setStop(i, { label: v })} />
              <Input placeholder="Street address" value={stop.addressLine} onChangeText={v => setStop(i, { addressLine: v })} />
              <View style={s.cityRow}>
                <View style={{ flex: 2 }}><Input placeholder="City" value={stop.city} onChangeText={v => setStop(i, { city: v })} /></View>
                <View style={{ flex: 1 }}><Input placeholder="ST" value={stop.state} onChangeText={v => setStop(i, { state: v.toUpperCase() })} maxLength={2} autoCapitalize="characters" /></View>
                <View style={{ flex: 1.3 }}><Input placeholder="ZIP" value={stop.postalCode} onChangeText={v => setStop(i, { postalCode: v })} keyboardType="number-pad" /></View>
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={() => setStops(ss => [...ss, emptyStop()])} style={[s.addStop, { borderColor: t.surface[200] }]}>
            <Ionicons name="add" size={18} color={t.brand.brand600} />
            <Text style={[s.addStopText, { color: t.brand.brand600 }]}>Add stop</Text>
          </TouchableOpacity>

          {error && <Text style={[s.error, { color: '#b91c1c' }]}>{error}</Text>}

          <TouchableOpacity onPress={save} disabled={busy} style={[s.save, { backgroundColor: t.brand.brand500, opacity: busy ? 0.6 : 1 }]}>
            <Text style={[s.saveText, { color: t.brand.onBrand }]}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create template'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { flexDirection: 'row', alignItems: 'center', width: 90 },
  backText: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800' },
  scroll: { padding: 16, gap: 6, paddingBottom: 48 },
  recRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  recChip: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  recText: { fontSize: 12, fontWeight: '700' },
  crewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  crewChip: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  crewText: { fontSize: 13, fontWeight: '600' },
  dim: { fontSize: 13 },
  stopCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10, gap: 8 },
  stopTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopNum: { fontSize: 12, fontWeight: '700' },
  cityRow: { flexDirection: 'row', gap: 8 },
  addStop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, marginBottom: 12 },
  addStopText: { fontSize: 14, fontWeight: '700' },
  error: { fontSize: 13, marginBottom: 8 },
  save: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  saveText: { fontSize: 16, fontWeight: '700' },
});
