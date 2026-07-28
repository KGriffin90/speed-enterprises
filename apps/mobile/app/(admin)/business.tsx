import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, ApiError } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Card } from '@/components/ui';

interface InsightData { summary: string; bullets: string[] }

/**
 * Business tab — dedicated AI insights view.
 * (Team management moved to Workforce; settings moved to Account.)
 *
 * The API analyzes the tenant's LAST 30 DAYS of quotes (volume, status
 * conversion, revenue + average estimate, top services, busiest days,
 * new-vs-returning customers) and completed timesheets (labor hours), then has
 * the AI write a summary — that's why generation takes a few seconds, and the
 * loading state below tells the owner exactly that.
 */
export default function BusinessInsightsScreen() {
  const t = useTheme();
  const [insights, setInsights] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(false);

  async function loadInsights() {
    setLoading(true);
    setFailed(null);
    try {
      setInsights(await apiCall<InsightData>('GET', '/api/ai/insights'));
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : 'Could not load insights. Check your connection.');
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }

  useFocusEffect(useCallback(() => { loadInsights(); }, []));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface[50] }} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <Text style={[s.heading, { color: t.ink[900] }]}>Business</Text>
        <Text style={[s.sub, { color: t.ink[300] }]}>AI insights · last 30 days</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); loadInsights(); }} tintColor={t.brand.brand500} />}
      >
        {/* ── Loading: tell the owner where they are, what's coming, and why
               it takes a moment — not just a bare spinner. ─────────────────── */}
        {loading && !refresh && (
          <Card padding={20} style={{ alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color={t.brand.brand500} size="large" />
            <Text style={[s.loadingTitle, { color: t.ink[900] }]}>Generating your business insights…</Text>
            <Text style={[s.loadingBody, { color: t.ink[500] }]}>
              We're reviewing your last 30 days of activity — quote volume and
              conversion, revenue and average estimate, your most-requested
              services, busiest days of the week, and your team's labor hours.
            </Text>
            <Text style={[s.loadingBody, { color: t.ink[300] }]}>
              The AI takes a few seconds to read the data and write its summary.
            </Text>
          </Card>
        )}

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {!loading && failed && (
          <Card padding={20} style={{ alignItems: 'center', gap: 10 }}>
            <Ionicons name="cloud-offline-outline" size={28} color={t.ink[300]} />
            <Text style={[s.loadingTitle, { color: t.ink[900] }]}>Couldn't load insights</Text>
            <Text style={[s.loadingBody, { color: t.ink[500] }]}>{failed}</Text>
            <TouchableOpacity style={[s.retryBtn, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={loadInsights}>
              <Text style={[s.retryText, { color: t.brand.onBrand }]}>Retry</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* ── Insights ──────────────────────────────────────────────────── */}
        {!loading && !failed && insights && (
          <View style={{ gap: 12 }}>
            <Card padding={14}>
              <Text style={[s.sectionLabel, { color: t.ink[300] }]}>Summary</Text>
              <Text style={[s.insightSummary, { color: t.ink[900] }]}>{insights.summary}</Text>
            </Card>
            {insights.bullets.length > 0 && (
              <Card padding={14} style={{ gap: 8 }}>
                <Text style={[s.sectionLabel, { color: t.ink[300] }]}>Key insights</Text>
                {insights.bullets.map((b, i) => (
                  <View key={i} style={s.bulletRow}>
                    <View style={[s.bulletNum, { backgroundColor: t.brand.brand50 }]}>
                      <Text style={[s.bulletNumText, { color: t.brand.brand600 }]}>{i + 1}</Text>
                    </View>
                    <Text style={[s.bulletText, { color: t.ink[700] }]}>{b}</Text>
                  </View>
                ))}
              </Card>
            )}
            <Text style={[s.footNote, { color: t.ink[300] }]}>
              Based on your quotes and timesheets from the last 30 days · Pull to refresh
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 16, borderBottomWidth: 1 },
  heading: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 40 },
  loadingTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  loadingBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, marginTop: 4 },
  retryText: { fontSize: 14, fontWeight: '700' },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  insightSummary: { fontSize: 15, lineHeight: 22, marginTop: 6 },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletNum: { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  bulletNumText: { fontSize: 11, fontWeight: '700' },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footNote: { textAlign: 'center', fontSize: 12 },
});
