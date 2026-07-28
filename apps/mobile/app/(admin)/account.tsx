import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, Switch, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { PaymentsPanel } from '@/components/admin/PaymentsPanel';
import { Screen, Card, Button, Badge, Heading } from '@/components/ui';

/**
 * Owner/admin account screen. Also hosts the business settings (info,
 * feature flags, AI assistants, message templates) — moved here from the
 * Business tab, which is now dedicated to AI insights.
 */
export default function AdminAccountScreen() {
  const { session, signOut, setBrowsingSlug } = useAuth();
  const router = useRouter();
  const t = useTheme();

  const [config, setConfig] = useState<any>(null);
  const [loadingCfg, setLoadingCfg] = useState(false);

  const loadConfig = useCallback(() => {
    setLoadingCfg(true);
    apiCall<any>('GET', '/api/me/config')
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoadingCfg(false));
  }, []);

  useFocusEffect(useCallback(() => { loadConfig(); }, [loadConfig]));

  async function toggleAiFeature(flag: string, val: boolean) {
    if (!config) return;
    const updated = { ...config.ai, [flag]: val };
    await apiCall('PATCH', '/api/me/config', { ai: updated }).catch(() => {});
    setConfig((c: any) => ({ ...c, ai: updated }));
  }

  function handleSignOut() {
    // Land on the business storefront after sign-out, not the platform login.
    const slug = session?.tenant?.slug ?? null;
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        await signOut();
        if (slug) {
          await SecureStore.setItemAsync('browsing_slug', slug).catch(() => {});
          setBrowsingSlug(slug);
          router.replace({ pathname: '/(platform)/storefront' as any, params: { slug } });
        } else {
          router.replace('/(platform)/storefront' as any);
        }
      }},
    ]);
  }

  return (
    <Screen scroll>
      <Heading style={{ marginBottom: 20 }}>Account</Heading>
      <Card style={{ gap: 14 }}>
        <Row t={t} label="Name" value={session?.user.fullName ?? '—'} />
        <Row t={t} label="Email" value={session?.user.email ?? '—'} />
        <Row t={t} label="Role" value={session?.tenant?.role ?? '—'} chip />
        <Row t={t} label="Business" value={session?.tenant?.name ?? '—'} />
        <Row t={t} label="Slug" value={session?.tenant?.slug ?? '—'} />
      </Card>

      {/* ── Business settings (moved from the Business tab) ───────────── */}
      {loadingCfg && !config && <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 20 }} />}
      {config && (
        <View style={{ marginTop: 16, gap: 12 }}>
          <Card padding={14} style={{ gap: 10 }}>
            <Text style={[s.sectionLabel, { color: t.ink[300] }]}>Business</Text>
            <Row t={t} label="Name" value={config.businessName ?? '—'} />
            <Row t={t} label="Phone" value={config.contact?.publicPhone ?? '—'} />
            <Row t={t} label="Email" value={config.contact?.publicEmail ?? '—'} />
            <Row t={t} label="Timezone" value={config.scheduling?.timezone ?? '—'} />
          </Card>

          <Card padding={14} style={{ gap: 10 }}>
            <Text style={[s.sectionLabel, { color: t.ink[300] }]}>Features</Text>
            <ToggleRow t={t} label="Residential customers" val={config.features?.residentialEnabled} />
            <ToggleRow t={t} label="Commercial customers" val={config.features?.commercialEnabled} />
            <ToggleRow t={t} label="Public quote form" val={config.features?.publicQuoteFormEnabled} />
            <ToggleRow t={t} label="Emergency requests" val={config.features?.emergencyRequests} />
          </Card>

          <Card padding={14} style={{ gap: 10 }}>
            <Text style={[s.sectionLabel, { color: t.ink[300] }]}>AI assistants</Text>
            <View style={s.switchRow}>
              <Text style={[s.switchLabel, { color: t.ink[700] }]}>Quote assistant</Text>
              <Switch value={!!config.ai?.quoteAssistant} onValueChange={v => toggleAiFeature('quoteAssistant', v)} trackColor={{ true: t.brand.brand500 }} />
            </View>
            <View style={s.switchRow}>
              <Text style={[s.switchLabel, { color: t.ink[700] }]}>Business insights</Text>
              <Switch value={!!config.ai?.businessInsights} onValueChange={v => toggleAiFeature('businessInsights', v)} trackColor={{ true: t.brand.brand500 }} />
            </View>
            <View style={s.switchRow}>
              <Text style={[s.switchLabel, { color: t.ink[700] }]}>Email drafting</Text>
              <Switch value={!!config.ai?.emailAssistant} onValueChange={v => toggleAiFeature('emailAssistant', v)} trackColor={{ true: t.brand.brand500 }} />
            </View>
          </Card>

          {/* Stripe Connect + payment policy — web's /admin/settings PaymentsForm */}
          <PaymentsPanel config={config} onSaved={loadConfig} />

          {/* Automations — the automated customer messages editor */}
          <TouchableOpacity onPress={() => router.push('/(admin)/automations' as any)}>
            <Card padding={14}>
              <View style={s.linkRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="chatbox-ellipses-outline" size={18} color={t.brand.brand600} />
                  <Text style={[s.switchLabel, { color: t.ink[900], fontWeight: '600' }]}>Automations</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.ink[300]} />
              </View>
            </Card>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ marginTop: 16 }}>
        <Button title="Sign out" variant="secondary" onPress={handleSignOut} />
      </View>
    </Screen>
  );
}

function Row({ t, label, value, chip }: { t: Theme; label: string; value: string; chip?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: t.ink[500] }]}>{label}</Text>
      {chip
        ? <Badge>{value}</Badge>
        : <Text style={[s.rowValue, { color: t.ink[900] }]}>{value}</Text>}
    </View>
  );
}

function ToggleRow({ t, label, val }: { t: Theme; label: string; val: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: t.ink[500] }]}>{label}</Text>
      <View style={[s.toggleDot, { backgroundColor: val ? '#22c55e' : '#e7e5e4' }]}>
        <Text style={{ fontSize: 10, color: val ? '#fff' : '#a8a29e', fontWeight: '700' }}>{val ? 'ON' : 'OFF'}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 13, fontWeight: '500' },
  rowValue: { fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { fontSize: 14 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleDot: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
});
