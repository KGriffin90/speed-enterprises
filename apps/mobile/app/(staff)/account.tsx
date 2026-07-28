import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/ThemeProvider';
import { AccountSettings } from '@/components/AccountSettings';
import { Screen, Card, Button, Badge, Heading } from '@/components/ui';

export default function AccountScreen() {
  const { session, signOut, setBrowsingSlug } = useAuth();
  const router = useRouter();
  const t = useTheme();

  async function handleSignOut() {
    // Land on the business storefront after sign-out, not the platform login.
    const slug = session?.tenant?.slug ?? null;
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          await signOut();
          if (slug) {
            await SecureStore.setItemAsync('browsing_slug', slug).catch(() => {});
            setBrowsingSlug(slug);
            router.replace({ pathname: '/(platform)/storefront' as any, params: { slug } });
          } else {
            router.replace('/(platform)/storefront' as any);
          }
        },
      },
    ]);
  }

  return (
    <Screen scroll>
      <Heading style={{ marginBottom: 16 }}>Account</Heading>
      <Card>
        <Text style={[s.label, { color: t.ink[500] }]}>Name</Text>
        <Text style={[s.value, { color: t.ink[900] }]}>{session?.user.fullName ?? '—'}</Text>
        <Text style={[s.label, { color: t.ink[500] }]}>Email</Text>
        <Text style={[s.value, { color: t.ink[900] }]}>{session?.user.email}</Text>
        <Text style={[s.label, { color: t.ink[500] }]}>Role</Text>
        <View style={{ marginTop: 2 }}><Badge>{session?.tenant?.role ?? '—'}</Badge></View>
        <Text style={[s.label, { color: t.ink[500] }]}>Business</Text>
        <Text style={[s.value, { color: t.ink[900] }]}>{session?.tenant?.name ?? '—'}</Text>
      </Card>

      {/* Editable profile + change password — web's /dashboard/account. */}
      <AccountSettings />

      <View style={{ marginTop: 16 }}>
        <Button title="Sign out" variant="secondary" onPress={handleSignOut} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 4 },
  value: { fontSize: 15 },
});
