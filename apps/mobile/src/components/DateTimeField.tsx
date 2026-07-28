/**
 * DateTimeField — the native stand-in for web's `<input type="datetime-local">`
 * (used by the admin estimate + scheduling panels).
 *
 * Deliberately dependency-free: pulling in @react-native-community/datetimepicker
 * would add a native module and force a dev-client rebuild. Instead this is a
 * touch-first sheet — a horizontal day strip plus a scrollable time list — which
 * is faster than a wheel picker for "pick a work slot" and needs no rebuild.
 *
 * Like web's datetime-local, the produced Date is in DEVICE-LOCAL time; callers
 * send `.toISOString()`, so the wire value matches web exactly.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Label } from '@/components/ui';

/** How far ahead the owner can schedule from the sheet. */
const DAYS_AHEAD = 60;
/** Selectable times: 6:00 AM → 8:00 PM on the half hour (business-hours span). */
const FIRST_HOUR = 6;
const LAST_HOUR = 20;
const STEP_MINUTES = 30;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

interface Props {
  label?: string;
  /** Selected instant, or null when nothing has been picked yet. */
  value: Date | null;
  onChange: (d: Date) => void;
  placeholder?: string;
  help?: string;
  disabled?: boolean;
}

export function DateTimeField({ label, value, onChange, placeholder = 'Pick a date and time', help, disabled }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date>(() => startOfDay(value ?? new Date()));

  const days = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: DAYS_AHEAD }, (_, i) => new Date(base.getTime() + i * 86_400_000));
  }, []);

  const times = useMemo(() => {
    const out: { h: number; m: number }[] = [];
    for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
      for (let m = 0; m < 60; m += STEP_MINUTES) {
        if (h === LAST_HOUR && m > 0) break;
        out.push({ h, m });
      }
    }
    return out;
  }, []);

  function choose(h: number, m: number) {
    const picked = new Date(day);
    picked.setHours(h, m, 0, 0);
    onChange(picked);
    setOpen(false);
  }

  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        disabled={disabled}
        onPress={() => { setDay(startOfDay(value ?? new Date())); setOpen(true); }}
        style={[s.field, {
          backgroundColor: t.surface[0],
          borderColor: t.surface[200],
          borderRadius: t.radius,
          opacity: disabled ? 0.5 : 1,
        }]}
      >
        <Text style={{ fontSize: 16, color: value ? t.ink[900] : t.ink[300], flex: 1 }}>
          {value ? formatDateTime(value) : placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={t.ink[500]} />
      </TouchableOpacity>
      {help ? <Text style={[s.help, { color: t.ink[500] }]}>{help}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: t.surface[0] }]}>
            <Text style={[s.sheetTitle, { color: t.ink[900] }]}>{label ?? 'Pick a date and time'}</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {days.map(d => {
                const on = sameDay(d, day);
                return (
                  <TouchableOpacity
                    key={d.toISOString()}
                    onPress={() => setDay(d)}
                    style={[s.dayChip, {
                      borderRadius: t.radius,
                      borderColor: on ? t.brand.brand500 : t.surface[200],
                      backgroundColor: on ? t.brand.brand50 : t.surface[0],
                    }]}
                  >
                    <Text style={[s.dayWeekday, { color: on ? t.brand.brand700 : t.ink[500] }]}>
                      {d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </Text>
                    <Text style={[s.dayNum, { color: on ? t.brand.brand700 : t.ink[900] }]}>{d.getDate()}</Text>
                    <Text style={[s.dayMonth, { color: on ? t.brand.brand700 : t.ink[500] }]}>
                      {d.toLocaleDateString('en-US', { month: 'short' })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={s.timeGrid}>
              {times.map(({ h, m }) => {
                const on = value != null && sameDay(value, day) && value.getHours() === h && value.getMinutes() === m;
                const label12 = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return (
                  <TouchableOpacity
                    key={`${h}:${m}`}
                    onPress={() => choose(h, m)}
                    style={[s.timeChip, {
                      borderRadius: t.radius,
                      borderColor: on ? t.brand.brand500 : t.surface[200],
                      backgroundColor: on ? t.brand.brand50 : t.surface[0],
                    }]}
                  >
                    <Text style={{ fontSize: 14, color: on ? t.brand.brand700 : t.ink[900], fontWeight: on ? '700' : '400' }}>
                      {label12}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 12 },
  help: { fontSize: 12, lineHeight: 17 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  dayChip: { width: 62, alignItems: 'center', paddingVertical: 10, borderWidth: 1 },
  dayWeekday: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  dayNum: { fontSize: 20, fontWeight: '800', marginVertical: 1 },
  dayMonth: { fontSize: 11 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  timeChip: { paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1 },
});
