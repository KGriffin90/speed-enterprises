import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { apiCall } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { StatusBadge } from '@/components/StatusBadge';

interface JobDetail {
  id: string; status: QuoteStatus; createdAt: string;
  service: { name: string; questions: any[] };
  propertyKind: string;
  addressLine: string; city: string; state: string; postalCode: string;
  guestName: string | null; guestEmail: string | null; guestPhone: string | null;
  user: { email: string; customerProfiles?: { fullName: string }[] } | null;
  answers: Record<string, unknown>;
  customerNotes: string | null; preferredAtNote: string | null;
  statusHistory: Array<{ fromStatus: string; toStatus: string; createdAt: string; note: string | null }>;
}

function customerName(q: JobDetail) {
  return q.guestName ?? q.user?.customerProfiles?.[0]?.fullName ?? q.user?.email ?? 'Customer';
}

export default function StaffJobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    apiCall<JobDetail>('GET', `/api/admin/quotes/${id}`)
      .then(setJob)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]));

  if (loading) return <View style={[s.center, { backgroundColor: t.surface[50] }]}><ActivityIndicator color={t.brand.brand500} /></View>;
  if (!job) {
    return (
      <View style={[s.center, { backgroundColor: t.surface[50] }]}>
        <Text style={{ color: t.ink[700] }}>Job not found</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <Text style={{ color: t.brand.brand600, fontWeight: '600', marginTop: 12 }}>← Back to jobs</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const questions: any[] = job.service.questions ?? [];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={t.brand.brand600} />
          <Text style={[s.backText, { color: t.brand.brand600 }]}>Jobs</Text>
        </TouchableOpacity>

        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.heading, { color: t.ink[900] }]}>{customerName(job)}</Text>
            <Text style={[s.sub, { color: t.ink[300] }]}>{job.service.name} · {job.propertyKind.toLowerCase()} · {new Date(job.createdAt).toLocaleDateString()}</Text>
          </View>
          <StatusBadge status={job.status} />
        </View>

        <Section t={t} title="Customer">
          <InfoRow t={t} label="Email" value={job.guestEmail ?? job.user?.email ?? '—'} />
          <InfoRow t={t} label="Phone" value={job.guestPhone ?? '—'} />
        </Section>

        <Section t={t} title="Service address">
          <InfoRow t={t} label="Street" value={job.addressLine} />
          <InfoRow t={t} label="City" value={`${job.city}, ${job.state} ${job.postalCode}`} />
        </Section>

        {job.preferredAtNote && (
          <Section t={t} title="Preferred timing">
            <Text style={[s.bodyText, { color: t.ink[700] }]}>{job.preferredAtNote}</Text>
          </Section>
        )}

        {questions.length > 0 && Object.keys(job.answers).length > 0 && (
          <Section t={t} title="Job details">
            {questions
              .filter(q => job.answers[q.id] !== undefined && job.answers[q.id] !== '')
              .map((q: any) => (
                <InfoRow key={q.id} t={t} label={q.label} value={
                  Array.isArray(job.answers[q.id]) ? (job.answers[q.id] as string[]).join(', ') : String(job.answers[q.id])
                } />
              ))}
          </Section>
        )}

        {job.customerNotes && (
          <Section t={t} title="Customer notes">
            <Text style={[s.bodyText, { color: t.ink[700] }]}>{job.customerNotes}</Text>
          </Section>
        )}

        <Section t={t} title="Status history">
          {job.statusHistory.length === 0
            ? <Text style={{ fontSize: 13, color: t.ink[300] }}>No history yet.</Text>
            : job.statusHistory.map((h, i) => (
                <View key={i} style={s.histRow}>
                  <View style={[s.histDot, { backgroundColor: t.brand.brand500 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.histStatus, { color: t.ink[900] }]}>{h.fromStatus} → {h.toStatus}</Text>
                    <Text style={[s.histSub, { color: t.ink[300] }]}>{new Date(h.createdAt).toLocaleString()}</Text>
                    {h.note && <Text style={[s.histNote, { color: t.ink[500] }]}>{h.note}</Text>}
                  </View>
                </View>
              ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={[s.sectionTitle, { color: t.ink[300] }]}>{title}</Text>
      <View style={[s.sectionCard, { backgroundColor: t.surface[0], borderRadius: t.radius }, t.shadowSoft]}>{children}</View>
    </View>
  );
}
function InfoRow({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={[s.infoLabel, { color: t.ink[300] }]}>{label}</Text>
      <Text style={[s.infoValue, { color: t.ink[900] }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  backText: { fontSize: 14, fontWeight: '500' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sectionCard: { padding: 14, gap: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 13, fontWeight: '500', flex: 2, textAlign: 'right' },
  bodyText: { fontSize: 14, lineHeight: 20 },
  histRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
  histDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  histStatus: { fontSize: 13, fontWeight: '600' },
  histSub: { fontSize: 11, marginTop: 1 },
  histNote: { fontSize: 12, fontStyle: 'italic', marginTop: 2 },
});
