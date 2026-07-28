import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { SortControl } from '@/components/SortControl';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';
import { Card, Heading, Muted } from '@/components/ui';

type SortKey = 'date' | 'service' | 'status';
const SORT_OPTIONS = [
  { key: 'date' as const, label: 'Newest' },
  { key: 'service' as const, label: 'Service' },
  { key: 'status' as const, label: 'Status' },
];

interface Quote {
  id: string; status: QuoteStatus; createdAt: string;
  estimateAmountCents: number | null;
  addressLine: string; city: string; state: string;
  service: { name: string };
}

export default function CustomerQuotesScreen() {
  const router = useRouter();
  const t = useTheme();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<SortKey>('date');

  const sorted = useMemo(() => {
    const arr = [...quotes];
    if (sort === 'service') arr.sort((a, b) => a.service.name.localeCompare(b.service.name));
    else if (sort === 'status') arr.sort((a, b) => a.status.localeCompare(b.status));
    else arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return arr;
  }, [quotes, sort]);

  async function load() {
    setLoading(true);
    try { setQuotes(await apiCall<Quote[]>('GET', '/api/quotes/mine')); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        {/* Back to the Speed Enterprises landing page (browse other businesses).
            navigate (not push): re-focuses an existing welcome instead of
            stacking endless copies when users loop through the marketplace. */}
        <TouchableOpacity style={s.platformBack} onPress={() => router.navigate('/(platform)/storefront' as any)}>
          <Ionicons name="arrow-back" size={16} color={t.brand.brand600} />
          <Text style={[s.platformBackText, { color: t.brand.brand600 }]}>Speed Enterprises</Text>
        </TouchableOpacity>
        <Heading>My quotes</Heading>
        {quotes.length > 1 && (
          <View style={{ marginTop: 12 }}>
            <SortControl value={sort} options={SORT_OPTIONS} onChange={setSort} />
          </View>
        )}
      </View>

      {loading && !refresh && <ActivityIndicator style={{ marginTop: 32 }} color={t.brand.brand500} />}
      {failed && !loading && <LoadFailedBanner onRetry={load} />}

      <FlatList
        data={sorted}
        keyExtractor={q => q.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={t.brand.brand500} />}
        renderItem={({ item: q }) => (
          <TouchableOpacity activeOpacity={0.8} onPress={() => router.push(`/(customer)/quote/${q.id}` as any)}>
            <Card padding={16}>
              <View style={s.row}>
                <Text style={[s.service, { color: t.ink[900] }]}>{q.service.name}</Text>
                <StatusBadge status={q.status} />
              </View>
              <Text style={[s.addr, { color: t.ink[500] }]}>{q.addressLine}, {q.city} {q.state}</Text>
              {q.estimateAmountCents != null && (
                <Text style={[s.estimate, { color: t.ink[900] }]}>Estimate: ${(q.estimateAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
              )}
              <Text style={[s.date, { color: t.ink[300] }]}>{new Date(q.createdAt).toLocaleDateString()}</Text>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={!loading && !failed ? <Muted style={s.empty}>No quotes yet. Tap "New Quote" to get started.</Muted> : null}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { padding: 20, borderBottomWidth: 1 },
  platformBack: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  platformBackText: { fontSize: 13, fontWeight: '600' },
  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  service: { fontSize: 15, fontWeight: '600', flex: 1 },
  addr: { fontSize: 13, marginBottom: 4 },
  estimate: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  date: { fontSize: 11 },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 32, lineHeight: 22 },
});
