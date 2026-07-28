/**
 * Screen — the native equivalent of web's `.section` container plus page
 * chrome: surface-50 background (web html/body), safe-area insets, and a
 * max-width-style horizontal gutter (px-6 → 20px on phones). Use `scroll`
 * for content that can exceed the viewport.
 */
import { ScrollView, View, StyleSheet, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
  /** Horizontal padding (web .section is px-6 = 24; phones read better at 20). */
  gutter?: number;
  edges?: Edge[];
}

export function Screen({
  scroll = false,
  gutter = 20,
  edges = ['top', 'bottom'],
  style,
  children,
  ...rest
}: ScreenProps) {
  const t = useTheme();
  const body = (
    <View style={[styles.body, { paddingHorizontal: gutter }, style]} {...rest}>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.surface[50] }]} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: gutter }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={style} {...rest}>
            {children}
          </View>
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1 },
  scrollContent: { paddingVertical: 20, gap: 16 },
});
