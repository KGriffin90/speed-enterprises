import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, ApiError, DEFAULT_TENANT_SLUG } from '@/lib/api';
import { PlatformLogo } from '@/components/PlatformLogo';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Heading, Muted } from '@/components/ui';

/** Web enforces minLength=8 on the new-password input. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Choose a new password — mobile mirror of web's /auth/reset-password.
 *
 * Web reads the one-time token from `?token=`; here it arrives either as a
 * deep-link param (speedenterprises://auth/reset-password?token=…) or, when the
 * emailed link opened the website instead, the customer can paste the code in.
 * Same endpoint and same post-reset destination (sign-in) either way.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams<{ token?: string; slug?: string }>();

  const [token, setToken] = useState(params.token ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A token that arrived on the link is trusted as-is; without one we show the
  // paste field rather than dead-ending the way web does.
  const linkedToken = !!params.token;

  async function submit() {
    if (!token.trim()) { setError('Enter the reset code from your email.'); return; }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await apiCall('POST', '/api/auth/reset-password', { token: token.trim(), newPassword: password });
      router.replace({
        pathname: '/(auth)/sign-in' as any,
        params: { slug: params.slug ?? DEFAULT_TENANT_SLUG },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reset failed');
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: t.surface[50] }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableOpacity
        style={[s.topLeftBack, { backgroundColor: t.surface[100] }]}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(platform)/storefront' as any))}
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={20} color={t.ink[700]} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <PlatformLogo size={64} />
          <Heading style={s.heading}>Choose a new password</Heading>
          <Muted>
            {linkedToken
              ? 'Pick a new password for your account.'
              : 'Paste the reset code from your email, then pick a new password.'}
          </Muted>
        </View>

        <Card padding={20} style={s.form}>
          {!linkedToken && (
            <Input
              label="Reset code"
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste the code from your email"
            />
          )}
          <Input
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {error && <Text style={s.error}>{error}</Text>}
          <Button title={busy ? 'Saving…' : 'Save and sign in'} onPress={submit} loading={busy} />

          <TouchableOpacity
            style={s.linkRow}
            onPress={() => router.replace({ pathname: '/(auth)/sign-in' as any, params: { slug: params.slug ?? '' } })}
          >
            <Ionicons name="arrow-back" size={14} color={t.ink[500]} />
            <Text style={[s.linkMuted, { color: t.ink[500] }]}> Back to sign in</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  topLeftBack: { position: 'absolute', top: 56, left: 20, width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  brand: { alignItems: 'center', paddingTop: 24, paddingBottom: 28, gap: 8 },
  heading: { marginTop: 12 },
  form: { gap: 16 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  linkMuted: { fontSize: 14 },
  error: { fontSize: 13, color: '#dc2626' },
});
