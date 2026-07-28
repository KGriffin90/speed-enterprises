import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Inline "couldn't load" banner with retry. List screens previously swallowed
 * fetch errors (`catch {}`) and rendered their EMPTY state — offline users saw
 * "No jobs found" and couldn't tell outage from no-data. Render this above the
 * list (and suppress the empty state) when a load fails.
 */
export function LoadFailedBanner({ onRetry }: { onRetry: () => void }) {
  const t = useTheme();
  return (
    <View style={s.wrap}>
      <Ionicons name="cloud-offline-outline" size={16} color="#b91c1c" />
      <Text style={s.text}>Couldn't load — check your connection.</Text>
      <TouchableOpacity onPress={onRetry} accessibilityLabel="Retry loading" hitSlop={8}>
        <Text style={[s.retry, { color: t.brand.brand600 }]}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12,
  },
  text: { flex: 1, fontSize: 13, color: '#991b1b' },
  retry: { fontSize: 13, fontWeight: '700' },
});
