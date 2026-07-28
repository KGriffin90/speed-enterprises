import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView,
  RefreshControl, ActivityIndicator, Modal, TextInput, Switch, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { LoadFailedBanner } from '@/components/LoadFailedBanner';
import { Card, Badge } from '@/components/ui';

interface TemplateRow {
  id: string | null;
  kind: string;
  channel: string;
  subject: string | null;
  body: string;
  enabled: boolean;
  isCustomized: boolean;
}

// Mirrors HUMAN_KIND in apps/web/src/app/admin/automations/page.tsx.
const HUMAN_KIND: Record<string, string> = {
  verify_email: 'Email verification',
  password_reset: 'Password reset',
  quote_received_customer: 'Quote received — to customer',
  quote_received_internal: 'Quote received — internal',
  estimate_sent_customer: 'Estimate sent — to customer',
  quote_followup_no_response: 'Estimate follow-up',
  quote_accepted_internal: 'Quote accepted — internal',
  job_scheduled_customer: 'Job scheduled — to customer',
  job_reminder_customer: 'Job reminder',
  job_started_customer: 'Job started',
  job_completed_customer: 'Job completed — to customer',
  invoice_sent_customer: 'Invoice sent',
  payment_received_customer: 'Payment received',
  review_request_customer: 'Review request',
  referral_request_customer: 'Referral request',
};

/** Mirrors PLACEHOLDERS in web's automations/[kind]/[channel]/TemplateEditor.tsx. */
const PLACEHOLDERS: Array<{ key: string; desc: string }> = [
  { key: 'businessName',      desc: "Your business's display name" },
  { key: 'businessEmail',     desc: 'Your public email' },
  { key: 'businessPhone',     desc: 'Your public phone' },
  { key: 'customerFirstName', desc: 'Customer first name' },
  { key: 'customerName',      desc: 'Customer full name' },
  { key: 'customerEmail',     desc: 'Customer email' },
  { key: 'customerPhone',     desc: 'Customer phone' },
  { key: 'serviceName',       desc: 'Name of the service' },
  { key: 'address',           desc: 'Service address' },
  { key: 'quoteId',           desc: 'Internal quote id' },
  { key: 'quoteUrl',          desc: 'Link to the quote detail page' },
  { key: 'quoteAmount',       desc: 'Estimate amount, formatted' },
  { key: 'estimateMessage',   desc: 'Admin-written message on estimate send' },
  { key: 'scheduledAt',       desc: 'ISO scheduled date/time' },
  { key: 'customerNotes',     desc: "Customer's notes on the quote" },
  { key: 'invoiceUrl',        desc: 'Link to pay the invoice' },
  { key: 'reviewUrl',         desc: 'Link to your review profile' },
];

interface Preview { subject: string; html: string; text: string }

