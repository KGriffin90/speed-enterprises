/**
 * PaymentsPanel — native mirror of web's
 * apps/web/src/app/admin/settings/PaymentsForm.tsx.
 *
 * Stripe Connect status + onboarding, plus the payment policy the tenant config
 * carries (enabled, accepted methods, deposit, tax, invoice due days). Saves
 * through the same PATCH /api/me/config payload web sends.
 *
 * Web redirects the whole tab to Stripe's hosted onboarding and comes back to
 * /admin/settings; mobile opens the same URL in the system browser and hands
 * Stripe an app deep link to return to.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, Linking } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { apiCall, ApiError } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';

interface ConnectStatus {
  connected: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  businessName: string | null;
}

type DepositKind = 'none' | 'flat' | 'percent';
type TaxKind = 'none' | 'flat_percent' | 'stripe_tax';

const METHODS = ['card', 'ach', 'apple_pay', 'google_pay'] as const;

const DEPOSIT_OPTIONS: { value: DepositKind; label: string }[] = [
  { value: 'none', label: 'No deposit' },
  { value: 'flat', label: 'Flat amount' },
  { value: 'percent', label: 'Percentage' },
];

const TAX_OPTIONS: { value: TaxKind; label: string }[] = [
  { value: 'none', label: 'No tax' },
  { value: 'flat_percent', label: 'Fixed %' },
  { value: 'stripe_tax', label: 'Stripe Tax' },
];

function methodLabel(m: string): string {
  return m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function PaymentsPanel({ config, onSaved }: { config: any; onSaved: () => void }) {
  const t = useTheme();
  const p = config?.payments ?? {};

  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState<boolean>(!!p.enabled);
  const [depositKind, setDepositKind] = useState<DepositKind>((p.depositPolicy?.kind as DepositKind) ?? 'none');
  const [depositCents, setDepositCents] = useState<number>(p.depositPolicy?.cents ?? 0);
  const [depositPercent, setDepositPercent] = useState<number>(p.depositPolicy?.percent ?? 0);
  const [invoiceDueDays, setInvoiceDueDays] = useState<number>(p.invoiceDueDays ?? 0);
  const [taxKind, setTaxKind] = useState<TaxKind>((p.taxPolicy?.kind as TaxKind) ?? 'none');
  const [taxPercent, setTaxPercent] = useState<number>(p.taxPolicy?.percent ?? 0);
  const [methods, setMethods] = useState<string[]>(p.acceptedMethods ?? []);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await apiCall<ConnectStatus>('GET', '/api/payments/connect/status'));
    } catch {
      // Web falls back to a "not connected" shape rather than erroring out.
      setStatus({ connected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, businessName: null });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function startOnboarding() {
    setBusy(true); setError(null);
    try {
      // Stripe returns the user to the app via its registered scheme instead of
      // a web origin. Both URLs land back on this screen.
      const returnUrl = ExpoLinking.createURL('/(admin)/account', { queryParams: { stripe: 'success' } });
      const refreshUrl = ExpoLinking.createURL('/(admin)/account', { queryParams: { stripe: 'refresh' } });
      const { url } = await apiCall<{ url: string }>('POST', '/api/payments/connect/start', { returnUrl, refreshUrl });
      await Linking.openURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to start onboarding');
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await apiCall('PATCH', '/api/me/config', {
        payments: {
          enabled,
          provider: 'stripe',
          stripeAccountId: status?.accountId ?? undefined,
          acceptedMethods: methods,
          depositPolicy: depositKind === 'none' ? { kind: 'none' }
            : depositKind === 'flat' ? { kind: 'flat', cents: depositCents }
              : { kind: 'percent', percent: depositPercent },
          invoiceDueDays,
          lateFeePolicy: { kind: 'none' },
          taxPolicy: taxKind === 'none' ? { kind: 'none' }
            : taxKind === 'stripe_tax' ? { kind: 'stripe_tax' }
              : { kind: 'flat_percent', percent: taxPercent },
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  function toggleMethod(mth: string) {
    setMethods(ms => (ms.includes(mth) ? ms.filter(x => x !== mth) : [...ms, mth]));
  }

  const numInput = [s.numInput, { borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900], backgroundColor: t.surface[0] }];

  return (
    <Card padding={14} style={{ gap: 14 }}>
      <View style={s.headerRow}>
        <Text style={[s.sectionLabel, { color: t.ink[300] }]}>Payments</Text>
        {saved && <Text style={s.saved}>Saved.</Text>}
      </View>

      {/* Stripe Connect status */}
      <View style={[s.statusBox, { backgroundColor: t.surface[50], borderColor: t.surface[200], borderRadius: t.radius }]}>
        <Text style={[s.subLabel, { color: t.ink[500] }]}>Stripe Connect</Text>
        {loading ? (
          <Text style={[s.body, { color: t.ink[300] }]}>Checking…</Text>
        ) : status?.connected ? (
          <>
            {status.businessName && <Text style={[s.body, { color: t.ink[900], fontWeight: '600' }]}>{status.businessName}</Text>}
            <Text style={[s.help, { color: t.ink[500] }]}>
              {status.chargesEnabled ? '✓ Charges enabled' : '⚠ Charges not enabled'} ·{' '}
              {status.payoutsEnabled ? '✓ Payouts enabled' : '⚠ Payouts not enabled'}
            </Text>
            <Button title="Update account" variant="secondary" fullWidth={false} onPress={startOnboarding} disabled={busy} />
          </>
        ) : (
          <>
            <Text style={[s.body, { color: t.ink[700] }]}>Connect a Stripe account to accept payments.</Text>
            <Button title={busy ? 'Opening…' : 'Connect Stripe'} fullWidth={false} onPress={startOnboarding} disabled={busy} />
          </>
        )}
      </View>

      <View style={s.switchRow}>
        <Text style={[s.body, { color: t.ink[700] }]}>Enable payment collection</Text>
        <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: t.brand.brand500 }} />
      </View>

      {/* Accepted methods */}
      <View style={{ gap: 8 }}>
        <Text style={[s.subLabel, { color: t.ink[500] }]}>Accepted methods</Text>
        <View style={s.chipWrap}>
          {METHODS.map(mth => (
            <Chip key={mth} t={t} on={methods.includes(mth)} label={methodLabel(mth)} onPress={() => toggleMethod(mth)} />
          ))}
        </View>
      </View>

      {/* Deposit policy */}
      <View style={{ gap: 8 }}>
        <Text style={[s.subLabel, { color: t.ink[500] }]}>Deposit policy</Text>
        <View style={s.chipWrap}>
          {DEPOSIT_OPTIONS.map(o => (
            <Chip key={o.value} t={t} on={depositKind === o.value} label={o.label} onPress={() => setDepositKind(o.value)} />
          ))}
        </View>
        {depositKind === 'flat' && (
          <View style={s.inlineRow}>
            <Text style={[s.body, { color: t.ink[500] }]}>$</Text>
            <TextInput
              style={numInput}
              keyboardType="decimal-pad"
              value={String(depositCents / 100)}
              onChangeText={v => setDepositCents(Math.round((parseFloat(v) || 0) * 100))}
            />
          </View>
        )}
        {depositKind === 'percent' && (
          <View style={s.inlineRow}>
            <TextInput
              style={numInput}
              keyboardType="number-pad"
              value={String(depositPercent)}
              onChangeText={v => setDepositPercent(Number(v) || 0)}
            />
            <Text style={[s.body, { color: t.ink[500] }]}>%</Text>
          </View>
        )}
      </View>

      {/* Tax policy */}
      <View style={{ gap: 8 }}>
        <Text style={[s.subLabel, { color: t.ink[500] }]}>Tax</Text>
        <View style={s.chipWrap}>
          {TAX_OPTIONS.map(o => (
            <Chip key={o.value} t={t} on={taxKind === o.value} label={o.label} onPress={() => setTaxKind(o.value)} />
          ))}
        </View>
        {taxKind === 'flat_percent' && (
          <View style={s.inlineRow}>
            <TextInput
              style={numInput}
              keyboardType="decimal-pad"
              value={String(taxPercent)}
              onChangeText={v => setTaxPercent(Number(v) || 0)}
            />
            <Text style={[s.body, { color: t.ink[500] }]}>%</Text>
          </View>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[s.subLabel, { color: t.ink[500] }]}>Invoice due (days after issue)</Text>
        <View style={s.inlineRow}>
          <TextInput
            style={numInput}
            keyboardType="number-pad"
            value={String(invoiceDueDays)}
            onChangeText={v => setInvoiceDueDays(Number(v) || 0)}
          />
        </View>
      </View>

      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Save payments'} onPress={save} disabled={busy} />
    </Card>
  );
}

function Chip({ t, on, label, onPress }: { t: Theme; on: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[s.chip, {
        borderRadius: t.radiusFull,
        borderColor: on ? t.brand.brand500 : t.surface[200],
        backgroundColor: on ? t.brand.brand50 : t.surface[0],
      }]}
    >
      <Text style={{ fontSize: 12, fontWeight: on ? '700' : '500', color: on ? t.brand.brand700 : t.ink[700] }}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  subLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  statusBox: { borderWidth: 1, padding: 12, gap: 8, alignItems: 'flex-start' },
  body: { fontSize: 14 },
  help: { fontSize: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  numInput: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, minWidth: 96 },
  saved: { fontSize: 12, color: '#059669' },
  error: { fontSize: 13, color: '#dc2626' },
});
