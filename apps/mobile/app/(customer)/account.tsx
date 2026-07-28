import { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { openLegal, type LegalSlug } from '@/lib/legal';
import { useTheme } from '@/theme/ThemeProvider';
import { AccountSettings } from '@/components/AccountSettings';
import { Screen, Card, Button, Heading } from '@/components/ui';

const LEGAL_LINKS: { slug: LegalSlug; label: string }[] = [
  { slug: 'privacy-policy',   label: 'Privacy Policy' },
  { slug: 'terms-of-service', label: 'Terms of Service' },
  { slug: 'eula',             label: 'End User License Agreement' },
  { slug: 'acceptable-use-policy', label: 'Acceptable Use Policy' },
  { slug: 'cookie-policy',    label: 'Cookie Policy' },
];

export default function CustomerAccountScreen() {
  const { session, signOut, setBrowsingSlug } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const [deleting, setDeleting] = useState(false);

  /** After sign-out/deletion, return to the business storefront (not the
   *  platform sign-in screen). Seed the browsing slug — the public
   *  storefront/wizard read it (never 'tenant_slug', which is session-bound). */
  async function exitToStorefront(slug: string | null) {
    if (slug) {
      await SecureStore.setItemAsync('browsing_slug', slug).catch(() => {});
      setBrowsingSlug(slug);
      router.replace({ pathname: '/(platform)/storefront' as any, params: { slug } });
    } else {
      router.replace('/(platform)/storefront' as any);
    }
  }

  async function handleSignOut() {
    const slug = session?.tenant?.slug ?? null;
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          await signOut();
          await exitToStorefront(slug);
        },
      },
    ]);
  }

  // App Store Guideline 5.1.1(v): in-app account deletion must be available
  // wherever in-app account creation exists. Double-confirm, then the API
  // soft-deletes the user and revokes every session.
  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account. You will lose access to your quotes and history, and this cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            Alert.alert('Are you sure?', 'Your account will be deleted immediately.', [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete my account', style: 'destructive', onPress: async () => {
                  const slug = session?.tenant?.slug ?? null;
                  setDeleting(true);
                  try {
                    await apiCall('DELETE', '/api/me/account');
                    await signOut().catch(() => {});
                    await exitToStorefront(slug);
                  } catch (e) {
                    Alert.alert('Could not delete account', e instanceof ApiError ? e.message : 'Please try again.');
                  } finally {
                    setDeleting(false);
                  }
                },
              },
            ]);
          },
        },
      ],
    );
  }

  return (
    <Screen scroll>
      <TouchableOpacity style={s.backRow} onPress={() => router.navigate('/(platform)/storefront' as any)} accessibilityLabel="Back to Speed Enterprises">
        <Ionicons name="arrow-back" size={16} color={t.brand.brand600} />
        <Text style={[s.backRowText, { color: t.brand.brand600 }]}>Speed Enterprises</Text>
      </TouchableOpacity>
      <Heading style={{ marginBottom: 16 }}>Account</Heading>
      <Card>
        <Field t={t} label="Name" value={session?.user.fullName ?? '—'} />
        <Field t={t} label="Email" value={session?.user.email ?? '—'} />
        <Field t={t} label="Business" value={session?.tenant?.name ?? '—'} />
      </Card>

      {/* Editable profile + change password — web's /dashboard/account. */}
      <AccountSettings />

      {/* Legal */}
      <Text style={[s.sectionLabel, { color: t.ink[500] }]}>Legal</Text>
      <Card>
        {LEGAL_LINKS.map((item, i) => (
          <TouchableOpacity
            key={item.slug}
            onPress={() => openLegal(item.slug)}
            style={[s.legalRow, i > 0 && { borderTopWidth: 1, borderTopColor: t.surface[200] }]}
            accessibilityRole="link"
          >
            <Text style={[s.legalText, { color: t.ink[900] }]}>{item.label}</Text>
            <Ionicons name="open-outline" size={16} color={t.ink[300]} />
          </TouchableOpacity>
        ))}
      </Card>

      <View style={{ marginTop: 16, gap: 12 }}>
        <Button title="Sign out" variant="secondary" onPress={handleSignOut} />
        <TouchableOpacity onPress={handleDeleteAccount} disabled={deleting} style={s.deleteBtn}>
          <Text style={s.deleteText}>{deleting ? 'Deleting…' : 'Delete account'}</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

function Field({ t, label, value }: { t: ReturnType<typeof useTheme>; label: string; value: string }) {
  return (
    <View>
      <Text style={[s.label, { color: t.ink[500] }]}>{label}</Text>
      <Text style={[s.value, { color: t.ink[900] }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 4 },
  value: { fontSize: 15 },
  deleteBtn: { alignItems: 'center', paddingVertical: 12 },
  deleteText: { fontSize: 14, fontWeight: '600', color: '#dc2626' },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8 },
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13 },
  legalText: { fontSize: 15 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  backRowText: { fontSize: 14, fontWeight: '600' },
});
