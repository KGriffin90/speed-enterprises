import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { PlatformLogo } from '@/components/PlatformLogo';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Heading, Muted } from '@/components/ui';

/**
 * Password recovery — mobile mirror of web's /auth/forgot-password.
 * POST /api/auth/forgot-password always returns 200 (no account enumeration);
 * the reset itself completes via the emailed link, same as web.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams<{ slug?: string }>();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!/.+@.+\..+/.test(email)) return Alert.alert('Enter a valid email');
    setBusy(true);
    try {
      await apiCall('POST', '/api/auth/forgot-password', { email: email.toLowerCase().trim() });
      setSent(true);
    } catch {
      // The endpoint is intentionally quiet; only network errors land here.
      Alert.alert('Could not send', 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: t.surface[50] }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Always-available escape back to the Speed Enterprises landing page */}
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
          <Heading style={s.heading}>{sent ? 'Check your email' : 'Reset your password'}</Heading>
          <Muted>
            {sent
              ? `If an account exists for ${email.trim()}, a reset link is on its way. Open it to choose a new password, then sign in here.`
              : "Enter your account email and we'll send you a reset link."}
          </Muted>
        </View>

        {sent ? (
          <Card padding={20} style={s.form}>
            {/* Web finishes the reset on the emailed web page. Native has no
                such landing page, so offer the in-app equivalent as well. */}
            <Button
              title="I have a reset code"
              onPress={() => router.push({ pathname: '/(auth)/reset-password' as any, params: { slug: params.slug ?? '' } })}
            />
            <Button
              title="Back to sign in"
              variant="secondary"
              onPress={() => router.replace({ pathname: '/(auth)/sign-in' as any, params: { slug: params.slug ?? '' } })}
            />
            <TouchableOpacity style={s.linkRow} onPress={() => setSent(false)}>
              <Text style={[s.link, { color: t.brand.brand600 }]}>Use a different email</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card padding={20} style={s.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Button title="Send reset link" onPress={submit} loading={busy} />

            <TouchableOpacity
              style={s.linkRow}
              onPress={() => router.replace({ pathname: '/(auth)/sign-in' as any, params: { slug: params.slug ?? '' } })}
            >
              <Ionicons name="arrow-back" size={14} color={t.ink[500]} />
              <Text style={[s.linkMuted, { color: t.ink[500] }]}> Back to sign in</Text>
            </TouchableOpacity>
          </Card>
        )}
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
  link: { fontSize: 14, fontWeight: '700' },
  linkMuted: { fontSize: 14 },
});
