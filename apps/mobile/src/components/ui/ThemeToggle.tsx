/**
 * ThemeToggle — native mirror of web's ThemeToggle (apps/web/src/components/
 * ThemeToggle.tsx). A sun/moon button that flips the app between light and dark;
 * the choice is persisted by ThemeProvider. Shows a moon in light mode (tap to
 * go dark) and a sun in dark mode (tap to go light).
 */
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useColorMode } from '@/theme/ThemeProvider';

export function ThemeToggle({ size = 36 }: { size?: number }) {
  const t = useTheme();
  const { scheme, toggle } = useColorMode();
  const isDark = scheme === 'dark';

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        {
          width: size,
          height: size,
          borderRadius: 10,
          borderColor: t.surface[200],
          backgroundColor: pressed ? t.surface[100] : 'transparent',
        },
      ]}
    >
      <Ionicons
        name={isDark ? 'sunny-outline' : 'moon-outline'}
        size={Math.round(size * 0.5)}
        color={t.ink[500]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
