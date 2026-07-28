import { useEffect, useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
// expo-image-picker is loaded lazily (inside each function that needs it) so
// a missing native module doesn't crash the whole wizard module on import.
// The native module is only present after `pod-install && expo run:ios`.
type ImagePickerModule = typeof import('expo-image-picker');
function getImagePicker(): ImagePickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-picker') as ImagePickerModule;
  } catch {
    return null;
  }
}
import { Ionicons } from '@expo/vector-icons';
import { apiCall, API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { setPendingQuote, type QuoteDraft } from '@/lib/pending-quote';
import {
  type WindowEntry,
  getWindowEntries, setWindowEntries, clearWindowEntries,
  totalWindowCount, summarizeWindowEntries, makeManualEntry,
} from '@/lib/window-entries';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Button } from '@/components/ui';

interface Service {
  id: string; slug: string; name: string; description: string; category: string;
  questions: Question[];
  capabilities?: string[];
}
interface Question {
  id: string; label: string; type: string; required: boolean;
  helpText?: string; placeholder?: string; unit?: string;
  options?: { value: string; label: string }[];
  min?: number; max?: number; maxFiles?: number; internal?: boolean;
}

/** A locally-held photo before it has been uploaded to the server. */
interface PhotoEntry {
  uri: string;
  mimeType: string;
  fileSize?: number;
  fileName: string;
}

