import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';

interface ScheduledQuote {
  id: string; status: QuoteStatus; scheduledAt: string | null; preferredAt: string | null;
  guestName: string | null; service: { name: string }; city: string; state: string;
  user: { email: string; customerProfiles?: { fullName: string }[] } | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function customerName(q: ScheduledQuote) {
  return q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? q.user?.email ?? 'Customer';
}

export default function AdminScheduleScreen() {
  const router = useRouter();
  const t = useTheme();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [quotes, setQuotes] = useState<ScheduledQuote[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [sc, ip] = await Promise.all([
        apiCall<ScheduledQuote[]>('GET', '/api/admin/quotes?status=SCHEDULED').catch(() => []),
        apiCall<ScheduledQuote[]>('GET', '/api/admin/quotes?status=IN_PROGRESS').catch(() => []),
      ]);
      setQuotes([...sc, ...ip]);
    } finally { setLoading(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  const byDay: Record<number, ScheduledQuote[]> = {};
  for (const q of quotes) {
    const d = q.scheduledAt ?? q.preferredAt;
    if (!d) continue;
    const dt = new Date(d);
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      const day = dt.getDate();
      (byDay[day] ??= []).push(q);
    }
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: Math.ceil((firstDow + daysInMonth) / 7) * 7 });
  const today = now.getDate();
  const isThisMonth = now.getFullYear() === year && now.getMonth() === month;

  function prev() { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); }
  function next() { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface[50] }} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={[s.heading, { color: t.ink[900] }]}>Schedule</Text>

        {/* Month nav */}
        <View style={s.navRow}>
          <TouchableOpacity onPress={prev} style={s.navBtn}><Ionicons name="chevron-back" size={20} color={t.brand.brand600} /></TouchableOpacity>
          <Text style={[s.monthLabel, { color: t.ink[900] }]}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity onPress={next} style={s.navBtn}><Ionicons name="chevron-forward" size={20} color={t.brand.brand600} /></TouchableOpacity>
        </View>

        {/* Day headers */}
        <View style={s.dayRow}>
          {DAYS.map(d => <Text key={d} style={[s.dayHdr, { color: t.ink[300] }]}>{d}</Text>)}
        </View>

        {/* Calendar grid */}
        {loading
          ? <ActivityIndicator color={t.brand.brand500} style={{ marginVertical: 24 }} />
          : <View style={s.grid}>
              {cells.map((_, i) => {
                const day = i - firstDow + 1;
                const valid = day >= 1 && day <= daysInMonth;
                const isToday = isThisMonth && valid && day === today;
                const jobs = valid ? (byDay[day] ?? []) : [];
                return (
                  <View key={i} style={[s.cell, { borderColor: t.surface[200], backgroundColor: valid ? t.surface[0] : t.surface[50] }]}>
                    {valid && (
                      <>
                        <View style={[s.dayNum, isToday && { backgroundColor: t.brand.brand500 }]}>
                          <Text style={[s.dayNumText, { color: isToday ? '#fff' : t.ink[700], fontWeight: isToday ? '700' : '400' }]}>{day}</Text>
                        </View>
                        {jobs.slice(0, 2).map(q => (
                          <TouchableOpacity key={q.id} style={[s.event, { backgroundColor: t.brand.brand50 }]} onPress={() => router.push(`/(admin)/quote/${q.id}` as any)}>
                            <Text style={[s.eventText, { color: t.brand.brand700 }]} numberOfLines={1}>{customerName(q)}</Text>
                          </TouchableOpacity>
                        ))}
                        {jobs.length > 2 && <Text style={[s.more, { color: t.ink[300] }]}>+{jobs.length - 2}</Text>}
                      </>
                    )}
                  </View>
                );
              })}
            </View>
        }

        {/* Agenda */}
        {Object.entries(byDay).length > 0 && (
          <View style={s.agendaSection}>
            <Text style={[s.agendaTitle, { color: t.ink[900] }]}>This month's jobs</Text>
            {Object.entries(byDay).sort(([a], [b]) => Number(a) - Number(b)).flatMap(([day, jobs]) =>
              jobs.map(q => (
                <TouchableOpacity key={q.id} style={[s.agendaCard, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft]} onPress={() => router.push(`/(admin)/quote/${q.id}` as any)}>
                  <Text style={[s.agendaDate, { color: t.brand.brand600 }]}>{MONTHS[month]!.slice(0, 3)} {day}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.agendaName, { color: t.ink[900] }]}>{customerName(q)}</Text>
                    <Text style={[s.agendaSub, { color: t.ink[300] }]}>{q.service.name} · {q.city}</Text>
                  </View>
                  <StatusBadge status={q.status} />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { padding: 8 },
  monthLabel: { fontSize: 16, fontWeight: '700' },
  dayRow: { flexDirection: 'row', marginBottom: 4 },
  dayHdr: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, minHeight: 64, padding: 2, borderWidth: 0.5 },
  dayNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  dayNumText: { fontSize: 12 },
  event: { borderRadius: 3, marginBottom: 1, paddingHorizontal: 3 },
  eventText: { fontSize: 9, fontWeight: '600' },
  more: { fontSize: 9 },
  agendaSection: { marginTop: 20 },
  agendaTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  agendaCard: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  agendaDate: { fontSize: 12, fontWeight: '600', width: 44 },
  agendaName: { fontSize: 14, fontWeight: '600' },
  agendaSub: { fontSize: 12, marginTop: 1 },
});
