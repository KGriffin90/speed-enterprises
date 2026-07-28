/**
 * Badge — native mirror of web's .badge / .badge-accent
 * (apps/web/src/app/globals.css). Brand-tinted pill by default; accent variant
 * uses the amber-on-accent treatment.
 */
import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

// color-mix(in srgb, X 12-15%, surface-0) is approximated by compositing the
// brand/accent hue at low alpha over white — close enough for native.
function tint(hex: string, alpha: number) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export function Badge({
  children,
  variant = 'brand',
}: {
  children: React.ReactNode;
  variant?: 'brand' | 'accent';
}) {
  const t = useTheme();
  const bg = variant === 'accent' ? tint(t.brand.accent, 0.15) : tint(t.brand.brand500, 0.12);
  const fg = variant === 'accent' ? '#92400e' : t.brand.brand700;
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderRadius: t.radiusFull }]}>
      <Text style={[styles.text, { color: fg, fontFamily: t.font }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontSize: 12, fontWeight: '600' },
});
