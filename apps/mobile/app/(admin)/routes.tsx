import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';
import { Heading, Muted } from '@/components/ui';

type Phase = 'all' | 'planned' | 'running' | 'active' | 'completed';

interface Route {
  id: string;
  name: string | null;
  phase: 'planned' | 'running' | 'active' | 'completed';
  plannedForDate: string | null;
  startedAt: string;
  sourceTemplateId: string | null;
  distanceMiles: number | null;
  gallonsUsed: number | null;
  membership: { fullName: string | null; user: { email: string } } | null;
  _count: { stops: number; waypoints: number };
}

const TABS: { value: Phase; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'running', label: 'En route' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
];
// En route = scheduled for today; Active = a staff member started it (GPS live).
const PHASE_LABEL: Record<string, string> = { planned: 'Planned', running: 'En route', active: 'Active', completed: 'Completed' };

/**
 * Admin routes dashboard — the mobile mirror of web /admin/routes. Routes are
 * bucketed by phase (Planned / En route today / Completed); recurring routes
 * collapse server-side to one perpetual row. Reusable blueprints live under
 * Templates.
 */
export default function AdminRoutesScreen() {
  const t = useTheme();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('all');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (p: Phase) => {
    setLoading(true);
    try { setRoutes(await apiCall<Route[]>('GET', `/api/admin/routes?phase=${p}`)); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(phase); }, [phase, load]));

  const pillColors = (ph: string) =>
    ph === 'active' ? { bg: '#dcfce7', fg: '#166534' }       // live (GPS tracking)
    : ph === 'running' ? { bg: '#fef3c7', fg: '#b45309' }    // En route — day of
    : ph === 'completed' ? { bg: '#dbeafe', fg: '#1e40af' }
    : { bg: t.surface[100], fg: t.ink[500] };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <Heading>Routes</Heading>
        <TouchableOpacity
          style={[s.tplBtn, { backgroundColor: t.brand.brand50 }]}
          onPress={() => router.push('/(admin)/route-templates' as any)}
        >
          <Ionicons name="albums-outline" size={15} color={t.brand.brand600} />
          <Text style={[s.tplBtnText, { color: t.brand.brand600 }]}>Templates</Text>
        </TouchableOpacity>
      </View>

      {/* Phase filter */}
      <View style={s.tabs}>
        {TABS.map(tab => {
          const active = phase === tab.value;
          return (
            <TouchableOpacity
              key={tab.value}
              onPress={() => setPhase(tab.value)}
              style={[s.tab, { backgroundColor: active ? t.brand.brand600 : t.surface[100] }]}
            >
              <Text style={[s.tabText, { color: active ? t.brand.onBrand : t.ink[700] }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading && !refresh && <ActivityIndicator style={{ marginTop: 28 }} color={t.brand.brand500} />}
      {failed && !loading && <LoadFailedBanner onRetry={() => load(phase)} />}

      <FlatList
        data={routes}
        keyExtractor={r => r.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(phase); }} tintColor={t.brand.brand500} />}
        renderItem={({ item: r }) => {
          const c = pillColors(r.phase);
          const when = r.plannedForDate ?? r.startedAt;
          return (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push(`/(admin)/route/${r.id}` as any)}
              style={[s.card, { backgroundColor: t.surface[0], borderColor: t.surface[200] }]}
            >
              <View style={s.cardTop}>
                <Text style={[s.name, { color: t.ink[900] }]} numberOfLines={1}>{r.name ?? 'Route'}</Text>
                <View style={[s.pill, { backgroundColor: c.bg }]}>
                  <Text style={[s.pillText, { color: c.fg }]}>{PHASE_LABEL[r.phase] ?? r.phase}</Text>
                </View>
              </View>
              <Text style={[s.sub, { color: t.ink[500] }]} numberOfLines={1}>
                {(r.membership?.fullName ?? r.membership?.user.email ?? '—')} · {new Date(when).toLocaleDateString(undefined, r.plannedForDate ? { timeZone: 'UTC' } : undefined)}
              </Text>
              <View style={s.stats}>
                <Text style={[s.stat, { color: t.ink[500] }]}>{r._count.stops} stop{r._count.stops === 1 ? '' : 's'}</Text>
                {!!r.sourceTemplateId && <Text style={[s.stat, { color: t.ink[300] }]}>· recurring</Text>}
                {r.distanceMiles != null && <Text style={[s.stat, { color: t.ink[500] }]}>· {r.distanceMiles.toFixed(1)} mi</Text>}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={!loading && !failed
          ? <Muted style={s.empty}>No {phase === 'all' ? '' : `${phase} `}routes.</Muted>
          : null}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { padding: 20, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tplBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 7 },
  tplBtnText: { fontSize: 12, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 99 },
  tabText: { fontSize: 12, fontWeight: '700' },
  list: { padding: 16, paddingTop: 4, gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', flex: 1 },
  pill: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 4 },
  stats: { flexDirection: 'row', gap: 6, marginTop: 8 },
  stat: { fontSize: 12 },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 32 },
});
