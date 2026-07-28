import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { SortControl } from '@/components/SortControl';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';

type SortKey = 'priority' | 'date' | 'name' | 'service' | 'status';
const SORT_OPTIONS = [
  { key: 'priority' as const, label: 'Priority' },
  { key: 'date' as const, label: 'Newest' },
  { key: 'name' as const, label: 'Name' },
  { key: 'service' as const, label: 'Service' },
  { key: 'status' as const, label: 'Status' },
];

interface Job {
  id: string; status: QuoteStatus; createdAt: string;
  scheduledAt: string | null; preferredAt: string | null;
  guestName: string | null;
  addressLine: string; city: string; state: string;
  service: { name: string };
  user: { email: string; customerProfiles?: { fullName: string }[] } | null;
}

const PRIORITY: Partial<Record<string, number>> = {
  IN_PROGRESS: 0, SCHEDULED: 1,
  ESTIMATE_SENT: 2, REVIEWING: 3, NEW: 4,
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfWeek(d: Date) {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay());
  s.setHours(0, 0, 0, 0);
  return s;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function jobDate(j: Job): Date | null { const d = j.scheduledAt ?? j.preferredAt; return d ? new Date(d) : null; }
function customerName(j: Job) { return j.guestName ?? j.user?.customerProfiles?.[0]?.fullName ?? j.user?.email ?? 'Customer'; }
function fmtDate(iso: string) { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }

const STATUS_FILTER = ['ALL', 'NEW', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'];

export default function JobsScreen() {
  const router = useRouter();
  const t = useTheme();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [view, setView] = useState<'list' | 'week'>('list');
  const [weekOf, setWeekOf] = useState(() => startOfWeek(new Date()));
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<SortKey>('priority');

  async function load(status = filter, q = query) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== 'ALL') params.set('status', status);
      if (q) params.set('q', q);
      const rows = await apiCall<Job[]>('GET', `/api/admin/quotes${params.toString() ? `?${params}` : ''}`);
      setJobs(rows);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  const filtered = jobs
    .filter(j => filter === 'ALL' || j.status === filter)
    .filter(j => {
      if (!query) return true;
      const q = query.toLowerCase();
      return customerName(j).toLowerCase().includes(q) || j.service.name.toLowerCase().includes(q) || j.city.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      switch (sort) {
        case 'date':    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'name':    return customerName(a).localeCompare(customerName(b));
        case 'service': return a.service.name.localeCompare(b.service.name);
        case 'status':  return a.status.localeCompare(b.status);
        default:        return (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9);
      }
    });

  const active = jobs.filter(j => ['IN_PROGRESS', 'SCHEDULED'].includes(j.status)).length;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <View style={s.headerTop}>
          <View>
            <Text style={[s.heading, { color: t.ink[900] }]}>Jobs</Text>
            <Text style={[s.sub, { color: t.ink[300] }]}>{active > 0 ? `${active} active` : 'All jobs'}</Text>
          </View>
          {/* List / Week toggle */}
          <View style={[s.toggle, { backgroundColor: t.surface[100] }]}>
            {(['list', 'week'] as const).map(v => {
              const on = view === v;
              return (
                <TouchableOpacity key={v} style={[s.toggleBtn, on && { backgroundColor: t.surface[0] }, on && t.shadowSoft]} onPress={() => setView(v)}>
                  <Ionicons name={v === 'list' ? 'list-outline' : 'calendar-outline'} size={16} color={on ? t.brand.brand600 : t.ink[500]} />
                  <Text style={[s.toggleText, { color: on ? t.brand.brand600 : t.ink[500], fontWeight: on ? '700' : '500' }]}>{v === 'list' ? 'List' : 'Week'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Status pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>
          {STATUS_FILTER.map(st => {
            const on = filter === st;
            return (
              <TouchableOpacity key={st} style={[s.pill, { backgroundColor: on ? t.brand.brand500 : t.surface[100] }]} onPress={() => { setFilter(st); load(st, query); }}>
                <Text style={[s.pillText, { color: on ? t.brand.onBrand : t.ink[500] }]}>{st === 'ALL' ? 'All' : st.replace('_', ' ')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Search */}
        <View style={[s.searchRow, { backgroundColor: t.surface[100] }]}>
          <Ionicons name="search-outline" size={15} color={t.ink[300]} />
          <TextInput
            style={[s.searchInput, { color: t.ink[900] }]} value={query} onChangeText={setQuery}
            onSubmitEditing={() => load(filter, query)}
            placeholder="Search…" placeholderTextColor={t.ink[300]} returnKeyType="search"
          />
        </View>

        {view === 'list' && (
          <View style={s.sortRow}>
            <SortControl value={sort} options={SORT_OPTIONS} onChange={setSort} />
          </View>
        )}
      </View>

      {failed && !loading && <LoadFailedBanner onRetry={() => load()} />}
      {loading && !refresh
        ? <ActivityIndicator style={{ marginTop: 40 }} color={t.brand.brand500} />
        : view === 'list'
          ? <ListView t={t} jobs={filtered} hideEmpty={failed} refresh={refresh} onRefresh={() => { setRefresh(true); load(); }} router={router} />
          : <WeekView t={t} jobs={jobs} weekOf={weekOf} onPrev={() => setWeekOf(w => addDays(w, -7))} onNext={() => setWeekOf(w => addDays(w, 7))} router={router} />
      }
    </SafeAreaView>
  );
}

// ── List view ─────────────────────────────────────────────────────────────

function ListView({ t, jobs, hideEmpty, refresh, onRefresh, router }: { t: Theme; jobs: Job[]; hideEmpty?: boolean; refresh: boolean; onRefresh: () => void; router: any }) {
  return (
    <FlatList
      data={jobs}
      keyExtractor={j => j.id}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={t.brand.brand500} />}
      ListEmptyComponent={hideEmpty ? null : <Text style={[s.empty, { color: t.ink[300] }]}>No jobs found.</Text>}
      renderItem={({ item: j }) => {
        const name = customerName(j);
        const urgent = j.status === 'IN_PROGRESS';
        const dateStr = j.scheduledAt ?? j.preferredAt;
        return (
          <TouchableOpacity
            style={[s.card, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft, urgent && { borderLeftWidth: 3, borderLeftColor: t.brand.brand500 }]}
            onPress={() => router.push(`/(staff)/job/${j.id}` as any)}
          >
            <View style={s.cardRow}>
              <View style={[s.avatar, { backgroundColor: t.brand.brand50 }]}><Text style={[s.avatarText, { color: t.brand.brand600 }]}>{name.charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={[s.cardName, { color: t.ink[900] }]}>{name}</Text>
                  <StatusBadge status={j.status} />
                </View>
                <Text style={[s.cardSub, { color: t.ink[300] }]}>{j.service.name} · {j.city}</Text>
              </View>
              <Text style={[s.cardDate, { color: t.ink[500] }]}>{dateStr ? fmtDate(dateStr) : ''}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

// ── Week calendar view ────────────────────────────────────────────────────

function WeekView({ t, jobs, weekOf, onPrev, onNext, router }: { t: Theme; jobs: Job[]; weekOf: Date; onPrev: () => void; onNext: () => void; router: any }) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i));

  const byDay = new Map<string, Job[]>();
  for (const j of jobs) {
    const d = jobDate(j);
    if (!d) continue;
    if (!['SCHEDULED', 'IN_PROGRESS', 'NEW', 'REVIEWING'].includes(j.status)) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(j);
  }

  const weekEnd = addDays(weekOf, 6);
  const weekLabel = `${MONTHS[weekOf.getMonth()]} ${weekOf.getDate()} – ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getDate()}`;

  const unscheduled = jobs.filter(j =>
    ['SCHEDULED', 'NEW'].includes(j.status) && !j.scheduledAt && !j.preferredAt
  );

  // Job chip colors keyed by status (IN_PROGRESS uses the brand tint).
  const chip = (status: string) =>
    status === 'IN_PROGRESS' ? { bg: t.brand.brand50, fg: t.brand.brand700 }
    : status === 'SCHEDULED' ? { bg: '#d1fae5', fg: '#065f46' }
    : { bg: '#fef9c3', fg: '#854d0e' };

  return (
    <ScrollView contentContainerStyle={s.weekContent}>
      {/* Nav */}
      <View style={s.weekNav}>
        <TouchableOpacity style={[s.navBtn, { backgroundColor: t.brand.brand50 }]} onPress={onPrev}><Ionicons name="chevron-back" size={18} color={t.brand.brand600} /></TouchableOpacity>
        <Text style={[s.weekLabel, { color: t.ink[900] }]}>{weekLabel}</Text>
        <TouchableOpacity style={[s.navBtn, { backgroundColor: t.brand.brand50 }]} onPress={onNext}><Ionicons name="chevron-forward" size={18} color={t.brand.brand600} /></TouchableOpacity>
      </View>

      {/* 7-day grid */}
      {days.map(day => {
        const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
        const djobs = byDay.get(key) ?? [];
        const isToday = isSameDay(day, today);

        return (
          <View key={key} style={s.dayRow}>
            <View style={[s.dayLabel, { backgroundColor: isToday ? t.brand.brand500 : t.surface[50] }]}>
              <Text style={[s.dayName, { color: isToday ? 'rgba(255,255,255,0.7)' : t.ink[300] }]}>{DAYS[day.getDay()]}</Text>
              <Text style={[s.dayNum, { color: isToday ? '#fff' : t.ink[900] }]}>{day.getDate()}</Text>
            </View>
            <View style={s.dayJobs}>
              {djobs.length === 0
                ? <Text style={[s.noJobs, { color: t.surface[200] }]}>No jobs</Text>
                : djobs.map(j => {
                    const c = chip(j.status);
                    return (
                      <TouchableOpacity key={j.id} style={[s.dayJob, { backgroundColor: c.bg }]} onPress={() => router.push(`/(staff)/job/${j.id}` as any)}>
                        <Text style={[s.dayJobText, { color: c.fg }]} numberOfLines={1}>{customerName(j)} · {j.service.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
            </View>
          </View>
        );
      })}

      {/* Legend */}
      <View style={s.legend}>
        <LegendDot t={t} color={t.brand.brand50} label="In progress" />
        <LegendDot t={t} color="#d1fae5" label="Scheduled" />
        <LegendDot t={t} color="#fef9c3" label="Accepted / New" />
      </View>

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <View style={s.unscheduledSection}>
          <Text style={[s.unscheduledTitle, { color: t.ink[700] }]}>Unscheduled ({unscheduled.length})</Text>
          {unscheduled.map(j => (
            <TouchableOpacity key={j.id} style={[s.unscheduledCard, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft]} onPress={() => router.push(`/(staff)/job/${j.id}` as any)}>
              <StatusBadge status={j.status} />
              <Text style={[s.unscheduledName, { color: t.ink[700] }]} numberOfLines={1}>{customerName(j)} · {j.service.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function LegendDot({ t, color, label }: { t: Theme; color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: t.ink[300] }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 },
  heading: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  toggle: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 2 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  toggleText: { fontSize: 12 },
  pills: { paddingHorizontal: 12, gap: 6, paddingBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  pillText: { fontSize: 11, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  sortRow: { paddingHorizontal: 12, paddingBottom: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  list: { padding: 14, gap: 8 },
  card: { padding: 14 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700' },
  cardName: { fontSize: 14, fontWeight: '600' },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardDate: { fontSize: 12, fontWeight: '500' },
  empty: { textAlign: 'center', marginTop: 40 },
  weekContent: { padding: 14, paddingBottom: 40 },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn: { padding: 8, borderRadius: 10 },
  weekLabel: { fontSize: 14, fontWeight: '700' },
  dayRow: { flexDirection: 'row', gap: 10, marginBottom: 6, minHeight: 52 },
  dayLabel: { width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 6 },
  dayName: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  dayNum: { fontSize: 16, fontWeight: '800', marginTop: 1 },
  dayJobs: { flex: 1, gap: 4, justifyContent: 'center' },
  noJobs: { fontSize: 12, alignSelf: 'flex-start', paddingVertical: 4 },
  dayJob: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  dayJobText: { fontSize: 12, fontWeight: '600' },
  legend: { flexDirection: 'row', gap: 14, marginTop: 12, marginBottom: 4, flexWrap: 'wrap' },
  unscheduledSection: { marginTop: 20 },
  unscheduledTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  unscheduledCard: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  unscheduledName: { flex: 1, fontSize: 13 },
});
