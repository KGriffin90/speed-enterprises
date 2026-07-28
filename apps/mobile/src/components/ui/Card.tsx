/**
 * Card — native mirror of web's .card (apps/web/src/app/globals.css):
 * surface-0 background, 1px surface-200 border, brand radius, soft shadow.
 */
import { View, type ViewProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

interface CardProps extends ViewProps {
  /** Interior padding in px (web cards vary; default mirrors the common p-5). */
  padding?: number;
}

export function Card({ padding = 20, style, children, ...rest }: CardProps) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface[0],
          borderColor: t.surface[200],
          borderWidth: 1,
          borderRadius: t.radius,
          padding,
        },
        t.shadowSoft,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
