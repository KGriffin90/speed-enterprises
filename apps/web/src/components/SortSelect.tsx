'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * Sort dropdown for server-rendered lists. Writes the choice to `?sort=` (or a
 * custom param) in the URL — preserving other params (status, q) — and the
 * server page reads it back to order the rows.
 */
export function SortSelect({ options, paramKey = 'sort', defaultValue }: {
  options: { value: string; label: string }[];
  paramKey?: string;
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(paramKey) ?? defaultValue ?? options[0]?.value ?? '';

  function onChange(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(paramKey, value); else next.delete(paramKey);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs" style={{ color: 'var(--ink-500)' }}>Sort by</label>
      <select className="input py-1.5 text-sm w-44" value={current} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
