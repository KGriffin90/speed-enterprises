import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, ApiError } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Card } from '@/components/ui';

/**
 * Admin route detail — native mirror of web's /admin/routes/[id]
 * (RouteTimeline + RouteActions). Summary tiles, last known GPS fix, the
 * stop-by-stop timeline, and delete. Live routes poll on the same 10s cadence
 * web uses so the owner watches stops complete in near real time.
 */

interface RouteStop {
  id: string;
  sequence: number;
  label: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  status: 'PENDING' | 'ARRIVED' | 'DONE' | 'SKIPPED';
  arrivedAt: string | null;
  departedAt: string | null;
  onSiteMinutes: number | null;
  driveMinutesFromPrev: number | null;
}

interface RouteDetail {
  id: string;
  name: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  startedAt: string;
  endedAt: string | null;
  plannedForDate: string | null;
  distanceMiles: number | null;
  gallonsUsed: number | null;
  membership: { fullName: string | null; user: { email: string | null } } | null;
  crew?: Array<{ membershipId: string; fullName: string | null; email: string | null }>;
  stops: RouteStop[];
  waypoints?: Array<{ lat: number; lng: number; recordedAt: string; speed: number | null }>;
  _count?: { waypoints: number };
}

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  PLANNED:     { bg: '#f5f5f4', fg: '#57534e', label: 'Planned' },
  IN_PROGRESS: { bg: '#ecfdf5', fg: '#059669', label: 'Active' },
  COMPLETED:   { bg: '#eff6ff', fg: '#2563eb', label: 'Completed' },
  CANCELED:    { bg: '#fef2f2', fg: '#991b1b', label: 'Canceled' },
};

/** Web refreshes a live route every 10s. */
const POLL_MS = 10_000;