export default function AdminAutomationsScreen() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [failed, setFailed] = useState(false);

  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showPlaceholders, setShowPlaceholders] = useState(false);

  async function load() {
    setLoading(true);
    try { setRows(await apiCall<TemplateRow[]>('GET', '/api/me/automations')); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); setRefresh(false); }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  function openEdit(r: TemplateRow) {
    setEditing(r);
    setSubject(r.subject ?? '');
    setBody(r.body);
    setEnabled(r.enabled);
    setPreview(null);
    setShowPlaceholders(false);
  }

  /**
   * Render the template server-side with sample data, same endpoint web's
   * Preview button hits. Web embeds the returned HTML in an <iframe>; without a
   * WebView dependency we show the `text` rendering the API returns alongside
   * it, which carries the same substituted content.
   */
  async function doPreview() {
    if (!editing) return;
    setPreviewing(true);
    try {
      setPreview(await apiCall<Preview>(
        'POST',
        `/api/me/automations/${encodeURIComponent(editing.kind)}/${encodeURIComponent(editing.channel)}/preview`,
        { subject: editing.channel === 'EMAIL' ? subject : undefined, body },
      ));
    } catch (e: any) {
      Alert.alert('Preview failed', e?.message ?? 'Could not render this template.');
    } finally { setPreviewing(false); }
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await apiCall('PATCH', `/api/me/automations/${encodeURIComponent(editing.kind)}/${encodeURIComponent(editing.channel)}`, {
        subject: editing.channel === 'EMAIL' ? subject : undefined,
        body,
        enabled,
      });
      setEditing(null);
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setBusy(false); }
  }

  async function resetToDefault() {
    if (!editing) return;
    Alert.alert('Reset template', 'Revert to the platform default wording?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          await apiCall('DELETE', `/api/me/automations/${encodeURIComponent(editing.kind)}/${encodeURIComponent(editing.channel)}`);
          setEditing(null);
          await load();
        } catch (e: any) { Alert.alert('Error', e.message); }
        finally { setBusy(false); }
      }},
    ]);
  }

  const customized = rows.filter(r => r.isCustomized).length;
  const modalInput = [m.input, { borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900], backgroundColor: t.surface[50] }];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <View style={[s.header, { backgroundColor: t.surface[0], borderBottomColor: t.surface[100] }]}>
        <View style={s.headerTop}>
          <TouchableOpacity style={s.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={t.brand.brand600} />
            <Text style={[s.backText, { color: t.brand.brand600 }]}>Business</Text>
          </TouchableOpacity>
          <Text style={[s.sub, { color: t.ink[300] }]}>{customized}/{rows.length} customized</Text>
        </View>
        <Text style={[s.heading, { color: t.ink[900] }]}>Automations</Text>
        <Text style={[s.lead, { color: t.ink[500] }]}>Edit the wording of the automated messages your customers receive. Untouched messages fall through to platform defaults.</Text>
      </View>

      {loading && !refresh && <ActivityIndicator style={{ marginTop: 40 }} color={t.brand.brand500} />}
      {failed && !loading && <LoadFailedBanner onRetry={load} />}

      <FlatList
        data={rows}
        keyExtractor={r => `${r.kind}:${r.channel}`}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); load(); }} tintColor={t.brand.brand500} />}
        renderItem={({ item: r }) => (
          <TouchableOpacity activeOpacity={0.8} onPress={() => openEdit(r)}>
            <Card padding={16}>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, { color: t.ink[900] }]}>{HUMAN_KIND[r.kind] ?? r.kind}</Text>
                  <Text style={[s.meta, { color: t.ink[300] }]}>{r.channel}{r.subject ? ` · ${r.subject}` : ''}</Text>
                </View>
                {r.isCustomized
                  ? <Badge>Custom</Badge>
                  : <Text style={[s.default, { color: t.ink[300] }]}>Default</Text>}
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={!loading && !failed ? <Text style={[s.empty, { color: t.ink[300] }]}>No automations.</Text> : null}
      />

      {/* Edit modal */}
      <Modal visible={!!editing} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={[m.sheet, { backgroundColor: t.surface[0] }]}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            <Text style={[m.title, { color: t.ink[900] }]}>{editing ? (HUMAN_KIND[editing.kind] ?? editing.kind) : ''}</Text>
            <Text style={[m.channelTag, { color: t.ink[300] }]}>{editing?.channel}</Text>
            {editing?.channel === 'EMAIL' && (
              <>
                <Text style={[m.label, { color: t.ink[700] }]}>Subject</Text>
                <TextInput style={modalInput} value={subject} onChangeText={setSubject} placeholderTextColor={t.ink[300]} />
              </>
            )}
            <Text style={[m.label, { color: t.ink[700] }]}>Body</Text>
            <TextInput style={[modalInput, { height: 140, textAlignVertical: 'top' }]} value={body} onChangeText={setBody} multiline placeholderTextColor={t.ink[300]} />
            <View style={m.switchRow}>
              <Text style={[m.switchLabel, { color: t.ink[700] }]}>Enabled</Text>
              <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: t.brand.brand500 }} />
            </View>
            <Text style={[m.note, { color: t.ink[300] }]}>Use {'{{variables}}'} like the web editor. Reset reverts to the platform default.</Text>

            {/* Placeholder reference — web keeps this in a sidebar; on a phone
                it collapses so it doesn't push the editor off-screen. */}
            <TouchableOpacity style={m.disclosure} onPress={() => setShowPlaceholders(v => !v)}>
              <Ionicons name={showPlaceholders ? 'chevron-down' : 'chevron-forward'} size={14} color={t.brand.brand600} />
              <Text style={[m.disclosureText, { color: t.brand.brand600 }]}>Placeholders</Text>
            </TouchableOpacity>
            {showPlaceholders && (
              <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }} nestedScrollEnabled>
                {PLACEHOLDERS.map(p => (
                  <View key={p.key}>
                    <Text style={[m.code, { color: t.brand.brand700 }]}>{`{{${p.key}}}`}</Text>
                    <Text style={[m.codeDesc, { color: t.ink[500] }]}>{p.desc}</Text>
                  </View>
                ))}
              </ScrollView>
            )}

            {preview && (
              <View style={[m.preview, { backgroundColor: t.surface[50], borderColor: t.surface[200], borderRadius: t.radius }]}>
                {editing?.channel === 'EMAIL' && (
                  <Text style={[m.previewSubject, { color: t.ink[900] }]}>Subject: {preview.subject}</Text>
                )}
                <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                  <Text style={[m.previewBody, { color: t.ink[700] }]}>{preview.text}</Text>
                </ScrollView>
              </View>
            )}

            <TouchableOpacity
              style={[m.previewBtn, { borderColor: t.surface[200], borderRadius: t.radius }]}
              onPress={doPreview}
              disabled={previewing}
            >
              <Text style={[m.previewBtnText, { color: t.ink[700] }]}>{previewing ? 'Rendering…' : 'Preview'}</Text>
            </TouchableOpacity>

            <View style={m.btnRow}>
              <TouchableOpacity style={[m.reset, { borderColor: t.surface[200], borderRadius: t.radius }]} onPress={resetToDefault} disabled={busy || !editing?.isCustomized}>
                <Text style={[m.resetText, { color: editing?.isCustomized ? '#dc2626' : t.ink[300] }]}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[m.cancel, { backgroundColor: t.surface[100], borderRadius: t.radius }]} onPress={() => setEditing(null)}><Text style={[m.cancelText, { color: t.ink[700] }]}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[m.confirm, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={save} disabled={busy}>
                <Text style={[m.confirmText, { color: t.brand.onBrand }]}>{busy ? '…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 14, fontWeight: '500' },
  heading: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 12 },
  lead: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 2 },
  default: { fontSize: 11, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 48 },
});
const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700' },
  channelTag: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  input: { borderWidth: 1, padding: 12, fontSize: 15 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  switchLabel: { fontSize: 14 },
  note: { fontSize: 12, marginTop: 4 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  disclosureText: { fontSize: 13, fontWeight: '600' },
  code: { fontSize: 12, fontWeight: '700' },
  codeDesc: { fontSize: 11, marginTop: 1 },
  preview: { borderWidth: 1, padding: 12, gap: 6, marginTop: 4 },
  previewSubject: { fontSize: 12, fontWeight: '700' },
  previewBody: { fontSize: 13, lineHeight: 19 },
  previewBtn: { borderWidth: 1, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  previewBtnText: { fontSize: 14, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  reset: { paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, justifyContent: 'center' },
  resetText: { fontSize: 15, fontWeight: '600' },
  cancel: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirm: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '600' },
});
