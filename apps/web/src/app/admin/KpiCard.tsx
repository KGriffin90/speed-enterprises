'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type Accent = 'brand' | 'green' | 'purple' | 'orange' | 'blue';

const COLORS: Record<Accent, { bg: string; fg: string; bar: string }> = {
  brand:  { bg: 'var(--brand-50)', fg: 'var(--brand-700)', bar: 'var(--brand-500)' },
  green:  { bg: '#f0fdf4',         fg: '#15803d',          bar: '#22c55e'          },
  purple: { bg: '#faf5ff',         fg: '#7e22ce',          bar: '#a855f7'          },
  orange: { bg: '#fff7ed',         fg: '#c2410c',          bar: '#f97316'          },
  blue:   { bg: '#eff6ff',         fg: '#1d4ed8',          bar: '#3b82f6'          },
};

/**
 * Dashboard KPI tile. Hovering (or focusing) for more than a second reveals a
 * tooltip explaining what the metric measures. Clicking narrows the dashboard
 * to that metric; clicking the selected tile again clears it.
 */
export function KpiCard({ label, value, sub, accent, description, href, active }: {
  label: string; value: string; sub: string; accent: Accent;
  description: string; href: string; active: boolean;
}) {
  const colors = COLORS[accent];
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const open  = () => { clear(); timer.current = setTimeout(() => setShow(true), 1000); };
  const close = () => { clear(); setShow(false); };
  useEffect(() => clear, []);

  return (
    <div className="relative">
      <Link
        href={href}
        scroll={false}
        aria-current={active ? 'true' : undefined}
        className="card p-5 relative overflow-hidden block transition-shadow"
        style={active ? { boxShadow: `0 0 0 2px ${colors.bar}` } : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >
        <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl" style={{ background: colors.bar }} />
        <div className="text-xs font-medium mb-2 pl-1" style={{ color: 'var(--ink-500)' }}>{label}</div>
        <div className="text-2xl font-bold pl-1" style={{ color: 'var(--ink-900)' }}>{value}</div>
        <div className="text-xs pl-1 mt-0.5" style={{ color: colors.fg }}>{active ? 'showing · tap to clear' : sub}</div>
      </Link>
      {show && (
        <div
          role="tooltip"
          className="absolute z-20 left-0 right-0 top-full mt-2 rounded-lg p-3 text-xs leading-relaxed shadow-lg"
          style={{ background: 'var(--surface-0)', color: 'var(--ink-600)', border: '1px solid var(--surface-200)' }}
        >
          {description}
        </div>
      )}
    </div>
  );
}
