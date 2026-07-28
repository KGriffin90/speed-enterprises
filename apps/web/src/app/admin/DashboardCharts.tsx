import type { QuoteStatus } from '@speed-enterprises/shared';

/**
 * Visual summaries for the Pipeline and Win rate dashboard views.
 *
 * Palette: pipeline is a single blue series (bar length already encodes
 * magnitude, so colouring each bar differently would double-encode it).
 * Win/loss is polarity, so it uses the diverging blue/red pair with a neutral
 * grey for still-open work — red/green would be indistinguishable to a
 * red-green colourblind reader. Every chart is paired with a table of the same
 * numbers, so no value is reachable only by colour.
 */

interface ChartRow {
  status: QuoteStatus;
  estimateAmountCents: number | null;
}

const STAGE_ORDER: QuoteStatus[] = [
  'NEW', 'REVIEWING', 'ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELED',
];

const label = (s: QuoteStatus) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Chart colours as custom properties. The app's inline theme script always
 * stamps data-theme on <html>, so that selector is the authority — a
 * prefers-color-scheme block could contradict an explicit light choice.
 */
const VIZ_CSS = `
.viz { --viz-series:#2a78d6; --viz-won:#2a78d6; --viz-lost:#d03b3b; --viz-open:#898781; }
:root[data-theme='dark'] .viz { --viz-series:#3987e5; --viz-won:#3987e5; }
`;