function fmtDur(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function AdminRouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRoute(await apiCall<RouteDetail>('GET', `/api/admin/routes/${id}`));
    } catch {
      setRoute(null);
    } finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Poll while the route is live/planned; stop once it's finished.
  useEffect(() => {
    if (!route || (route.status !== 'IN_PROGRESS' && route.status !== 'PLANNED')) return;
    const timer = setInterval(() => { load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [route?.status, load]);

  function remove() {
    if (!route) return;
    Alert.alert(
      'Delete route',
      `Delete ${route.name ? `“${route.name}”` : 'this route'}? This permanently removes the route, its stops and any GPS history. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setBusy(true);
            try {
              await apiCall('DELETE', `/api/admin/routes/${id}`);
              router.back();
            } catch (e) {
              Alert.alert('Error', e instanceof ApiError ? e.message : 'Could not delete this route. Please try again.');
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (loading) return <View style={[s.center, { backgroundColor: t.surface[50] }]}><ActivityIndicator color={t.brand.brand500} /></View>;
  if (!route) {
    return (
      <View style={[s.center, { backgroundColor: t.surface[50] }]}>
        <Text style={{ color: t.ink[700] }}>Route not found</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <Text style={{ color: t.brand.brand600, fontWeight: '600', marginTop: 12 }}>← Back to routes</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const st = STATUS[route.status] ?? { bg: t.surface[100], fg: t.ink[500], label: route.status };
  const totalOnSite = route.stops.reduce((acc, x) => acc + (x.onSiteMinutes ?? 0), 0);
  const totalDrive = route.stops.reduce((acc, x) => acc + (x.driveMinutesFromPrev ?? 0), 0);
  const currentStop = route.stops.find(x => x.status === 'ARRIVED');
  const assignee = route.crew && route.crew.length > 0
    ? route.crew.map(c => c.fullName ?? c.email ?? '—').join(', ')
    : route.membership?.fullName ?? route.membership?.user.email ?? 'Unassigned';
  const fix = route.waypoints?.[0];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.topRow}>
          <TouchableOpacity style={s.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={t.brand.brand600} />
            <Text style={[s.backText, { color: t.brand.brand600 }]}>Routes</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={remove} disabled={busy} hitSlop={8}>
            <Text style={[s.delete, { opacity: busy ? 0.4 : 1 }]}>{busy ? 'Deleting…' : 'Delete'}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.titleRow}>
          <Text style={[s.heading, { color: t.ink[900] }]}>{route.name ?? 'Route'}</Text>
          <View style={[s.pill, { backgroundColor: st.bg }]}>
            <Text style={[s.pillText, { color: st.fg }]}>{st.label}</Text>
          </View>
        </View>
        {route.status === 'IN_PROGRESS' && (
          <Text style={s.live}>● live · auto-refreshing</Text>
        )}
        <Text style={[s.sub, { color: t.ink[500] }]}>
          {assignee}
          {route.plannedForDate ? ` · ${new Date(route.plannedForDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}` : ''}
          {currentStop ? ` · on site at: ${currentStop.label}` : ''}
        </Text>

        {/* Summary tiles */}
        <View style={s.tiles}>
          <Tile t={t} label="Time on jobs" value={fmtDur(totalOnSite || null)} />
          <Tile t={t} label="Drive time" value={fmtDur(totalDrive || null)} />
          <Tile t={t} label="Miles" value={route.distanceMiles != null ? route.distanceMiles.toFixed(1) : '—'} />
          <Tile t={t} label="Gallons" value={route.gallonsUsed != null ? route.gallonsUsed.toFixed(2) : '—'} />
        </View>

        {/* Last known GPS fix */}
        {fix ? (
          <Card padding={14} style={{ marginBottom: 16, gap: 8 }}>
            <Text style={[s.tileLabel, { color: t.ink[500] }]}>Last known location</Text>
            <Text style={[s.coords, { color: t.ink[900] }]}>{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</Text>
            <Text style={[s.fixMeta, { color: t.ink[500] }]}>
              {new Date(fix.recordedAt).toLocaleString()} · {route._count?.waypoints ?? 0} GPS points
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(`https://www.google.com/maps?q=${fix.lat},${fix.lng}`)}
              style={[s.mapBtn, { borderColor: t.surface[200], borderRadius: t.radius }]}
            >
              <Text style={[s.mapBtnText, { color: t.ink[900] }]}>View on map ↗</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card padding={14} style={{ marginBottom: 16 }}>
            <Text style={[s.fixMeta, { color: t.ink[500] }]}>
              No GPS location yet — it appears once the assigned staff start tracking.
            </Text>
          </Card>
        )}

        {/* Stop-by-stop timeline */}
        {route.stops.length === 0 ? (
          <Card padding={28}>
            <Text style={[s.fixMeta, { color: t.ink[500], textAlign: 'center' }]}>No stops on this route.</Text>
          </Card>
        ) : (
          route.stops.map((stop, i) => (
            <View key={stop.id}>
              {i > 0 && (
                <View style={s.driveRow}>
                  <Text style={[s.driveText, { color: t.ink[500] }]}>↓  Drive {fmtDur(stop.driveMinutesFromPrev)}</Text>
                </View>
              )}
              <Card
                padding={14}
                style={[
                  { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
                  stop.status === 'ARRIVED' && { borderColor: '#059669', borderWidth: 2 },
                ]}
              >
                <View style={[s.seq, {
                  backgroundColor: stop.status === 'DONE' ? '#eff6ff' : stop.status === 'ARRIVED' ? '#ecfdf5' : t.surface[100],
                }]}>
                  <Text style={{
                    fontSize: 13, fontWeight: '800',
                    color: stop.status === 'DONE' ? '#2563eb' : stop.status === 'ARRIVED' ? '#059669' : t.ink[500],
                  }}>
                    {stop.status === 'DONE' ? '✓' : i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.stopLabel, { color: t.ink[900] }]}>{stop.label}</Text>
                  {(stop.addressLine || stop.city) && (
                    <Text style={[s.stopAddr, { color: t.ink[500] }]}>
                      {[stop.addressLine, stop.city, stop.state, stop.postalCode].filter(Boolean).join(', ')}
                    </Text>
                  )}
                  <View style={s.stopMeta}>
                    <Text style={[s.metaItem, { color: t.ink[700] }]}>Arrived: <Text style={s.metaBold}>{fmtTime(stop.arrivedAt)}</Text></Text>
                    <Text style={[s.metaItem, { color: t.ink[700] }]}>Departed: <Text style={s.metaBold}>{fmtTime(stop.departedAt)}</Text></Text>
                    <Text style={[s.metaItem, { color: t.ink[700] }]}>
                      On site: <Text style={[s.metaBold, { color: t.brand.brand600 }]}>{fmtDur(stop.onSiteMinutes)}</Text>
                    </Text>
                  </View>
                </View>
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={[s.tile, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }, t.shadowSoft]}>
      <Text style={[s.tileLabel, { color: t.ink[500] }]}>{label}</Text>
      <Text style={[s.tileValue, { color: t.ink[900] }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 14, fontWeight: '500' },
  delete: { fontSize: 14, fontWeight: '600', color: '#b91c1c' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  heading: { fontSize: 22, fontWeight: '800' },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700' },
  live: { fontSize: 12, color: '#059669', marginTop: 4 },
  sub: { fontSize: 13, marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 20 },
  tile: { flexGrow: 1, flexBasis: '45%', borderWidth: 1, padding: 14 },
  tileLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  tileValue: { fontSize: 19, fontWeight: '700', marginTop: 4 },
  coords: { fontSize: 14, fontWeight: '700' },
  fixMeta: { fontSize: 12, lineHeight: 18 },
  mapBtn: { borderWidth: 1, paddingVertical: 10, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 16 },
  mapBtnText: { fontSize: 13, fontWeight: '600' },
  driveRow: { paddingLeft: 16, paddingVertical: 6 },
  driveText: { fontSize: 12 },
  seq: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopLabel: { fontSize: 15, fontWeight: '700' },
  stopAddr: { fontSize: 12, marginTop: 2 },
  stopMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  metaItem: { fontSize: 12 },
  metaBold: { fontWeight: '700' },
});