interface PresignResponse {
  imageId: string;
  method: 'PUT' | 'POST';
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

type Step = 'service' | 'questions' | 'contact' | 'done';

interface Props {
  initialServiceSlug?: string;
  tenantSlug?: string;
  onBack?: () => void;
}

export function QuoteWizard({ initialServiceSlug, tenantSlug, onBack }: Props) {
  const router = useRouter();
  const { session } = useAuth();
  const t = useTheme();
  const [step, setStep] = useState<Step>('service');
  const [services, setServices] = useState<Service[]>([]);
  const [loadingSvc, setLoadingSvc] = useState(true);
  const [svcFailed, setSvcFailed] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [selected, setSelected] = useState<Service | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [contact, setContact] = useState({ fullName: session?.user.fullName ?? '', email: session?.user.email ?? '', phone: '' });
  const [address, setAddress] = useState({ line1: '', city: '', state: '', postalCode: '' });
  const [notes, setNotes] = useState('');
  const [preferredAt, setPreferredAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  // Window-cleaning multi-window capture (AR + manual), shared with the AR screen.
  const [windowEntries, setEntries] = useState<WindowEntry[]>([]);
  // Lets a customer submit with zero captured windows, deferring the count to an
  // on-site visit (gates the otherwise-required window count).
  const [onSiteMeasure, setOnSiteMeasure] = useState(false);

  // Start every quote session with a clean window list — the entries live on a
  // global that otherwise survives across quotes.
  useEffect(() => { clearWindowEntries(); }, []);

  async function loadServices() {
    setLoadingSvc(true);
    setSvcFailed(false);
    const resolved = tenantSlug
      ?? session?.tenant?.slug
      ?? (await SecureStore.getItemAsync('browsing_slug'));
    setSlug(resolved ?? null);
    if (!resolved) { setLoadingSvc(false); setSvcFailed(true); return; }
    try {
      const cfg = await apiCall<{ services: Service[] }>('GET', `/api/config/${resolved}`);
      const visible = (cfg.services ?? []).filter((s: any) => s.active && s.visibleOnPublicSite);
      setServices(visible);
      if (initialServiceSlug) {
        const match = visible.find(s => s.slug === initialServiceSlug);
        if (match) {
          setSelected(match);
          const hasQuestions = (match.questions ?? []).some(q => !q.internal)
            || (match.capabilities ?? []).some(c => c === 'ar_measurement' || c === 'window_rectangle_scan');
          setStep(hasQuestions ? 'questions' : 'contact');
        }
      }
    } catch {
      setSvcFailed(true);
    } finally {
      setLoadingSvc(false);
    }
  }

  useEffect(() => { loadServices(); }, []);

  const VIRTUAL_AR_ID = '__ar_measurement';

  const baseQuestions = (selected?.questions ?? []).filter(q => !q.internal);
  const hasMeasurementQ = baseQuestions.some(q => q.type === 'measurement');
  const arCapable = (selected?.capabilities ?? []).some(
    c => c === 'ar_measurement' || c === 'window_rectangle_scan',
  );
  const visibleQuestions: Question[] = !hasMeasurementQ && arCapable
    ? [
        ...baseQuestions,
        {
          id: VIRTUAL_AR_ID, label: 'Window measurement', type: 'measurement', required: false,
          helpText: 'Optional — tap "AR measure" to scan a typical window or pane with your camera.',
        },
      ]
    : baseQuestions;

  // ── Windows composite (window cleaning) ────────────────────────────────────
  // When a service has both a window-count number question and a measurement
  // question and is AR-capable, we collapse them into one Windows field rendered
  // lower in the list. The count question's plain number input is dropped from
  // the top; its value is derived from the captured/entered windows so pricing
  // (per_window etc.) keeps working.
  const countQ   = baseQuestions.find(q => q.type === 'number' && (q.id === 'window_count' || q.unit === 'windows'));
  const measureQ = baseQuestions.find(q => q.type === 'measurement');
  const windowsComposite = !!(arCapable && countQ && measureQ);

  function applyWindowEntries(entries: WindowEntry[]) {
    setWindowEntries(entries);
    setEntries(entries);
    if (!countQ || !measureQ) return;
    const total = totalWindowCount(entries);
    if (total > 0) setOnSiteMeasure(false);   // a real count overrides the defer-to-visit box
    setAnswers(prev => ({
      ...prev,
      [countQ.id]:   total > 0 ? total : undefined,
      [measureQ.id]: entries.length ? summarizeWindowEntries(entries) : '',
    }));
  }

  useFocusEffect(useCallback(() => {
    // Legacy single-measurement result (non-window services).
    const result = (global as any).__arMeasureResult;
    if (result) {
      (global as any).__arMeasureResult = null;
      setAnswers(prev => ({ ...prev, [result.questionId]: result.summary }));
      setStep(s => s === 'questions' ? 'questions' : s);
    }
    // Multi-window entries returning from the AR screen's entries mode.
    if (windowsComposite) {
      applyWindowEntries(getWindowEntries());
    }
  }, [windowsComposite, countQ?.id, measureQ?.id]));

  function setAnswer(id: string, val: unknown) {
    setAnswers(prev => ({ ...prev, [id]: val }));
  }

  function validateQuestions(): boolean {
    for (const q of visibleQuestions) {
      // Windows composite: the count is satisfied either by captured/entered
      // windows or by opting into an on-site measurement.
      if (windowsComposite && countQ && q.id === countQ.id) {
        if (totalWindowCount(windowEntries) === 0 && !onSiteMeasure) {
          Alert.alert('Add your windows', 'Measure or add at least one window, or check "Measure on-site" to confirm the count during the visit.');
          return false;
        }
        continue;
      }
      if (!q.required) continue;
      const v = answers[q.id];
      if (q.type === 'photo') {
        if (!Array.isArray(v) || v.length === 0) {
          Alert.alert('Required field', `"${q.label}" requires at least one photo.`);
          return false;
        }
      } else if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        Alert.alert('Required field', `"${q.label}" is required.`);
        return false;
      }
    }
    return true;
  }

  function validateContact(): boolean {
    if (!contact.fullName.trim()) { Alert.alert('Required', 'Full name is required.'); return false; }
    if (!/.+@.+\..+/.test(contact.email)) { Alert.alert('Required', 'Valid email is required.'); return false; }
    if (!contact.phone.trim()) { Alert.alert('Required', 'Phone is required.'); return false; }
    if (!address.line1.trim()) { Alert.alert('Required', 'Street address is required.'); return false; }
    if (!address.city.trim()) { Alert.alert('Required', 'City is required.'); return false; }
    if (!/^[A-Za-z]{2}$/.test(address.state)) { Alert.alert('Required', 'Use 2-letter state code.'); return false; }
    if (!address.postalCode.trim()) { Alert.alert('Required', 'ZIP code is required.'); return false; }
    return true;
  }

  /**
   * Upload all photo-type answers (arrays of PhotoEntry) to the server, replacing
   * local file:// URIs with permanent public URLs. Uses the public presign endpoint
   * for unauthenticated users so the draft can be stashed safely before sign-up.
   */
  async function uploadAllPhotos(currentAnswers: Record<string, unknown>, isAuthed: boolean): Promise<Record<string, unknown>> {
    const updated = { ...currentAnswers };
    for (const [questionId, value] of Object.entries(updated)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      // Detect photo arrays: elements have a `uri` property
      const firstItem = value[0] as any;
      if (!firstItem?.uri) continue;
      const photos = value as PhotoEntry[];
      const uploadedUrls: string[] = [];
      for (const photo of photos) {
        try {
          const url = await uploadOnePhoto(photo, isAuthed);
          if (url) uploadedUrls.push(url);
        } catch {
          // Non-fatal: if one photo fails, skip it and continue
          // The quote still submits without that photo
        }
      }
      updated[questionId] = uploadedUrls;
    }
    return updated;
  }

  async function uploadOnePhoto(photo: PhotoEntry, isAuthed: boolean): Promise<string | null> {
    const mimeType = photo.mimeType || 'image/jpeg';
    const byteSize = photo.fileSize ?? 0;
    const filename = photo.fileName || `photo_${Date.now()}.jpg`;

    const presignEndpoint = isAuthed ? '/api/uploads/presign' : '/api/public/uploads/presign';
    const presign = await apiCall<PresignResponse>('POST', presignEndpoint, {
      filename,
      mimeType,
      byteSize,
    });

    if (presign.method === 'PUT') {
      // Direct S3 presigned PUT — fetch the local URI as a blob and PUT it
      const fileResponse = await fetch(photo.uri);
      const blob = await fileResponse.blob();
      await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: blob,
      });
    } else {
      // Local dev fallback — POST as multipart FormData
      const formData = new FormData();
      formData.append('file', {
        uri: photo.uri,
        type: mimeType,
        name: filename,
      } as any);
      await fetch(presign.uploadUrl, {
        method: 'POST',
        body: formData,
      });
    }

