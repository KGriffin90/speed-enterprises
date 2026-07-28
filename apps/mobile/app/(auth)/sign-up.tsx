import { useEffect, useState } from 'react';
import {
  View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity, Text,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { apiCall, ApiError } from '@/lib/api';
import { getPendingQuote, submitPendingQuote } from '@/lib/pending-quote';
import { LEGAL_VERSIONS, openLegal } from '@/lib/legal';
import { useTheme } from '@/theme/ThemeProvider';
import { PlatformLogo } from '@/components/PlatformLogo';
import { Button, Card, Input, Heading, Muted } from '@/components/ui';

type Step = 'form' | 'otp';

/**
 * In-app account creation, reached when a signed-out customer submits a quote
 * (the gate). Backend flow: register → email OTP → verify → login. We collect
 * the contact details the wizard already gathered (prefilled), register, verify
 * the 6-digit code, then sign in for a tenant-bound session and send the held
 * quote. See src/lib/pending-quote.ts.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const t = useTheme();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ fullName?: string; email?: string; phone?: string; slug?: string }>();

  const [step, setStep] = useState<Step>('form');
  const [slug, setSlug] = useState(params.slug ?? '');
  const [fullName, setFullName] = useState(params.fullName ?? '');
  const [email, setEmail] = useState(params.email ?? '');
  const [phone, setPhone] = useState(params.phone ?? '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);

  // The browsing tenant slug is stored on the discovery screen; fall back to it
  // when this screen wasn't given one explicitly.
  useEffect(() => {
    if (!slug) SecureStore.getItemAsync('browsing_slug').then(s => { if (s) setSlug(s); });
  }, []);

  /** Route the user to sign-in with the business preserved (used when an
   *  account with this email already exists). */
  function toSignIn(message: string) {
    Alert.alert('Account already exists', message, [
      { text: 'Sign in', onPress: () => router.replace({ pathname: '/(auth)/sign-in' as any, params: { slug } }) },
    ]);
  }

  async function register() {
    if (!fullName.trim() || !/.+@.+\..+/.test(email) || !phone.trim() || password.length < 8) {
      return Alert.alert('Check your details', 'Name, valid email, phone, and an 8+ character password are required.');
    }
    if (!slug) return Alert.alert('Missing business', 'No business selected. Go back and pick a business first.');
    if (!agreed) {
      return Alert.alert('Agree to continue', 'Please accept the Terms of Service and Privacy Policy to create an account.');
    }

    setBusy(true);
    try {
      await apiCall('POST', '/api/auth/register', {
        tenantSlug: slug,
        email: email.toLowerCase().trim(),
        password,
        fullName: fullName.trim(),
        phone: phone.trim(),
        acceptTerms: true,
        acceptedTermsVersion: LEGAL_VERSIONS.terms,
        acceptedPrivacyVersion: LEGAL_VERSIONS.privacy,
        marketingConsent: marketing,
      });

      // The API only emails an OTP to UNVERIFIED users. An existing verified
      // user joining this business gets a membership and no email — showing
      // them the OTP step would strand them waiting for a code that never
      // comes. So: try signing in directly. New accounts fail with "Email not
      // verified" (→ OTP step, the code IS in their inbox); existing accounts
      // with the right password sail straight through.
      try {
        await signIn(email.toLowerCase().trim(), password, slug);
        await finish();
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : '';
        if (e instanceof ApiError && /invalid credentials/i.test(msg)) {
          // Existing account, different password than they typed here.
          toSignIn('An account with this email already exists. Sign in with your existing password to finish your request.');
        } else {
          // "Email not verified" (fresh account) or a transient network error —
          // the OTP step handles both (it has a resend action).
          setStep('otp');
        }
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Sign-up failed. Please try again.';
      if (e instanceof ApiError && e.status === 409) {
        // "Already registered with this business"
        toSignIn(`${msg}. Sign in to continue.`);
      } else {
        Alert.alert('Sign-up failed', msg);
      }
    } finally { setBusy(false); }
  }

  async function verify() {
    if (otp.trim().length !== 6) return Alert.alert('Enter the 6-digit code', 'Check your email for the verification code.');
    setBusy(true);
    try {
      await apiCall('POST', '/api/auth/verify-email', { email: email.toLowerCase().trim(), otp: otp.trim() });
      // Verification issues a tenant-less session; sign in to get a tenant-bound
      // one (identical to the normal login path) before finishing the quote.
      await signIn(email.toLowerCase().trim(), password, slug);
      await finish();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Verification failed. Please try again.';
      Alert.alert('Verification failed', msg);
    } finally { setBusy(false); }
  }

  async function resend() {
    try {
      await apiCall('POST', '/api/auth/resend-verification', { email: email.toLowerCase().trim() });
      Alert.alert('Code sent', 'A new verification code is on its way — it can take a few minutes to arrive. It expires 15 minutes after it was sent.');
    } catch { Alert.alert('Could not resend', 'Please try again in a moment.'); }
  }

  async function finish() {
    // Send the quote the user built while signed out (best-effort), then land
    // them back on the business storefront they came from — not "My Quotes".
    // Their quote is reachable any time via the storefront's My Quotes button.
    if (getPendingQuote()) {
      try { await submitPendingQuote(); }
      catch { /* best-effort; it's visible under My Quotes where they can retry */ }
    }
    if (slug) {
      router.replace({ pathname: '/(platform)/storefront' as any, params: { slug } });
    } else {
      router.replace('/(customer)/quotes');
    }
  }

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: t.surface[50] }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          <Heading style={s.heading}>{step === 'form' ? 'Create your account' : 'Verify your email'}</Heading>
          <Muted>
            {step === 'form'
              ? 'One quick step to send your request and track it.'
              : `Enter the 6-digit code we emailed to ${email}.`}
          </Muted>
        </View>

        {step === 'form' ? (
          <Card padding={20} style={s.form}>
            <Input label="Full name" value={fullName} onChangeText={setFullName} placeholder="Jane Smith" autoCapitalize="words" />
            <Input label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <Input label="Phone" value={phone} onChangeText={setPhone} placeholder="(801) 555-0100" keyboardType="phone-pad" />
            <Input label="Password" value={password} onChangeText={setPassword} placeholder="Min. 8 characters" secureTextEntry />

            {/* Required legal consent */}
            <TouchableOpacity style={s.consentRow} onPress={() => setAgreed(v => !v)} activeOpacity={0.7}>
              <View style={[s.checkbox, { borderColor: agreed ? t.brand.brand500 : t.surface[200], backgroundColor: agreed ? t.brand.brand500 : 'transparent' }]}>
                {agreed && <Ionicons name="checkmark" size={14} color={t.brand.onBrand} />}
              </View>
              <Text style={[s.consentText, { color: t.ink[500] }]}>
                I agree to the{' '}
                <Text style={[s.consentLink, { color: t.brand.brand600 }]} onPress={() => openLegal('terms-of-service')}>Terms of Service</Text>,{' '}
                <Text style={[s.consentLink, { color: t.brand.brand600 }]} onPress={() => openLegal('eula')}>EULA</Text>, and{' '}
                <Text style={[s.consentLink, { color: t.brand.brand600 }]} onPress={() => openLegal('privacy-policy')}>Privacy Policy</Text>, and to receive transactional messages about my requests.
              </Text>
            </TouchableOpacity>

            {/* Optional marketing consent */}
            <TouchableOpacity style={s.consentRow} onPress={() => setMarketing(v => !v)} activeOpacity={0.7}>
              <View style={[s.checkbox, { borderColor: marketing ? t.brand.brand500 : t.surface[200], backgroundColor: marketing ? t.brand.brand500 : 'transparent' }]}>
                {marketing && <Ionicons name="checkmark" size={14} color={t.brand.onBrand} />}
              </View>
              <Text style={[s.consentTextMuted, { color: t.ink[500] }]}>
                (Optional) Send me occasional updates and offers. Unsubscribe anytime.
              </Text>
            </TouchableOpacity>

            <Button title="Create account" onPress={register} loading={busy} disabled={!agreed} />

            <TouchableOpacity style={s.linkRow} onPress={() => router.replace({ pathname: '/(auth)/sign-in' as any, params: { slug } })}>
              <Text style={[s.linkMuted, { color: t.ink[500] }]}>Already have an account? </Text>
              <Text style={[s.link, { color: t.brand.brand600 }]}>Sign in</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card padding={20} style={s.form}>
            <Input
              label="Verification code"
              help="The code can take a few minutes to arrive and expires 15 minutes after it's sent. Tap Resend for a fresh one."
              value={otp}
              onChangeText={v => setOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
            />
            <Button title="Verify & continue" onPress={verify} loading={busy} />

            <TouchableOpacity style={s.linkRow} onPress={resend}>
              <Text style={[s.link, { color: t.brand.brand600 }]}>Resend code</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.linkRow} onPress={() => setStep('form')}>
              <Text style={[s.linkMuted, { color: t.ink[500] }]}>← Edit details</Text>
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
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 2 },
  link: { fontSize: 14, fontWeight: '700' },
  linkMuted: { fontSize: 14 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: -4 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  consentText: { flex: 1, fontSize: 12, lineHeight: 18 },
  consentTextMuted: { flex: 1, fontSize: 12, lineHeight: 18 },
  consentLink: { fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
});
