'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

export function RouteActions({ routeId, name }: { routeId: string; name: string | null }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete ${name ? `“${name}”` : 'this route'}? This permanently removes the route, its stops and any GPS history. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api('DELETE', `/api/admin/routes/${routeId}`);
      router.push('/admin/routes');
      router.refresh();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not delete this route. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link href={`/admin/routes/${routeId}/edit`} className="btn-secondary text-sm">Edit</Link>
      <button
        className="btn-secondary text-sm disabled:opacity-40"
        style={{ color: '#b91c1c' }}
        disabled={busy}
        onClick={remove}
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  );
}
