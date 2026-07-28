/**
 * AccountSettings — native mirror of web's /dashboard/account
 * (apps/web/src/app/dashboard/account/{page,ProfileForm,PasswordForm}.tsx).
 *
 * Renders the editable profile (name, phone, service address, marketing
 * consent) and the change-password form. Web serves this page to CUSTOMER and
 * STAFF; owners are redirected to /admin and get the business Settings page
 * instead, so this component is mounted on those two account screens only.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiCall, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatPhone } from '@/lib/formatPhone';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input } from '@/components/ui';

interface Profile {
  fullName: string; phone: string;
  addressLine: string | null; city: string | null; state: string | null; postalCode: string | null;
  marketingConsent: boolean;
}

interface ProfilePayload {
  user: { id: string; email: string; platformRole: string; emailVerifiedAt: string | null; createdAt: string };
  profile: Profile | null;
  membership: { role: string; createdAt: string } | null;
}

/** Web enforces minLength=8 on the new password input. */
const MIN_PASSWORD_LENGTH = 8;

export function AccountSettings() {
  const t = useTheme();
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setPayload(await apiCall<ProfilePayload>('GET', '/api/me/profile'));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 24 }} />;
  if (failed) {
    return (
      <Card style={{ marginTop: 16, gap: 12 }}>
        <Text style={{ fontSize: 14, color: t.ink[700] }}>Couldn't load your profile — check your connection.</Text>
        <Button title="Retry" variant="secondary" onPress={load} />
      </Card>
    );
  }

  return (
    <View style={{ gap: 16, marginTop: 16 }}>
      <ProfileForm initial={payload?.profile ?? null} onSaved={load} />
      <PasswordForm />
    </View>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfileForm({ initial, onSaved }: { initial: Profile | null; onSaved: () => void }) {
  const t = useTheme();
  const [form, setForm] = useState({
    fullName: initial?.fullName ?? '',
    phone: initial?.phone ?? '',
    addressLine: initial?.addressLine ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    postalCode: initial?.postalCode ?? '',
    marketingConsent: initial?.marketingConsent ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await apiCall('PATCH', '/api/me/profile', form);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: 14 }}>
      <View style={s.headerRow}>
        <Text style={[s.cardTitle, { color: t.ink[900] }]}>Profile</Text>
        {saved && <Text style={s.saved}>Saved.</Text>}
      </View>

      <Input label="Full name" value={form.fullName} onChangeText={v => set('fullName', v)} autoCapitalize="words" />
      <Input
        label="Phone"
        value={form.phone}
        onChangeText={v => set('phone', v)}
        // Web formats on blur; same here so the stored value matches.
        onBlur={() => set('phone', formatPhone(form.phone))}
        keyboardType="phone-pad"
      />
      <Input label="Street" value={form.addressLine} onChangeText={v => set('addressLine', v)} />
      <Input label="City" value={form.city} onChangeText={v => set('city', v)} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ width: 96 }}>
          <Input
            label="State"
            value={form.state}
            onChangeText={v => set('state', v.toUpperCase())}
            maxLength={2}
            autoCapitalize="characters"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="ZIP" value={form.postalCode} onChangeText={v => set('postalCode', v)} keyboardType="number-pad" />
        </View>
      </View>

      <View style={s.switchRow}>
        <Text style={[s.switchLabel, { color: t.ink[700] }]}>
          Send me reminders, follow-ups, and seasonal offers.
        </Text>
        <Switch
          value={form.marketingConsent}
          onValueChange={v => set('marketingConsent', v)}
          trackColor={{ true: t.brand.brand500 }}
          accessibilityLabel="Marketing consent"
        />
      </View>

      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Save profile'} onPress={save} loading={busy} />
    </Card>
  );
}

// ── Password ──────────────────────────────────────────────────────────────────

function PasswordForm() {
  const t = useTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!current || !next) { setError('Enter your current and new password.'); return; }
    if (next.length < MIN_PASSWORD_LENGTH) { setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    setBusy(true); setError(null);
    try {
      await apiCall('POST', '/api/me/change-password', { currentPassword: current, newPassword: next });
      // The server revoked every refresh token — drop the local session too and
      // send the user back to sign-in, exactly as web does.
      await signOut().catch(() => {});
      router.replace('/(auth)/sign-in' as any);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change');
    } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Text style={[s.cardTitle, { color: t.ink[900] }]}>Change password</Text>
      <Text style={[s.help, { color: t.ink[500] }]}>
        You'll be signed out of all sessions when you change your password.
      </Text>
      <Input
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
      />
      <Input
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      />
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Updating…' : 'Update password'} variant="secondary" onPress={submit} loading={busy} />
    </Card>
  );
}

const s = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  help: { fontSize: 13, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  switchLabel: { fontSize: 13, flex: 1, lineHeight: 18 },
  saved: { fontSize: 12, color: '#059669' },
  error: { fontSize: 13, color: '#dc2626' },
});
