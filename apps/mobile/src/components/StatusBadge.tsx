/**
 * StatusBadge — native mirror of web's StatusPill
 * (apps/web/src/components/StatusPill.tsx). Same per-status colors and labels;
 * the brand/surface/ink slots resolve from the active tenant theme so NEW and
 * COMPLETED track the tenant's palette exactly like web's CSS vars.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { QuoteStatus } from '@speed-enterprises/shared';
import { useTheme } from '@/theme/ThemeProvider';

type Slot = { bg: string; fg: string; label: string };

export function StatusBadge({ status }: { status: QuoteStatus | string }) {
  const t = useTheme();

  // Mirrors StatusPill's STYLE map. var(--brand-*) / var(--surface-*) /
  // var(--ink-*) become live theme reads; fixed hexes are copied verbatim.
  const STYLE: Record<QuoteStatus, Slot> = {
    NEW: { bg: t.brand.brand100, fg: t.brand.brand700, label: 'New' },
    REVIEWING: { bg: '#fffbeb', fg: '#b45309', label: 'Reviewing' },
    ESTIMATE_SENT: { bg: '#ecfdf5', fg: '#047857', label: 'Estimate sent' },
    SCHEDULED: { bg: '#eef2ff', fg: '#4338ca', label: 'Scheduled' },
    IN_PROGRESS: { bg: '#fef3c7', fg: '#92400e', label: 'In progress' },
    COMPLETED: { bg: t.surface[100], fg: t.ink[700], label: 'Completed' },
    PAID: { bg: '#d1fae5', fg: '#065f46', label: 'Paid' },
    CANCELED: { bg: '#fef2f2', fg: '#991b1b', label: 'Canceled' },
  };

  const slot: Slot = STYLE[status as QuoteStatus] ?? {
    bg: t.surface[100],
    fg: t.ink[700],
    label: String(status).replace(/_/g, ' '),
  };

  return (
    <View style={[s.badge, { backgroundColor: slot.bg, borderRadius: t.radiusFull }]}>
      <Text style={[s.text, { color: slot.fg, fontFamily: t.font }]}>{slot.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '500' },
});
