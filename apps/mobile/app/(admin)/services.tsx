import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput, Switch, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';
import { Card, Badge } from '@/components/ui';

interface Service {
  id: string; slug: string; name: string; category: string; description: string;
  active: boolean; visibleOnPublicSite: boolean;
  pricingMode: string; basePriceCents: number; questions: any[];
}

function fmtMode(m: string) { return m.replace(/_/g, ' ').toLowerCase(); }

export default function AdminServicesScreen() {
  const t = useTheme();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);

  // Edit modal — core fields (full questions editor lives on web).
  const [editing, setEditing] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [active, setActive] = useState(true);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { setServices(await apiCall<Service[]>('GET', '/api/services')); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  function openEdit(svc: Service) {
    setEditing(svc);
    setName(svc.name);
    setDesc(svc.description);
    setPrice(String(svc.basePriceCents / 100));
    setActive(svc.active);
    setVisible(svc.visibleOnPublicSite);
  }

  async function save() {
    if (!editing) return;
    if (!name.trim()) return Alert.alert('Name required');
    const parsedPrice = parseFloat(price);
    // Don't silently turn a typo into $0 — make the admin fix it.
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return Alert.alert('Invalid price', 'Enter a valid base price (use 0 for no base price).');
    }
    setBusy(true);
    try {
      await apiCall('PATCH', `/api/services/${editing.id}`, {
        name: name.trim(),
        description: desc.trim(),
        basePriceCents: Math.round(parsedPrice * 100),
        active,
        visibleOnPublicSite: visible,
      });
      setEditing(null);
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setBusy(false); }
  }

  const modalInput = [m.input, { borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900], backgroundColor: t.surface[50] }];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <Text style={[s.heading, { color: t.ink[900] }]}>Services</Text>
        <Text style={[s.sub, { color: t.ink[300] }]}>{services.length} {services.length === 1 ? 'service' : 'services'}</Text>
      </View>

      {loading && !refresh && <ActivityIndicator style={{ marginTop: 40 }} color={t.brand.brand500} />}
      {failed && !loading && <LoadFailedBanner onRetry={load} />}

      <FlatList
        data={services}
        keyExtractor={s => s.id}
        contentContainerStyle={s2.list}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={t.brand.brand500} />}
        renderItem={({ item: svc }) => (
          <TouchableOpacity activeOpacity={0.8} onPress={() => openEdit(svc)}>
            <Card padding={16}>
              <View style={s2.row}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={[s2.name, { color: t.ink[900] }]}>{svc.name}</Text>
                    {!svc.active && <Badge>Inactive</Badge>}
                  </View>
                  <Text style={[s2.meta, { color: t.ink[300] }]}>{svc.category} · {fmtMode(svc.pricingMode)} · {svc.questions.length} questions</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s2.fromLabel, { color: t.ink[300] }]}>From</Text>
                  <Text style={[s2.price, { color: t.ink[900] }]}>${(svc.basePriceCents / 100).toLocaleString('en-US')}</Text>
                  <Text style={[s2.edit, { color: t.brand.brand600 }]}>Edit →</Text>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={!loading && !failed ? <Text style={[s2.empty, { color: t.ink[300] }]}>No services yet. Create services from the web admin or clone from the industry catalog.</Text> : null}
      />

      {/* Edit modal */}
      <Modal visible={!!editing} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[m.title, { color: t.ink[900] }]}>Edit service</Text>
            <Text style={[m.label, { color: t.ink[700] }]}>Name</Text>
            <TextInput style={modalInput} value={name} onChangeText={setName} placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Description</Text>
            <TextInput style={[modalInput, { height: 70, textAlignVertical: 'top' }]} value={desc} onChangeText={setDesc} multiline placeholderTextColor={t.ink[300]} />
            <Text style={[m.label, { color: t.ink[700] }]}>Base price ($)</Text>
            <TextInput style={modalInput} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholderTextColor={t.ink[300]} />
            <View style={m.switchRow}>
              <Text style={[m.switchLabel, { color: t.ink[700] }]}>Active</Text>
              <Switch value={active} onValueChange={setActive} trackColor={{ true: t.brand.brand500 }} />
            </View>
            <View style={m.switchRow}>
              <Text style={[m.switchLabel, { color: t.ink[700] }]}>Visible on public site</Text>
              <Switch value={visible} onValueChange={setVisible} trackColor={{ true: t.brand.brand500 }} />
            </View>
            <Text style={[m.note, { color: t.ink[300] }]}>Pricing rules and questions are edited on the web admin.</Text>
            <View style={m.btnRow}>
              <TouchableOpacity style={[m.cancel, { backgroundColor: t.surface[100], borderRadius: t.radius }]} onPress={() => setEditing(null)}><Text style={[m.cancelText, { color: t.ink[700] }]}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[m.confirm, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={save} disabled={busy}>
                <Text style={[m.confirmText, { color: t.brand.onBrand }]}>{busy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { padding: 20, borderBottomWidth: 1 },
  heading: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
});
const s2 = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 4 },
  fromLabel: { fontSize: 11 },
  price: { fontSize: 15, fontWeight: '700' },
  edit: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 48, paddingHorizontal: 32, lineHeight: 22 },
});
const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, padding: 12, fontSize: 15 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  switchLabel: { fontSize: 14 },
  note: { fontSize: 12, marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancel: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirm: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '600' },
});
