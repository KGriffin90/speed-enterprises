'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { EditEntryModal } from './EditEntryModal';

interface Entry {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  breakMinutes: number;
  notesByStaff: string | null;
  notesByAdmin: string | null;
  status: string;
  membership: {
    fullName: string | null;
    role: string;
    user: { email: string };
  };
}

function fmtDuration(inAt: string, outAt: string, breakMins: number): string {
  const mins = Math.max(0, Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 60_000) - breakMins);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function TimesheetsTable({ entries }: { entries: Entry[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Entry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function remove(e: Entry) {
    const who = e.membership.fullName ?? e.membership.user.email;
    const day = new Date(e.clockedInAt).toLocaleDateString();
    if (!window.confirm(`Delete this timesheet entry for ${who} on ${day}? This permanently removes it from payroll and cannot be undone.`)) return;
    setDeletingId(e.id);
    try {
      await api('DELETE', `/api/admin/time/${e.id}`);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not delete this entry. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {editing && (
        <EditEntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
            <tr>
              <th className="text-left px-4 py-3 font-medium">Employee</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">In</th>
              <th className="text-left px-4 py-3 font-medium">Out</th>
              <th className="text-left px-4 py-3 font-medium">Duration</th>
              <th className="text-left px-4 py-3 font-medium">Notes</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
                <td className="px-4 py-3">
                  <div style={{ color: 'var(--ink-900)' }} className="font-medium">
                    {e.membership.fullName ?? e.membership.user.email}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--ink-500)' }}>{e.membership.role}</div>
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                  {new Date(e.clockedInAt).toLocaleDateString()}
                  {e.status === 'ACTIVE' && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#dcfce7', color: '#166534' }}>live</span>
                  )}
                  {e.status === 'EDITED' && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-100)', color: 'var(--ink-500)' }}>edited</span>
                  )}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                  {new Date(e.clockedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--ink-700)' }}>
                  {e.clockedOutAt ? new Date(e.clockedOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink-900)' }}>
                  {e.clockedOutAt ? fmtDuration(e.clockedInAt, e.clockedOutAt, e.breakMinutes) : '—'}
                </td>
                <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: 'var(--ink-500)' }}>
                  {e.notesByAdmin
                    ? <><span style={{ color: 'var(--brand-600)' }}>Admin:</span> {e.notesByAdmin}</>
                    : e.notesByStaff ?? '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button className="text-xs link" onClick={() => setEditing(e)}>Edit</button>
                  <button
                    className="text-xs link ml-3 disabled:opacity-40"
                    style={{ color: '#b91c1c' }}
                    disabled={deletingId === e.id}
                    onClick={() => remove(e)}
                  >
                    {deletingId === e.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
