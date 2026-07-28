import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { SortControl } from '@/components/SortControl';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';

type SortKey = 'date' | 'name' | 'service' | 'status';
const SORT_OPTIONS = [
  { key: 'date' as const, label: 'Newest' },
  { key: 'name' as const, label: 'Name' },
  { key: 'service' as const, label: 'Service' },
  { key: 'status' as const, label: 'Status' },
];

interface Quote {
  id: string; status: QuoteStatus; createdAt: string;
  estimateAmountCents: number | null;
  guestName: string | null; guestEmail: string | null;
  addressLine: string; city: string; state: string;
  service: { name: string };
  user: { email: string; customerProfiles?: { fullName: string }[] } | null;
}

const STATUS_FILTERS = ['ALL', 'NEW', 'REVIEWING', 'ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELED'];

function customerName(r: Quote) {
  return r.guestName ?? r.user?.customerProfiles?.[0]?.fullName ?? r.user?.email ?? '—';
}
function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmt$(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function AdminQuotesScreen() {
  const router = useRouter();
  const t = useTheme();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<SortKey>('date');

  const sorted = useMemo(() => {
    const arr = [...quotes];
    if (sort === 'name') arr.sort((a, b) => customerName(a).localeCompare(customerName(b)));
    else if (sort === 'service') arr.sort((a, b) => a.service.name.localeCompare(b.service.name));
    else if (sort === 'status') arr.sort((a, b) => a.status.localeCompare(b.status));
    else arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return arr;
  }, [quotes, sort]);

  async function load(status = filter, q = query) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== 'ALL') params.set('status', status);
      if (q) params.set('q', q);
      const rows = await apiCall<Quote[]>('GET', `/api/admin/quotes${params.toString() ? `?${params}` : ''}`);
      setQuotes(rows);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  const allLoaded = filter === 'ALL' && !query;
  const newCount = quotes.filter(q => q.status === 'NEW').length;
  const active = quotes.filter(q => ['SCHEDULED', 'IN_PROGRESS'].includes(q.status)).length;
  const pipeline = quotes.filter(q => q.estimateAmountCents).reduce((s, q) => s + (q.estimateAmountCents ?? 0), 0);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <Text style={[s.heading, { color: t.ink[900] }]}>Quotes</Text>
        {allLoaded && (
          <View style={s.kpiRow}>
            <Kpi label="New" value={String(newCount)} color={t.brand.brand700} bg={t.brand.brand50} />
            <Kpi label="Active" value={String(active)} color="#065f46" bg="#d1fae5" />
            <Kpi label="Pipeline" value={fmt$(pipeline)} color="#7e22ce" bg="#faf5ff" />
          </View>
        )}
        <View style={s.searchRow}>
          <View style={[s.searchBox, { backgroundColor: t.surface[100] }]}>
            <Ionicons name="search-outline" size={16} color={t.ink[300]} />
            <TextInput
              style={[s.searchInput, { color: t.ink[900] }]} value={query} onChangeText={setQuery}
              onSubmitEditing={() => load(filter, query)}
              placeholder="Search customer, address…" placeholderTextColor={t.ink[300]}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); load(filter, ''); }} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={t.ink[300]} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <FlatList
          data={STATUS_FILTERS} horizontal showsHorizontalScrollIndicator={false}
          keyExtractor={i => i} contentContainerStyle={s.pills}
          renderItem={({ item }) => {
            const on = filter === item;
            return (
              <TouchableOpacity
                style={[s.pill, { backgroundColor: on ? t.brand.brand500 : t.surface[100] }]}
                onPress={() => { setFilter(item); load(item, query); }}
              >
                <Text style={[s.pillText, { color: on ? t.brand.onBrand : t.ink[500] }]}>
                  {item === 'ALL' ? 'All' : item.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
        <View style={s.sortRow}>
          <SortControl value={sort} options={SORT_OPTIONS} onChange={setSort} />
        </View>
      </View>

      {failed && !loading && <LoadFailedBanner onRetry={() => load()} />}
      {loading && !refresh
        ? <ActivityIndicator style={{ marginTop: 40 }} color={t.brand.brand500} />
        : <FlatList
            data={sorted} keyExtractor={q => q.id}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={t.brand.brand500} />}
            renderItem={({ item: q }) => (
              <TouchableOpacity style={[s.card, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft]} onPress={() => router.push(`/(admin)/quote/${q.id}` as any)}>
                <View style={s.cardRow}>
                  <View style={[s.avatar, { backgroundColor: t.brand.brand50 }]}><Text style={[s.avatarText, { color: t.brand.brand600 }]}>{initials(customerName(q))}</Text></View>
                  <View style={s.cardMain}>
                    <Text style={[s.cardName, { color: t.ink[900] }]}>{customerName(q)}</Text>
                    <Text style={[s.cardSub, { color: t.ink[300] }]}>{q.service.name} · {q.city}</Text>
                  </View>
                  <View style={s.cardRight}>
                    {q.estimateAmountCents != null ? <Text style={[s.cardAmt, { color: t.ink[900] }]}>{fmt$(q.estimateAmountCents)}</Text> : null}
                    <Text style={[s.cardDate, { color: t.ink[300] }]}>{fmtDate(q.createdAt)}</Text>
                  </View>
                </View>
                <View style={{ marginTop: 8, marginLeft: 44 }}>
                  <StatusBadge status={q.status} />
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={!loading && !failed ? <Text style={[s.empty, { color: t.ink[300] }]}>No quotes found.</Text> : null}
          />
      }
    </SafeAreaView>
  );
}

function Kpi({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <View style={[k.box, { backgroundColor: bg }]}>
      <Text style={[k.val, { color }]}>{value}</Text>
      <Text style={[k.lbl, { color }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1 },
  heading: { fontSize: 24, fontWeight: '700', paddingHorizontal: 16, marginBottom: 12 },
  kpiRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  searchRow: { paddingHorizontal: 16, marginBottom: 10 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14 },
  pills: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  sortRow: { paddingHorizontal: 16, paddingBottom: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99 },
  pillText: { fontSize: 12, fontWeight: '600' },
  list: { padding: 16, gap: 10 },
  card: { padding: 14 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700' },
  cardMain: { flex: 1 },
  cardName: { fontSize: 14, fontWeight: '600' },
  cardSub: { fontSize: 12, marginTop: 1 },
  cardRight: { alignItems: 'flex-end' },
  cardAmt: { fontSize: 14, fontWeight: '700' },
  cardDate: { fontSize: 11, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 48 },
});
const k = StyleSheet.create({
  box: { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  val: { fontSize: 18, fontWeight: '700' },
  lbl: { fontSize: 11, fontWeight: '500', marginTop: 2 },
});
