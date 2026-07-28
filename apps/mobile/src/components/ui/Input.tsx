/**
 * Input + Label + Help — native mirror of web's .input / .label / .help
 * (apps/web/src/app/globals.css). Includes the brand focus ring behavior.
 */
import { useState } from 'react';
import { Text, TextInput, View, StyleSheet, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

export function Label({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.label, { color: t.ink[700], fontFamily: t.font }]}>{children}</Text>;
}

export function Help({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.help, { color: t.ink[500], fontFamily: t.font }]}>{children}</Text>;
}

interface InputProps extends TextInputProps {
  label?: string;
  help?: string;
  /** Error text — when present, renders below in the danger color. */
  error?: string;
}

export function Input({ label, help, error, style, onFocus, onBlur, ...rest }: InputProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? '#dc2626' : focused ? t.brand.brand500 : t.surface[200];

  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={t.ink[300]}
        onFocus={e => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            backgroundColor: t.surface[0],
            color: t.ink[900],
            borderColor,
            borderRadius: t.radius,
            fontFamily: t.font,
            // Focus ring approximation (web: 0 0 0 4px brand@15%).
            ...(focused && !error ? t.shadowSoft : null),
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[styles.help, { color: '#dc2626', fontFamily: t.font }]}>{error}</Text>
      ) : help ? (
        <Help>{help}</Help>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500' },
  help: { fontSize: 12 },
  input: { width: '100%', paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1.5, fontSize: 16 },
});
