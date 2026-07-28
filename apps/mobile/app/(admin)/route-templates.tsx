import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';
import { Muted } from '@/components/ui';

interface Template {
  id: string;
  name: string;
  recurrence?: string | null;
  createdAt: string;
  _count?: { stops: number };
  assignees?: Array<{ membershipId: string }>;
}

const RECURRENCE_LABEL: Record<string, string> = {
  DAILY: 'Daily', WEEKLY: 'Weekly', BIWEEKLY: 'Every 2 weeks', MONTHLY: 'Monthly',
};

/** Route templates (reusable blueprints) — list + delete + link to the editor.
 *  Mobile mirror of web /admin/routes/templates. No run/stop here. */
export default function RouteTemplatesScreen() {
  const t = useTheme();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTemplates(await apiCall<Template[]>('GET', '/api/admin/route-templates')); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmDelete(tpl: Template) {
    Alert.alert('Delete template?', `“${tpl.name}” — routes already created from it are not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await apiCall('DELETE', `/api/admin/route-templates/${tpl.id}`); setTemplates(ts => ts.filter(x => x.id !== tpl.id)); }
          catch { Alert.alert('Error', 'Could not delete the template.'); }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={t.brand.brand600} />
          <Text style={[s.backText, { color: t.brand.brand600 }]}>Routes</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: t.ink[900] }]}>Templates</Text>
        <TouchableOpacity onPress={() => router.push('/(admin)/route-template-form' as any)} style={[s.newBtn, { backgroundColor: t.brand.brand500 }]}>
          <Text style={[s.newBtnText, { color: t.brand.onBrand }]}>+ New</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 28 }} color={t.brand.brand500} />}
      {failed && !loading && <LoadFailedBanner onRetry={load} />}

      <FlatList
        data={templates}
        keyExtractor={tpl => tpl.id}
        contentContainerStyle={s.list}
        renderItem={({ item: tpl }) => {
          const rec = tpl.recurrence && tpl.recurrence !== 'NONE'
            ? (RECURRENCE_LABEL[tpl.recurrence] ?? tpl.recurrence)
            : null;
          return (
            <View style={[s.card, { backgroundColor: t.surface[0], borderColor: t.surface[200] }]}>
              <TouchableOpacity
                style={{ flex: 1 }}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: '/(admin)/route-template-form', params: { id: tpl.id } } as any)}
              >
                <View style={s.cardTop}>
                  <Text style={[s.name, { color: t.ink[900] }]} numberOfLines={1}>{tpl.name}</Text>
                  {rec && <View style={[s.pill, { backgroundColor: t.brand.brand50 }]}><Text style={[s.pillText, { color: t.brand.brand700 }]}>↻ {rec}</Text></View>}
                </View>
                <Text style={[s.sub, { color: t.ink[500] }]}>{tpl._count?.stops ?? 0} stop{(tpl._count?.stops ?? 0) === 1 ? '' : 's'} · tap to edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(tpl)} hitSlop={8} style={s.del}>
                <Ionicons name="trash-outline" size={18} color="#b91c1c" />
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={!loading && !failed
          ? <Muted style={s.empty}>No templates yet. Tap “+ New” to create a reusable route.</Muted>
          : null}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  back: { flexDirection: 'row', alignItems: 'center', minWidth: 70 },
  backText: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800' },
  newBtn: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, minWidth: 70, alignItems: 'center' },
  newBtnText: { fontSize: 13, fontWeight: '700' },
  list: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  pill: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 4 },
  del: { padding: 4 },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 32 },
});
