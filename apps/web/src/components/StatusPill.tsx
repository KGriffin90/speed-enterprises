import type { QuoteStatus } from '@speed-enterprises/shared';

const STYLE: Record<QuoteStatus, { bg: string; fg: string; label: string }> = {
  NEW:           { bg: 'var(--brand-100)',  fg: 'var(--brand-700)',  label: 'New' },
  REVIEWING:     { bg: '#fffbeb',           fg: '#b45309',           label: 'Reviewing' },
  ESTIMATE_SENT: { bg: '#ecfdf5',           fg: '#047857',           label: 'Estimate sent' },
  SCHEDULED:     { bg: '#eef2ff',           fg: '#4338ca',           label: 'Scheduled' },
  IN_PROGRESS:   { bg: '#fef3c7',           fg: '#92400e',           label: 'In progress' },
  COMPLETED:     { bg: 'var(--surface-100)', fg: 'var(--ink-700)',   label: 'Completed' },
  PAID:          { bg: '#d1fae5',           fg: '#065f46',           label: 'Paid' },
  CANCELED:      { bg: '#fef2f2',           fg: '#991b1b',           label: 'Canceled' },
};

export function StatusPill({ status }: { status: QuoteStatus }) {
  const s = STYLE[status];
  return (
    <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}
