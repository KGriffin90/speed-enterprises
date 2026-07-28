import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiCall } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';
import { Card, Heading, Muted } from '@/components/ui';

interface Route {
  id: string; startedAt: string; endedAt: string | null;
  distanceMiles: number | null; gallonsUsed: number | null;
  _count: { waypoints: number };
}

interface Assigned {
  id: string; name: string | null; status: 'PLANNED' | 'IN_PROGRESS';
  plannedForDate: string | null;
  stops: { id: string }[];
}

export default function RoutesScreen() {
  const t = useTheme();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [mine, asg] = await Promise.all([
        apiCall<Route[]>('GET', '/api/me/routes'),
        apiCall<Assigned[]>('GET', '/api/me/routes/assigned').catch(() => []),
      ]);
      setRoutes(mine); setAssigned(asg); setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  async function startRoute(id: string) {
    setActing(id);
    try { await apiCall('POST', `/api/me/routes/${id}/start`); await load(); }
    catch { Alert.alert('Error', 'Could not start the route.'); }
    finally { setActing(null); }
  }
  function completeRoute(id: string) {
    Alert.alert('Complete route?', 'Mark this route as completed for today?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete', onPress: async () => {
          setActing(id);
          try { await apiCall('POST', `/api/me/routes/${id}/end`); await load(); }
          catch { Alert.alert('Error', 'Could not complete the route.'); }
          finally { setActing(null); }
        },
      },
    ]);
  }

  const totalMiles = routes.filter(r => r.endedAt).reduce((s, r) => s + (r.distanceMiles ?? 0), 0);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <Heading>My routes</Heading>
        {totalMiles > 0 && <Muted>{totalMiles.toFixed(1)} mi total</Muted>}
      </View>

      {loading && !refresh && <ActivityIndicator style={{ marginTop: 32 }} color={t.brand.brand500} />}
      {failed && !loading && <LoadFailedBanner onRetry={load} />}

      <FlatList
        data={routes}
        keyExtractor={r => r.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={t.brand.brand500} />}
        ListHeaderComponent={
          assigned.length > 0 ? (
            <View style={{ marginBottom: 18 }}>
              <Text style={[s.sectionLabel, { color: t.ink[500] }]}>ASSIGNED ROUTES</Text>
              {assigned.map(a => {
                // Active = you've started it (GPS live); En route = it's today;
                // Planned = a future day. plannedForDate is a UTC date-only value.
                const started = a.status === 'IN_PROGRESS';
                const upcoming = a.plannedForDate ? a.plannedForDate.slice(0, 10) > new Date().toISOString().slice(0, 10) : false;
                const badge = started
                  ? { label: 'Active', bg: '#dcfce7', fg: '#166534' }
                  : upcoming
                    ? { label: 'Planned', bg: t.surface[100], fg: t.ink[500] }
                    : { label: 'En route', bg: '#fef3c7', fg: '#b45309' };
                return (
                  <Card key={a.id} padding={14} style={{ marginBottom: 10 }}>
                    <View style={s.row}>
                      <Text style={[s.date, { color: t.ink[900] }]} numberOfLines={1}>{a.name ?? 'Route'}</Text>
                      <View style={[s.statusPill, { backgroundColor: badge.bg }]}>
                        <Text style={[s.statusText, { color: badge.fg }]}>{badge.label}</Text>
                      </View>
                    </View>
                    <Text style={[s.times, { color: t.ink[500] }]}>
                      {a.plannedForDate ? new Date(a.plannedForDate).toLocaleDateString(undefined, { timeZone: 'UTC' }) : 'Today'} · {a.stops.length} stop{a.stops.length === 1 ? '' : 's'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => started ? completeRoute(a.id) : startRoute(a.id)}
                      disabled={acting === a.id}
                      style={[s.actionBtn, { backgroundColor: started ? t.brand.brand600 : t.brand.brand500, opacity: acting === a.id ? 0.6 : 1 }]}
                    >
                      <Text style={[s.actionText, { color: t.brand.onBrand }]}>
                        {acting === a.id ? '…' : started ? 'Complete route' : 'Start route'}
                      </Text>
                    </TouchableOpacity>
                  </Card>
                );
              })}
              <Text style={[s.sectionLabel, { color: t.ink[500], marginTop: 8 }]}>MILEAGE LOG</Text>
            </View>
          ) : null
        }
        renderItem={({ item: r }) => (
          <Card padding={16}>
            <View style={s.row}>
              <Text style={[s.date, { color: t.ink[900] }]}>{new Date(r.startedAt).toLocaleDateString()}</Text>
              {!r.endedAt && <View style={s.livePill}><Text style={s.liveText}>tracking…</Text></View>}
            </View>
            <Text style={[s.times, { color: t.ink[500] }]}>
              {new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {r.endedAt ? ` → ${new Date(r.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
            <View style={s.stats}>
              <StatBadge t={t} label="Miles" value={r.distanceMiles != null ? r.distanceMiles.toFixed(2) : '—'} />
              <StatBadge t={t} label="Gallons" value={r.gallonsUsed != null ? r.gallonsUsed.toFixed(2) : '—'} />
              <StatBadge t={t} label="Points" value={String(r._count.waypoints)} />
            </View>
          </Card>
        )}
        ListEmptyComponent={!loading && !failed ? <Muted style={s.empty}>No routes yet. Routes start automatically when you clock in.</Muted> : null}
      />
    </SafeAreaView>
  );
}

function StatBadge({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: t.ink[900] }}>{value}</Text>
      <Text style={{ fontSize: 11, color: t.ink[500], marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { padding: 20, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  list: { padding: 16, gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 15, fontWeight: '600', flex: 1 },
  times: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  stats: { flexDirection: 'row', gap: 12 },
  livePill: { backgroundColor: '#dcfce7', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  liveText: { fontSize: 11, fontWeight: '600', color: '#166534' },
  statusPill: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  actionBtn: { borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 2 },
  actionText: { fontSize: 14, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 32, lineHeight: 22 },
});