    return presign.publicUrl;
  }

  function buildDraft(resolvedAnswers: Record<string, unknown>): QuoteDraft {
    const { [VIRTUAL_AR_ID]: virtualMeasurement, ...realAnswers } = resolvedAnswers;
    const noteParts = [
      notes || null,
      virtualMeasurement ? `Window measurement (AR): ${String(virtualMeasurement)}` : null,
      windowsComposite && onSiteMeasure && totalWindowCount(windowEntries) === 0
        ? 'Customer requests on-site measurement — window count to be confirmed during the visit.'
        : null,
    ].filter(Boolean);

    return {
      serviceId:    selected!.id,
      propertyKind: selected!.category === 'COMMERCIAL' ? 'COMMERCIAL' : 'RESIDENTIAL',
      address: { line1: address.line1, city: address.city, state: address.state.toUpperCase(), postalCode: address.postalCode, country: 'US' },
      answers: realAnswers,
      customerNotes: noteParts.length ? noteParts.join('\n') : undefined,
      preferredAt: preferredAt.trim() || undefined,
    };
  }

  async function submit() {
    if (!selected || !validateContact()) return;

    setSubmitting(true);
    setUploadingPhotos(true);

    let resolvedAnswers = answers;
    try {
      resolvedAnswers = await uploadAllPhotos(answers, !!session);
    } catch {
      // Upload failure is non-fatal — the quote still goes through
    } finally {
      setUploadingPhotos(false);
    }

    // Gate 1: signed-out user — stash draft (photos already uploaded to public endpoint)
    // and route to sign-up. submitPendingQuote() fires after auth.
    if (!session) {
      setPendingQuote(buildDraft(resolvedAnswers));
      setSubmitting(false);
      router.push({
        pathname: '/(auth)/sign-up' as any,
        params: { fullName: contact.fullName, email: contact.email, phone: contact.phone, slug: slug ?? '' },
      });
      return;
    }

    // Gate 2: signed in to a different business
    if (slug && session.tenant?.slug && slug !== session.tenant.slug) {
      const draft = buildDraft(resolvedAnswers);
      setSubmitting(false);
      Alert.alert(
        `You're signed in with ${session.tenant.name}`,
        'To request a quote from this business you need an account with them. Continue to set that up — your quote details are saved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue', onPress: () => {
              setPendingQuote(draft);
              router.push({
                pathname: '/(auth)/sign-up' as any,
                params: { fullName: contact.fullName, email: contact.email, phone: contact.phone, slug },
              });
            },
          },
        ],
      );
      return;
    }

    try {
      // Create then submit — POST /api/quotes only drafts the request; it's the
      // /submit call that fires notifyOnCreate and alerts the business. Web does
      // both in submitAuthed(); skipping the second call leaves quotes sitting
      // unseen in the console.
      const created = await apiCall<{ id: string }>('POST', '/api/quotes', buildDraft(resolvedAnswers));
      await apiCall('POST', `/api/quotes/${created.id}/submit`, {});
      clearWindowEntries();
      setEntries([]);
      setOnSiteMeasure(false);
      setStep('done');
    } catch (e) {
      Alert.alert('Error', e instanceof ApiError ? e.message : 'Submission failed. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <SafeAreaView style={[s.doneRoot, { backgroundColor: t.surface[50] }]}>
        <View style={[s.doneIcon, { backgroundColor: t.brand.brand500 }]}><Text style={[s.doneIconText, { color: t.brand.onBrand }]}>✓</Text></View>
        <Text style={[s.doneHeading, { color: t.ink[900] }]}>Request submitted!</Text>
        <Text style={[s.doneSub, { color: t.ink[500] }]}>We'll be in touch shortly to confirm your appointment.</Text>
        <View style={{ alignSelf: 'stretch', paddingHorizontal: 12, marginTop: 8 }}>
          <Button title="Submit another" onPress={() => { setStep('service'); setSelected(null); setAnswers({}); setNotes(''); clearWindowEntries(); setEntries([]); setOnSiteMeasure(false); }} />
        </View>
        <TouchableOpacity style={s.linkBtn} onPress={() => router.replace('/(customer)/quotes')}>
          <Text style={[s.linkBtnText, { color: t.brand.brand600 }]}>View my quotes →</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const stepOrder: Step[] = ['service', 'questions', 'contact'];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {onBack && step === 'service' && (
          <TouchableOpacity style={s.topBack} onPress={onBack}>
            <Ionicons name="arrow-back" size={20} color={t.ink[700]} />
            <Text style={[s.topBackText, { color: t.ink[700] }]}>Back</Text>
          </TouchableOpacity>
        )}

        <View style={s.progress}>
          {stepOrder.map((st, i) => {
            const active = step === st;
            const done = stepOrder.includes(step) && i < stepOrder.indexOf(step);
            return <View key={st} style={[s.progressDot, { backgroundColor: active ? t.brand.brand500 : done ? t.brand.brand200 : t.surface[200] }]} />;
          })}
        </View>

        {/* STEP 1: Pick service */}
        {step === 'service' && (
          <>
            <Text style={[s.heading, { color: t.ink[900] }]}>Request a quote</Text>
            <Text style={[s.stepLabel, { color: t.ink[500] }]}>Choose a service</Text>
            {loadingSvc
              ? <ActivityIndicator color={t.brand.brand500} style={{ marginTop: 20 }} />
              : svcFailed ? (
                  <View style={s.svcEmpty}>
                    <Text style={[s.svcEmptyText, { color: t.ink[700] }]}>Couldn't load services</Text>
                    <Text style={[s.svcEmptySub, { color: t.ink[500] }]}>Check your connection and try again.</Text>
                    <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
                      <Button title="Retry" variant="secondary" onPress={loadServices} />
                    </View>
                  </View>
                )
              : services.length === 0 ? (
                  <View style={s.svcEmpty}>
                    <Text style={[s.svcEmptyText, { color: t.ink[700] }]}>No services available</Text>
                    <Text style={[s.svcEmptySub, { color: t.ink[500] }]}>This business hasn't published any services yet. Try calling them directly.</Text>
                  </View>
                )
              : services.map(svc => {
                  const isSel = selected?.id === svc.id;
                  return (
                    <TouchableOpacity
                      key={svc.id}
                      style={[s.svcCard, { backgroundColor: isSel ? t.brand.brand50 : t.surface[0], borderColor: isSel ? t.brand.brand500 : t.surface[200], borderRadius: t.radius }]}
                      onPress={() => { setSelected(svc); clearWindowEntries(); setEntries([]); setOnSiteMeasure(false); }}
                    >
                      <Text style={[s.svcName, { color: isSel && t.isDark ? '#000000' : t.ink[900] }]}>{svc.name}</Text>
                      <Text style={[s.svcDesc, { color: isSel && t.isDark ? '#000000' : t.ink[500] }]}>{svc.description}</Text>
                    </TouchableOpacity>
                  );
                })
            }
            {selected && (
              <View style={{ marginTop: 8 }}>
                <Button title="Continue →" onPress={() => setStep(visibleQuestions.length > 0 ? 'questions' : 'contact')} />
              </View>
            )}
          </>
        )}

        {/* STEP 2: Service questions */}
        {step === 'questions' && selected && (
          <>
            <Text style={[s.heading, { color: t.ink[900] }]}>{selected.name}</Text>
            <Text style={[s.stepLabel, { color: t.ink[500] }]}>Tell us about the job</Text>
            {/* Window cleaning: the window-count + measurement questions are
                folded into one Windows field, shown FIRST (with the count
                question's label) regardless of their order in the list. */}
            {windowsComposite && countQ && measureQ && (
              <WindowsField
                t={t} label={countQ.label} entries={windowEntries}
                onChange={applyWindowEntries}
                onSiteMeasure={onSiteMeasure}
                onToggleOnSite={() => {
                  // Un-checking just clears it; enabling prompts to nudge
                  // toward photos/video (faster scheduling).
                  if (onSiteMeasure) { setOnSiteMeasure(false); return; }
                  Alert.alert(
                    'Are you sure?',
                    'Including photos or a video of your windows helps us get you scheduled quicker.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Measure on-site', onPress: () => setOnSiteMeasure(true) },
                    ],
                  );
                }}
                onARMeasure={() => router.push(`/(platform)/ar-measure?mode=entries&questionId=${measureQ.id}` as any)}
              />
            )}
            {visibleQuestions.map(q => {
              // Folded into the Windows field above.
              if (windowsComposite && countQ && q.id === countQ.id) return null;
              if (windowsComposite && measureQ && q.id === measureQ.id) return null;
              return (
                <QuestionField
                  key={q.id} q={q} value={answers[q.id]} t={t}
                  onChange={v => setAnswer(q.id, v)}
                  onARMeasure={() => router.push(`/(platform)/ar-measure?questionId=${q.id}` as any)}
                />
              );
            })}
            <View style={s.navRow}>
              <TouchableOpacity style={[s.backBtn, { borderColor: t.surface[200], borderRadius: t.radius }]} onPress={() => setStep('service')}>
                <Text style={[s.backBtnText, { color: t.ink[700] }]}>← Back</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Button title="Continue →" onPress={() => { if (validateQuestions()) setStep('contact'); }} />
              </View>
            </View>
          </>
        )}

        {/* STEP 3: Contact & address */}
        {step === 'contact' && (
          <>
            <Text style={[s.heading, { color: t.ink[900] }]}>Contact & address</Text>
            <Text style={[s.stepLabel, { color: t.ink[500] }]}>Where & how to reach you</Text>

            <Field t={t} label="Full name *" value={contact.fullName} onChange={v => setContact(c => ({ ...c, fullName: v }))} />
            <Field t={t} label="Email *" value={contact.email} onChange={v => setContact(c => ({ ...c, email: v }))} keyboard="email-address" />
            <Field t={t} label="Phone *" value={contact.phone} onChange={v => setContact(c => ({ ...c, phone: v }))} keyboard="phone-pad" />
            <Field t={t} label="Street *" value={address.line1} onChange={v => setAddress(a => ({ ...a, line1: v }))} />
            <View style={s.row}>
              <View style={{ flex: 2, marginRight: 8 }}><Field t={t} label="City *" value={address.city} onChange={v => setAddress(a => ({ ...a, city: v }))} /></View>
              <View style={{ flex: 1, marginRight: 8 }}><Field t={t} label="State *" value={address.state} onChange={v => setAddress(a => ({ ...a, state: v.toUpperCase() }))} maxLen={2} /></View>
              <View style={{ flex: 1 }}><Field t={t} label="ZIP *" value={address.postalCode} onChange={v => setAddress(a => ({ ...a, postalCode: v }))} keyboard="number-pad" /></View>
            </View>
            <Field t={t} label="Preferred time (optional)" value={preferredAt} onChange={setPreferredAt} placeholder="e.g. Weekday mornings, or after 3pm Fri" />
            <Field t={t} label="Notes (optional)" value={notes} onChange={setNotes} multiline />

            {/* Upload indicator shown while photos are transferring */}
            {uploadingPhotos && (
              <View style={[s.uploadingRow, { backgroundColor: t.brand.brand50, borderColor: t.brand.brand200 }]}>
                <ActivityIndicator size="small" color={t.brand.brand500} />
                <Text style={[s.uploadingText, { color: t.brand.brand700 }]}>Uploading photos…</Text>
              </View>
            )}

            <View style={s.navRow}>
              <TouchableOpacity style={[s.backBtn, { borderColor: t.surface[200], borderRadius: t.radius }]} onPress={() => setStep(visibleQuestions.length > 0 ? 'questions' : 'service')}>
                <Text style={[s.backBtnText, { color: t.ink[700] }]}>← Back</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Button title={session ? 'Submit request' : 'Continue to submit'} onPress={submit} loading={submitting} />
              </View>
            </View>
            {!session && (
              <Text style={[s.gateNote, { color: t.ink[500] }]}>
                You'll create a quick account to send your request and track its status.
              </Text>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Question renderer ──────────────────────────────────────────────────────

function isARQuestion(q: Question) {
  return q.type === 'measurement';
}

function QuestionField({ q, value, onChange, onARMeasure, t }: {
  q: Question; value: unknown; t: Theme;
  onChange: (v: unknown) => void;
  onARMeasure?: () => void;
}) {
  const val = value as any;
  const showAR = onARMeasure && isARQuestion(q);
  const input = [qf.input, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900] }];

  return (
    <View style={qf.wrap}>
      <View style={qf.labelRow}>
        <Text style={[qf.label, { color: t.ink[900] }]}>{q.label}{q.required ? ' *' : ''}{q.unit ? ` (${q.unit})` : ''}</Text>
        {showAR && (
          <TouchableOpacity style={[qf.arBtn, { backgroundColor: t.brand.brand50 }]} onPress={onARMeasure}>
            <Ionicons name="scan-outline" size={14} color={t.brand.brand600} />
            <Text style={[qf.arBtnText, { color: t.brand.brand600 }]}>AR measure</Text>
          </TouchableOpacity>
        )}
      </View>
      {q.helpText && <Text style={[qf.help, { color: t.ink[500] }]}>{q.helpText}</Text>}

      {(q.type === 'text' || q.type === 'address') && (
        <TextInput style={input} value={val ?? ''} onChangeText={onChange} placeholder={q.placeholder} placeholderTextColor={t.ink[300]} />
      )}
      {q.type === 'longtext' && (
        <TextInput style={[input, { height: 80, textAlignVertical: 'top' }]} value={val ?? ''} onChangeText={onChange} multiline placeholder={q.placeholder} placeholderTextColor={t.ink[300]} />
      )}
      {(q.type === 'number' || q.type === 'currency' || q.type === 'rating') && (
        <TextInput style={input} value={val !== undefined ? String(val) : ''} onChangeText={v => onChange(v === '' ? undefined : Number(v))} keyboardType="decimal-pad" placeholder={q.placeholder ?? '0'} placeholderTextColor={t.ink[300]} />
      )}
      {q.type === 'measurement' && (
        <TextInput
          style={input}
          value={typeof val === 'string' ? val : val !== undefined ? String(val) : ''}
          onChangeText={onChange}
          placeholder={q.placeholder ?? 'e.g. 36" W × 48" H'}
          placeholderTextColor={t.ink[300]}
        />
      )}
      {q.type === 'boolean' && (
        <View style={qf.boolRow}>
          {['Yes', 'No'].map(opt => {
            const on = val === (opt === 'Yes');
            return (
              <TouchableOpacity key={opt} style={[qf.boolBtn, { backgroundColor: on ? t.brand.brand50 : t.surface[0], borderColor: on ? t.brand.brand500 : t.surface[200], borderRadius: t.radius }]} onPress={() => onChange(on ? undefined : opt === 'Yes')}>
                <Text style={[qf.boolText, { color: on ? (t.isDark ? '#000000' : t.brand.brand600) : t.ink[700] }]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {q.type === 'select' && (
        <View style={qf.optGrid}>
          {(q.options ?? []).map(o => {
            const on = val === o.value;
            return (
              <TouchableOpacity key={o.value} style={[qf.optBtn, { backgroundColor: on ? t.brand.brand50 : t.surface[0], borderColor: on ? t.brand.brand500 : t.surface[200], borderRadius: t.radius }]} onPress={() => onChange(on ? undefined : o.value)}>
                <Text style={[qf.optText, { color: on ? (t.isDark ? '#000000' : t.brand.brand600) : t.ink[700], fontWeight: on ? '700' : '500' }]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {q.type === 'multiselect' && (
        <View style={qf.optGrid}>
          {(q.options ?? []).map(o => {
            const on = Array.isArray(val) && val.includes(o.value);
            return (
              <TouchableOpacity key={o.value} style={[qf.optBtn, { backgroundColor: on ? t.brand.brand50 : t.surface[0], borderColor: on ? t.brand.brand500 : t.surface[200], borderRadius: t.radius }]} onPress={() => {
                const list: string[] = Array.isArray(val) ? [...val] : [];
                onChange(on ? list.filter(x => x !== o.value) : [...list, o.value]);
              }}>
                <Text style={[qf.optText, { color: on ? (t.isDark ? '#000000' : t.brand.brand600) : t.ink[700], fontWeight: on ? '700' : '500' }]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {q.type === 'date' && (
        <TextInput style={input} value={val ?? ''} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={t.ink[300]} />
      )}
      {q.type === 'photo' && (
        <PhotoUploadField
          maxFiles={q.maxFiles ?? 5}
          photos={(val as PhotoEntry[] | undefined) ?? []}
          onChange={onChange}
          t={t}
        />
      )}
    </View>
  );
}

// ── Windows field (window cleaning: AR + manual capture) ────────────────────

function WindowsField({ t, label, entries, onChange, onSiteMeasure, onToggleOnSite, onARMeasure }: {
  t: Theme; label: string; entries: WindowEntry[];
  onChange: (entries: WindowEntry[]) => void;
  onSiteMeasure: boolean;
  onToggleOnSite: () => void;
  onARMeasure: () => void;
}) {
  const [showManual, setShowManual] = useState(false);
  const [mw, setMw] = useState('');
  const [mh, setMh] = useState('');
  const [mc, setMc] = useState('1');

  const total = totalWindowCount(entries);
  const canAdd = !!parseFloat(mw) && !!parseFloat(mh);

  function removeEntry(id: string) {
    onChange(entries.filter(e => e.id !== id));
  }
  function bumpCount(id: string, delta: number) {
    onChange(entries.map(e => (e.id === id ? { ...e, count: Math.max(1, e.count + delta) } : e)));
  }
  function addManual() {
    if (!canAdd) return;
    onChange([...entries, makeManualEntry(parseFloat(mw), parseFloat(mh), parseInt(mc) || 1)]);
    setMw(''); setMh(''); setMc('1'); setShowManual(false);
  }

  const manualInput = (val: string, set: (v: string) => void, ph: string, kb: any, onText?: (v: string) => void) => (
    <TextInput
      style={[wf.manualInput, { borderColor: t.surface[200], color: t.ink[900], backgroundColor: t.surface[0] }]}
      value={val} onChangeText={onText ?? set} keyboardType={kb}
      placeholder={ph} placeholderTextColor={t.ink[300]} selectTextOnFocus
    />
  );

  return (
    <View style={qf.wrap}>
      <Text style={[qf.label, { color: t.ink[900] }]}>{label}</Text>
      <Text style={[qf.help, { color: t.ink[500] }]}>
        Point your camera at each window to capture its size, or add sizes by hand. We total them up for your quote.
      </Text>

      {/* Primary: AR capture */}
      <TouchableOpacity style={[wf.arBtn, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={onARMeasure}>
        <Ionicons name="scan-outline" size={18} color={t.brand.onBrand} />
        <Text style={[wf.arBtnText, { color: t.brand.onBrand }]}>
          {entries.length ? 'Measure more windows' : 'Measure with camera'}
        </Text>
      </TouchableOpacity>

      {/* Captured / entered windows */}
      {entries.length > 0 && (
        <View style={[wf.list, { borderColor: t.surface[200], borderRadius: t.radius }]}>
          {entries.map((e, i) => (
            <View key={e.id} style={[wf.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.surface[100] }]}>
              <View style={[wf.tag, { backgroundColor: e.method === 'ar' ? t.brand.brand50 : t.surface[100] }]}>
                <Ionicons name={e.method === 'ar' ? 'scan' : 'create-outline'} size={12} color={e.method === 'ar' ? t.brand.brand600 : t.ink[500]} />
              </View>
              <Text style={[wf.rowDim, { color: t.ink[900] }]} numberOfLines={1}>
                {e.widthDisplay} × {e.heightDisplay}
                {e.shapeType === 'custom' ? ' (custom)' : ''}
                {e.paneCount > 1 ? ` · ${e.paneCount} panes` : ''}
              </Text>
              <View style={wf.stepper}>
                <TouchableOpacity style={[wf.stepBtn, { borderColor: t.surface[200] }]} onPress={() => bumpCount(e.id, -1)}>
                  <Text style={[wf.stepBtnText, { color: t.ink[700] }]}>−</Text>
                </TouchableOpacity>
                <Text style={[wf.count, { color: t.ink[900] }]}>{e.count}</Text>
                <TouchableOpacity style={[wf.stepBtn, { borderColor: t.surface[200] }]} onPress={() => bumpCount(e.id, 1)}>
                  <Text style={[wf.stepBtnText, { color: t.ink[700] }]}>+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => removeEntry(e.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={20} color={t.ink[300]} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={[wf.totalRow, { borderTopColor: t.surface[200] }]}>
            <Text style={[wf.totalLabel, { color: t.ink[500] }]}>Total</Text>
            <Text style={[wf.totalValue, { color: t.ink[900] }]}>
              {total} window{total !== 1 ? 's' : ''} · {entries.length} size{entries.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      )}

      {/* Manual add */}
      {!showManual ? (
        <TouchableOpacity style={wf.manualToggle} onPress={() => setShowManual(true)}>
          <Ionicons name="add" size={16} color={t.brand.brand600} />
          <Text style={[wf.manualToggleText, { color: t.brand.brand600 }]}>Add a size manually</Text>
        </TouchableOpacity>
      ) : (
        <View style={[wf.manualForm, { borderColor: t.surface[200], borderRadius: t.radius }]}>
          <View style={wf.manualRow}>
            <View style={{ flex: 1 }}>
              <Text style={[wf.manualLabel, { color: t.ink[700] }]}>Width (in)</Text>
              {manualInput(mw, setMw, '36', 'decimal-pad')}
            </View>
            <Text style={[wf.manualX, { color: t.ink[300] }]}>×</Text>
            <View style={{ flex: 1 }}>
              <Text style={[wf.manualLabel, { color: t.ink[700] }]}>Height (in)</Text>
              {manualInput(mh, setMh, '48', 'decimal-pad')}
            </View>
            <View style={{ width: 56 }}>
              <Text style={[wf.manualLabel, { color: t.ink[700] }]}>Qty</Text>
              {manualInput(mc, setMc, '1', 'number-pad', v => setMc(v.replace(/[^0-9]/g, '')))}
            </View>
          </View>
          <View style={wf.manualActions}>
            <TouchableOpacity style={wf.manualCancel} onPress={() => { setShowManual(false); setMw(''); setMh(''); setMc('1'); }}>
              <Text style={[wf.manualCancelText, { color: t.ink[500] }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[wf.manualAdd, { backgroundColor: t.brand.brand500, borderRadius: t.radius }, !canAdd && { opacity: 0.5 }]}
              disabled={!canAdd} onPress={addManual}
            >
              <Text style={[wf.manualAddText, { color: t.brand.onBrand }]}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Don't know the windows yet? Defer the count to an on-site visit. */}
      {entries.length === 0 && (
        <TouchableOpacity
          style={[wf.onSite, { borderColor: onSiteMeasure ? t.brand.brand500 : t.surface[200], backgroundColor: onSiteMeasure ? t.brand.brand50 : t.surface[0], borderRadius: t.radius }]}
          onPress={onToggleOnSite}
          activeOpacity={0.7}
        >
          <View style={[wf.checkbox, { borderColor: onSiteMeasure ? t.brand.brand500 : t.surface[200], backgroundColor: onSiteMeasure ? t.brand.brand500 : 'transparent' }]}>
            {onSiteMeasure && <Ionicons name="checkmark" size={14} color={t.brand.onBrand} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[wf.onSiteTitle, { color: onSiteMeasure && t.isDark ? '#000000' : t.ink[900] }]}>Measure on-site</Text>
            <Text style={[wf.onSiteSub, { color: onSiteMeasure && t.isDark ? '#000000' : t.ink[500] }]}>Skip measuring now — we'll confirm the window count during the visit.</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Photo upload field ─────────────────────────────────────────────────────

function PhotoUploadField({ maxFiles, photos, onChange, t }: {
  maxFiles: number;
  photos: PhotoEntry[];
  onChange: (v: PhotoEntry[]) => void;
  t: Theme;
}) {
  const canAdd = photos.length < maxFiles;

  async function requestCameraPermission(ip: ImagePickerModule): Promise<boolean> {
    const { status } = await ip.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera permission needed',
        'Allow camera access so you can photograph the job site for your quote.',
        [{ text: 'OK' }],
      );
      return false;
    }
    return true;
  }

  async function requestLibraryPermission(ip: ImagePickerModule): Promise<boolean> {
    const { status } = await ip.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo library permission needed',
        'Allow photo library access to attach existing photos to your quote.',
        [{ text: 'OK' }],
      );
      return false;
    }
    return true;
  }

  async function takePhoto() {
    if (!canAdd) return;
    const ip = getImagePicker();
    if (!ip) {
      Alert.alert('Photo upload unavailable', 'Please rebuild the app to enable photo uploads.');
      return;
    }
    if (!(await requestCameraPermission(ip))) return;

    const result = await ip.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets.length > 0) {
      const [asset] = result.assets;
      if (!asset) return;
      const newPhoto: PhotoEntry = {
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileSize: asset.fileSize,
        fileName: asset.fileName ?? `photo_${Date.now()}.jpg`,
      };
      onChange([...photos, newPhoto].slice(0, maxFiles));
    }
  }

  async function pickFromLibrary() {
    if (!canAdd) return;
    const ip = getImagePicker();
    if (!ip) {
      Alert.alert('Photo upload unavailable', 'Please rebuild the app to enable photo uploads.');
      return;
    }
    if (!(await requestLibraryPermission(ip))) return;

    const remaining = maxFiles - photos.length;
    const result = await ip.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });

    if (!result.canceled && result.assets.length > 0) {
      const newPhotos: PhotoEntry[] = result.assets.map((asset: import('expo-image-picker').ImagePickerAsset, i: number) => ({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileSize: asset.fileSize,
        fileName: asset.fileName ?? `photo_${Date.now()}_${i}.jpg`,
      }));
      onChange([...photos, ...newPhotos].slice(0, maxFiles));
    }
  }

  function removePhoto(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  return (
    <View style={ph.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={ph.strip}
      >
        {/* Existing photo thumbnails */}
        {photos.map((photo, i) => (
          <View key={`${photo.uri}-${i}`} style={ph.thumbWrap}>
            <Image source={{ uri: photo.uri }} style={ph.thumb} resizeMode="cover" />
            <TouchableOpacity
              style={ph.removeBtn}
              onPress={() => removePhoto(i)}
              hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
            >
              <Text style={ph.removeBtnText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add buttons — only shown when under the limit */}
        {canAdd && (
          <>
            <TouchableOpacity
              style={[ph.addBtn, { backgroundColor: t.surface[100], borderColor: t.surface[200], borderRadius: t.radius }]}
              onPress={takePhoto}
              activeOpacity={0.7}
            >
              <Ionicons name="camera" size={22} color={t.ink[500]} />
              <Text style={[ph.addBtnLabel, { color: t.ink[500] }]}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ph.addBtn, { backgroundColor: t.surface[100], borderColor: t.surface[200], borderRadius: t.radius }]}
              onPress={pickFromLibrary}
              activeOpacity={0.7}
            >
              <Ionicons name="images-outline" size={22} color={t.ink[500]} />
              <Text style={[ph.addBtnLabel, { color: t.ink[500] }]}>Library</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Text style={[ph.counter, { color: t.ink[300] }]}>
        {photos.length} / {maxFiles} photo{maxFiles !== 1 ? 's' : ''}
        {photos.length >= maxFiles ? ' (limit reached)' : ''}
      </Text>
    </View>
  );
}

function Field({ t, label, value, onChange, keyboard, multiline, maxLen, placeholder }: {
  t: Theme; label: string; value: string; onChange: (v: string) => void;
  keyboard?: any; multiline?: boolean; maxLen?: number; placeholder?: string;
}) {
  return (
    <View style={s.fieldWrap}>
      <Text style={[s.fieldLabel, { color: t.ink[700] }]}>{label}</Text>
      <TextInput
        style={[s.input, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius, color: t.ink[900] }, multiline && { height: 70, textAlignVertical: 'top' }]}
        value={value} onChangeText={onChange}
        keyboardType={keyboard} multiline={multiline} maxLength={maxLen}
        autoCapitalize={keyboard === 'email-address' ? 'none' : 'sentences'}
        placeholder={placeholder} placeholderTextColor={t.ink[300]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  topBack: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  topBackText: { fontSize: 15, fontWeight: '600' },
  progress: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  stepLabel: { fontSize: 13, marginBottom: 16 },
  svcCard: { padding: 14, marginBottom: 10, borderWidth: 1.5 },
  svcName: { fontSize: 15, fontWeight: '600' },
  svcDesc: { fontSize: 12, marginTop: 3 },
  svcEmpty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 16, gap: 4 },
  svcEmptyText: { fontSize: 16, fontWeight: '600' },
  svcEmptySub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 5 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  row: { flexDirection: 'row' },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'stretch' },
  backBtn: { paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, justifyContent: 'center' },
  backBtnText: { fontSize: 14, fontWeight: '600' },
  gateNote: { fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 17, paddingHorizontal: 8 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  uploadingText: { fontSize: 13, fontWeight: '600' },
  linkBtn: { marginTop: 16, alignItems: 'center' },
  linkBtnText: { fontSize: 15, fontWeight: '600' },
  doneRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  doneIconText: { fontSize: 32, fontWeight: '700' },
  doneHeading: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  doneSub: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
});

const qf = StyleSheet.create({
  wrap: { marginBottom: 16 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  arBtnText: { fontSize: 12, fontWeight: '600' },
  help: { fontSize: 12, marginBottom: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  boolRow: { flexDirection: 'row', gap: 10 },
  boolBtn: { flex: 1, paddingVertical: 12, borderWidth: 1.5, alignItems: 'center' },
  boolText: { fontSize: 14, fontWeight: '600' },
  optGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optBtn: { paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5 },
  optText: { fontSize: 14 },
});

const wf = StyleSheet.create({
  arBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, marginTop: 4 },
  arBtnText: { fontSize: 15, fontWeight: '700' },

  list: { borderWidth: 1, marginTop: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9 },
  tag: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  rowDim: { flex: 1, fontSize: 14, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 16, fontWeight: '700', lineHeight: 18 },
  count: { fontSize: 14, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  totalLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  totalValue: { fontSize: 14, fontWeight: '700' },

  manualToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingVertical: 4 },
  manualToggleText: { fontSize: 14, fontWeight: '600' },
  manualForm: { borderWidth: 1, marginTop: 10, padding: 12, gap: 12 },
  manualRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  manualLabel: { fontSize: 12, fontWeight: '600', marginBottom: 5 },
  manualInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  manualX: { fontSize: 16, fontWeight: '700', paddingBottom: 10 },
  manualActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10 },
  manualCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  manualCancelText: { fontSize: 14, fontWeight: '600' },
  manualAdd: { paddingHorizontal: 22, paddingVertical: 10 },
  manualAddText: { fontSize: 14, fontWeight: '700' },

  onSite: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, padding: 12, marginTop: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  onSiteTitle: { fontSize: 14, fontWeight: '700' },
  onSiteSub: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});

const ph = StyleSheet.create({
  container: { gap: 6 },
  strip: { flexDirection: 'row', gap: 10, paddingVertical: 4, paddingHorizontal: 2 },
  thumbWrap: { position: 'relative', width: 84, height: 84 },
  thumb: { width: 84, height: 84, borderRadius: 8 },
  removeBtn: {
    position: 'absolute', top: -7, right: -7,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#ef4444',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  removeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 20, marginTop: -1 },
  addBtn: {
    width: 84, height: 84,
    borderWidth: 1.5, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    gap: 4,
  },
  addBtnLabel: { fontSize: 11, fontWeight: '600' },
  counter: { fontSize: 11, paddingLeft: 2 },
});