function VizStyle() {
  return <style dangerouslySetInnerHTML={{ __html: VIZ_CSS }} />;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export function PipelineChart({ rows }: { rows: ChartRow[] }) {
  const stages = STAGE_ORDER
    .map(status => {
      const inStage = rows.filter(r => r.status === status && r.estimateAmountCents);
      return {
        status,
        total: inStage.reduce((sum, r) => sum + (r.estimateAmountCents ?? 0), 0),
        count: inStage.length,
      };
    })
    .filter(s => s.total > 0);

  const grand = stages.reduce((s, x) => s + x.total, 0);
  const max   = Math.max(...stages.map(s => s.total), 1);

  if (stages.length === 0) {
    return <EmptyChart message="No quotes have an estimate amount yet, so there is no pipeline to chart." />;
  }

  return (
    <div className="viz card p-6">
      <VizStyle />
      <div className="text-xs font-medium" style={{ color: 'var(--ink-500)' }}>Pipeline by stage</div>
      <div className="font-bold mt-1" style={{ fontSize: '48px', lineHeight: 1.1, color: 'var(--ink-900)' }}>
        {money(grand)}
      </div>
      <p className="text-sm mt-1 mb-6" style={{ color: 'var(--ink-500)' }}>
        Estimated value of every quote carrying an estimate, grouped by the stage it currently sits in.
      </p>

      <div className="flex flex-col gap-4">
        {stages.map(s => (
          <div key={s.status} className="flex items-center gap-3">
            <div className="text-xs w-28 flex-shrink-0 text-right" style={{ color: 'var(--ink-500)' }}>
              {label(s.status)}
            </div>
            <div className="flex-1 min-w-0">
              <div
                title={`${label(s.status)}: ${money(s.total)} across ${s.count} ${s.count === 1 ? 'quote' : 'quotes'}`}
                style={{
                  width: `${Math.max((s.total / max) * 100, 1.5)}%`,
                  height: 14,
                  background: 'var(--viz-series)',
                  borderRadius: '0 4px 4px 0',
                }}
              />
            </div>
            <div className="text-xs w-28 flex-shrink-0 font-semibold" style={{ color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>
              {money(s.total)}
            </div>
          </div>
        ))}
      </div>

      <StageTable
        caption="Pipeline by stage"
        head={['Stage', 'Quotes', 'Estimated value']}
        rows={stages.map(s => [label(s.status), String(s.count), money(s.total)])}
        foot={['Total', String(stages.reduce((n, s) => n + s.count, 0)), money(grand)]}
      />
    </div>
  );
}

// ── Win rate ────────────────────────────────────────────────────────────────

export function WinRateChart({ rows }: { rows: ChartRow[] }) {
  const total = rows.length;
  const won    = rows.filter(r => ['COMPLETED', 'PAID'].includes(r.status)).length;
  const lost   = rows.filter(r => r.status === 'CANCELED').length;
  const open   = total - won - lost;
  const pct    = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  if (total === 0) {
    return <EmptyChart message="No quotes yet, so there is no win rate to chart." />;
  }

  const segments = [
    { key: 'won',  name: 'Won',       n: won,  color: 'var(--viz-won)',  note: 'Completed or Paid' },
    { key: 'open', name: 'In flight', n: open, color: 'var(--viz-open)', note: 'Still moving through the pipeline' },
    { key: 'lost', name: 'Lost',      n: lost, color: 'var(--viz-lost)', note: 'Canceled' },
  ].filter(s => s.n > 0);

  return (
    <div className="viz card p-6">
      <VizStyle />
      <div className="text-xs font-medium" style={{ color: 'var(--ink-500)' }}>Win rate</div>
      <div className="font-bold mt-1" style={{ fontSize: '48px', lineHeight: 1.1, color: 'var(--ink-900)' }}>
        {pct(won)}%
      </div>
      <p className="text-sm mt-1 mb-6" style={{ color: 'var(--ink-500)' }}>
        {won} of {total} quotes reached Completed or Paid. In-flight work counts against the rate until it finishes.
      </p>

      {/* Stacked bar — 2px surface gaps separate the segments, no borders. */}
      <div className="flex w-full" style={{ gap: 2 }}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            title={`${s.name}: ${s.n} ${s.n === 1 ? 'quote' : 'quotes'} (${pct(s.n)}%)`}
            style={{
              width: `${(s.n / total) * 100}%`,
              height: 24,
              background: s.color,
              borderTopLeftRadius:     i === 0 ? 4 : 0,
              borderBottomLeftRadius:  i === 0 ? 4 : 0,
              borderTopRightRadius:    i === segments.length - 1 ? 4 : 0,
              borderBottomRightRadius: i === segments.length - 1 ? 4 : 0,
            }}
          />
        ))}
      </div>

      {/* Legend — identity never rests on colour alone. */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-2">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span className="text-sm" style={{ color: 'var(--ink-900)' }}>{s.name}</span>
            <span className="text-sm" style={{ color: 'var(--ink-500)' }}>{s.n} · {pct(s.n)}%</span>
          </div>
        ))}
      </div>

      <StageTable
        caption="Quote outcomes"
        head={['Outcome', 'Quotes', 'Share']}
        rows={segments.map(s => [`${s.name} (${s.note})`, String(s.n), `${pct(s.n)}%`])}
        foot={['Total', String(total), '100%']}
      />
    </div>
  );
}

// ── Shared pieces ───────────────────────────────────────────────────────────

/** The table twin: the same numbers, reachable without reading the chart. */
function StageTable({ caption, head, rows, foot }: {
  caption: string; head: string[]; rows: string[][]; foot: string[];
}) {
  return (
    <details className="mt-6">
      <summary className="text-xs cursor-pointer" style={{ color: 'var(--ink-500)' }}>
        View as table
      </summary>
      <table className="w-full text-sm mt-3">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: 'var(--ink-500)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r[0]} className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
              {r.map((cell, i) => (
                <td key={i} className={`py-2 ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: 'var(--ink-800)', fontVariantNumeric: i ? 'tabular-nums' : undefined }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t" style={{ borderColor: 'var(--surface-200)' }}>
            {foot.map((cell, i) => (
              <td key={i} className={`py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: 'var(--ink-900)', fontVariantNumeric: i ? 'tabular-nums' : undefined }}>{cell}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </details>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="card p-16 text-center">
      <div className="text-4xl mb-3">📊</div>
      <div className="text-sm" style={{ color: 'var(--ink-500)' }}>{message}</div>
    </div>
  );
}
