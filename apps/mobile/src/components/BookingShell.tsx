/**
 * BookingShell — native mirror of apps/web/src/app/book/BookingShell.tsx.
 *
 * Chrome for the standalone token-authed booking pages under app/book/. These
 * open from an appointment email via Universal Links / App Links, so they must
 * render for a SIGNED-OUT visitor: the token in the URL is the credential, and
 * the matching API routes (`/api/book/*`) carry no auth guard.
 *
 * That's also why there's no tab bar or back-to-account chrome here — the user
 * may have arrived with no session at all. The footer link drops them on the
 * storefront rather than a dead end.
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlatformLogo } from '@/components/PlatformLogo';
import { useTheme, type Theme } from '@/theme/ThemeProvider';

export function BookingShell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <PlatformLogo size={56} />
        </View>

        <View style={[s.card, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }, t.shadowSoft]}>
          <Text style={[s.title, { color: t.ink[900] }]}>{title}</Text>
          {children}
        </View>

        <TouchableOpacity
          style={s.homeLink}
          onPress={() => router.replace('/(platform)/storefront' as any)}
          accessibilityRole="link"
        >
          <Text style={[s.homeLinkText, { color: t.brand.brand600 }]}>Go to Speed Enterprises</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Selectable time slot — shared by the reschedule screen and BookingPanel. */
export function SlotButton({
  t, disabled, selected, onPress, children,
}: {
  t: Theme;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.7}
      style={[s.slot, {
        borderRadius: t.radius,
        borderColor: selected ? t.brand.brand500 : t.surface[200],
        backgroundColor: selected ? t.brand.brand50 : t.surface[0],
        borderWidth: selected ? 2 : 1,
        opacity: disabled ? 0.5 : 1,
      }]}
    >
      <Text style={{ fontSize: 14, color: selected ? t.brand.brand700 : t.ink[900], fontWeight: selected ? '700' : '400' }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  brand: { alignItems: 'center', paddingBottom: 24 },
  card: { borderWidth: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  slot: { paddingHorizontal: 12, paddingVertical: 12 },
  homeLink: { alignItems: 'center', marginTop: 24 },
  homeLinkText: { fontSize: 14, fontWeight: '600' },
});
