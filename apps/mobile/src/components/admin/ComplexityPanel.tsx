/**
 * ComplexityPanel — native mirror of
 * apps/web/src/app/admin/quotes/[id]/ComplexityPanel.tsx.
 *
 * Owner-only: classify a received quote as a short job or a complex (multi-day)
 * job. SIMPLE jobs use the normal self-book / short-window scheduling; COMPLEX
 * jobs carry a customer-facing note explaining the multi-day plan.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { apiCall, ApiError } from '@/lib/api';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { Button, Input } from '@/components/ui';

type Complexity = 'SIMPLE' | 'COMPLEX' | null;

// Professional default the owner can edit. Shown to the customer on COMPLEX jobs.
// Keep in sync with the same constant on web.
const DEFAULT_COMPLEX_NOTE =
  'This is a larger, multi-day project. Because of its scope, our team will review the ' +
  'details and coordinate the schedule with you across more than one visit. We’ll propose ' +
  'a few time windows for you to choose from once the estimate is accepted.';

interface Props {
  quoteId: string;
  initialComplexity: Complexity;
  initialNote: string | null;
  canEdit: boolean;
  onSaved: () => void;
}

export function ComplexityPanel({ quoteId, initialComplexity, initialNote, canEdit, onSaved }: Props) {
  const t = useTheme();
  const [complexity, setComplexity] = useState<Complexity>(initialComplexity);
  const [note, setNote] = useState(initialNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: Complexity) {
    if (!canEdit) return;
    setBusy(true); setError(null); setSaved(false);
    // COMPLEX keeps/sets the customer note (default if blank); SIMPLE clears it.
    const outNote = next === 'COMPLEX' ? (note.trim() || DEFAULT_COMPLEX_NOTE) : null;
    try {
      await apiCall('PATCH', `/api/admin/quotes/${quoteId}`, { jobComplexity: next, complexityNote: outNote });
      setComplexity(next);
      setNote(outNote ?? '');
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.');
    } finally { setBusy(false); }
  }

  async function saveNote() {
    if (!canEdit) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await apiCall('PATCH', `/api/admin/quotes/${quoteId}`, { complexityNote: note.trim() || DEFAULT_COMPLEX_NOTE });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the note.');
    } finally { setBusy(false); }
  }

  return (
    <View style={[s.card, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }, t.shadowSoft]}>
      <Text style={[s.title, { color: t.ink[900] }]}>Job complexity</Text>
      <Text style={[s.help, { color: t.ink[500] }]}>
        Review the request and classify it. Short jobs schedule normally; complex jobs add a
        multi-day note for the customer.
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Pill
          t={t} on={complexity === 'SIMPLE'} disabled={!canEdit || busy}
          label="Short job" sub="Self-book / short windows"
          onPress={() => save('SIMPLE')}
        />
        <Pill
          t={t} on={complexity === 'COMPLEX'} disabled={!canEdit || busy}
          label="Complex job" sub="Multi-day, coordinated plan"
          onPress={() => save('COMPLEX')}
        />
      </View>

      {complexity === 'COMPLEX' && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Input
            label="Note to customer"
            value={note}
            onChangeText={setNote}
            editable={canEdit && !busy}
            placeholder={DEFAULT_COMPLEX_NOTE}
            multiline
            style={{ height: 110, textAlignVertical: 'top' }}
          />
          <Text style={[s.help, { color: t.ink[500] }]}>
            Shown to the customer on their quote. Explain why it spans more than a day and what to expect.
          </Text>
          {canEdit && (
            <Button title={busy ? 'Saving…' : 'Save note'} variant="secondary" fullWidth={false} onPress={saveNote} disabled={busy} />
          )}
        </View>
      )}

      {error && <Text style={s.error}>{error}</Text>}
      {saved && !error && <Text style={s.saved}>Saved.</Text>}
    </View>
  );
}

function Pill({
  t, on, disabled, label, sub, onPress,
}: { t: Theme; on: boolean; disabled?: boolean; label: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.7}
      style={[s.pill, {
        borderRadius: t.radius,
        borderColor: on ? t.brand.brand500 : t.surface[200],
        backgroundColor: on ? t.brand.brand50 : t.surface[0],
        opacity: disabled ? 0.6 : 1,
      }]}
    >
      <Text style={[s.pillLabel, { color: on ? t.brand.brand700 : t.ink[900] }]}>{on ? '✓ ' : ''}{label}</Text>
      <Text style={[s.pillSub, { color: t.ink[500] }]}>{sub}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, gap: 6, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700' },
  help: { fontSize: 12, lineHeight: 17 },
  pill: { flex: 1, borderWidth: 1, padding: 12, gap: 2 },
  pillLabel: { fontSize: 13, fontWeight: '700' },
  pillSub: { fontSize: 11 },
  error: { fontSize: 13, color: '#dc2626', marginTop: 8 },
  saved: { fontSize: 12, color: '#059669', marginTop: 8 },
});
