import { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, Animated, Easing,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { ApiError, DEFAULT_TENANT_SLUG } from '@/lib/api';
import { getPendingQuote, submitPendingQuote } from '@/lib/pending-quote';
import { SplashView } from '@/components/SplashView';
import { PlatformLogo } from '@/components/PlatformLogo';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Heading, Muted } from '@/components/ui';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string; role?: string }>();
  const t = useTheme();

  // Staff/owners are provisioned by their business — self-serve sign-up only
  // creates CUSTOMER accounts, so hide it on the worker/owner path (A5a).
  const isWorkerFlow = params.role === 'staff' || params.role === 'owner';

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  // Single-business app: the tenant is fixed (Speed Enterprises), so there's no
  // "Business" field — default to the configured tenant slug.
  const [slug] = useState(params.slug ?? DEFAULT_TENANT_SLUG);
  const [loading, setLoading] = useState(false);

  // Fade the form out when login starts, back in on failure.
  const formOpacity = useRef(new Animated.Value(1)).current;

  function fadeForm(to: number, duration = 200) {
    return new Promise<void>(resolve =>
      Animated.timing(formOpacity, {
        toValue: to, duration,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(() => resolve())
    );
  }

  async function submit() {
    if (!email || !pass) return Alert.alert('Fill in all fields');

    await fadeForm(0);
    setLoading(true);

    try {
      // Route on the session returned by signIn — the hook's isStaff/isAdmin
      // values in this closure are from before login and would be stale.
      const newSession = await signIn(email.toLowerCase().trim(), pass, slug.toLowerCase().trim());
      const role = newSession.tenant?.role;
      const staff = role === 'STAFF' || role === 'OWNER';
      const admin = role === 'OWNER';

      // If the user was mid-quote when the gate stopped them, send it now and
      // drop them on "My Quotes" so they see it land.
      if (!staff && getPendingQuote()) {
        try { await submitPendingQuote(); } catch { /* best-effort */ }
        return router.replace('/(customer)/quotes');
      }
      if (admin) return router.replace('/(admin)/quotes');
      if (staff) return router.replace('/(staff)/jobs');
      router.replace('/(customer)/quotes');
    } catch (e) {
      setLoading(false);
      await fadeForm(1);
      Alert.alert('Sign-in failed', e instanceof ApiError ? e.message : 'Check your credentials and try again.');
    }
  }

  if (loading) return <SplashView />;

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: t.surface[50] }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={{ flex: 1, opacity: formOpacity }}>
        {/* Always-available escape back to the Speed Enterprises landing page */}
        <TouchableOpacity
          style={[s.topLeftBack, { backgroundColor: t.surface[100] }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(platform)/storefront' as any))}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={t.ink[700]} />
        </TouchableOpacity>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Brand header */}
          <View style={s.brand}>
            <PlatformLogo size={72} />
            <Heading style={s.heading}>Speed Enterprises</Heading>
            <Muted>Sign in to your account</Muted>
          </View>

          {/* Fields */}
          <Card padding={20} style={s.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
              returnKeyType="next"
            />
            <Input
              label="Password"
              value={pass}
              onChangeText={setPass}
              secureTextEntry
              placeholder="••••••••"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Button title="Sign in" onPress={submit} />

            <TouchableOpacity
              style={s.signUpRow}
              onPress={() => router.push({ pathname: '/(auth)/forgot-password' as any, params: { slug } })}
            >
              <Text style={[s.signUpLink, { color: t.brand.brand600 }]}>Forgot password?</Text>
            </TouchableOpacity>

            {!isWorkerFlow && (
              <TouchableOpacity
                style={s.signUpRow}
                onPress={() => router.replace({ pathname: '/(auth)/sign-up' as any, params: { slug } })}
              >
                <Text style={[s.signUpMuted, { color: t.ink[500] }]}>New customer? </Text>
                <Text style={[s.signUpLink, { color: t.brand.brand600 }]}>Create an account</Text>
              </TouchableOpacity>
            )}
          </Card>
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  topLeftBack: { position: 'absolute', top: 56, left: 20, width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  brand: { alignItems: 'center', paddingTop: 40, paddingBottom: 36, gap: 8 },
  heading: { marginTop: 12 },
  form: { gap: 16 },
  signUpRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 2 },
  signUpMuted: { fontSize: 14 },
  signUpLink: { fontSize: 14, fontWeight: '700' },
});
