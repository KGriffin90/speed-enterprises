import { Alert, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';

export interface SortOption<K extends string> { key: K; label: string }

/**
 * Compact "Sort: <label> ▾" pill used on the quote/job lists. Tapping opens a
 * native action sheet with the available sort options. The comparator itself
 * lives in each screen (fields differ); this is just the picker UI.
 */
export function SortControl<K extends string>({ value, options, onChange }: {
  value: K;
  options: SortOption<K>[];
  onChange: (key: K) => void;
}) {
  const t = useTheme();
  const current = options.find(o => o.key === value)?.label ?? 'Sort';

  function open() {
    Alert.alert('Sort by', undefined, [
      ...options.map(o => ({
        text: o.key === value ? `${o.label}  ✓` : o.label,
        onPress: () => onChange(o.key),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  return (
    <TouchableOpacity onPress={open} style={[s.btn, { backgroundColor: t.surface[100] }]} accessibilityLabel={`Sort by ${current}`}>
      <Ionicons name="swap-vertical-outline" size={14} color={t.ink[700]} />
      <Text style={[s.text, { color: t.ink[700] }]}>Sort: {current}</Text>
      <Ionicons name="chevron-down" size={12} color={t.ink[500]} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start' },
  text: { fontSize: 13, fontWeight: '600' },
});
