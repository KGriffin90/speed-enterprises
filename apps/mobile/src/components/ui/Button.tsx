/**
 * Button — native mirror of web's .btn-primary / .btn-secondary / .btn-ghost
 * (apps/web/src/app/globals.css). Same color roles, radius, and weight.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: Variant;
  loading?: boolean;
  /** Optional leading icon node (e.g. an @expo/vector-icons glyph). */
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  icon,
  fullWidth = true,
  disabled,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const isDisabled = disabled || loading;

  // Per-variant resolved colors, mirroring the web token roles.
  const palette = {
    primary: { bg: t.brand.brand500, bgActive: t.brand.brand600, fg: t.brand.onBrand, border: 'transparent' },
    secondary: { bg: t.surface[0], bgActive: t.surface[50], fg: t.ink[900], border: t.surface[200] },
    ghost: { bg: 'transparent', bgActive: t.surface[100], fg: t.ink[700], border: 'transparent' },
  }[variant];

  const isGhost = variant === 'ghost';

  return (
    <Pressable
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed && !isDisabled ? palette.bgActive : palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' ? 1.5 : 0,
          borderRadius: isGhost ? 8 : t.radius,
          paddingVertical: isGhost ? 8 : 13,
          paddingHorizontal: isGhost ? 16 : 20,
          opacity: isDisabled ? 0.5 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        variant === 'primary' && !isDisabled ? t.shadowSoft : null,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text
            style={[
              styles.label,
              { color: palette.fg, fontSize: isGhost ? 14 : 16, fontWeight: isGhost ? '500' : '600', fontFamily: t.font },
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { textAlign: 'center' },
});
