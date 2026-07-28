/**
 * Typography — shared text styles so screens stop hand-rolling font sizes and
 * colors. Maps to the web type scale / ink token roles.
 *   Heading  → page/section titles  (ink-900, bold)
 *   Subtitle → secondary headings    (ink-900, semibold)
 *   Body     → default copy          (ink-700)
 *   Muted    → captions / hints      (ink-500)
 */
import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

type Variant = 'heading' | 'subtitle' | 'body' | 'muted';

const SIZE: Record<Variant, { fontSize: number; fontWeight: TextStyle['fontWeight'] }> = {
  heading: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  muted: { fontSize: 13, fontWeight: '400' },
};

interface TypographyProps extends TextProps {
  variant?: Variant;
  children: React.ReactNode;
}

export function Typography({ variant = 'body', style, children, ...rest }: TypographyProps) {
  const t = useTheme();
  const color = variant === 'muted' ? t.ink[500] : variant === 'body' ? t.ink[700] : t.ink[900];
  const { fontSize, fontWeight } = SIZE[variant];
  return (
    <Text style={[{ color, fontSize, fontWeight, fontFamily: t.font }, style]} {...rest}>
      {children}
    </Text>
  );
}

export const Heading = (p: Omit<TypographyProps, 'variant'>) => <Typography variant="heading" {...p} />;
export const Subtitle = (p: Omit<TypographyProps, 'variant'>) => <Typography variant="subtitle" {...p} />;
export const Body = (p: Omit<TypographyProps, 'variant'>) => <Typography variant="body" {...p} />;
export const Muted = (p: Omit<TypographyProps, 'variant'>) => <Typography variant="muted" {...p} />;
