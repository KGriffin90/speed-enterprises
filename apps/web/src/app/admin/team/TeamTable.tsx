'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';

type TenantRole = 'CUSTOMER' | 'STAFF' | 'OWNER';

const displayRole = (r: TenantRole) => r;
const isAdmin = (r: TenantRole) => r === 'OWNER';

interface EmployeeProfile {
  basePayCents: number; payType: string; avgMpg: number; vehicleNotes: string | null; phone: string | null;
}

interface Row {
  id: string; userId: string; role: TenantRole;
  fullName: string | null; active: boolean; acceptedAt: string | null; createdAt: string;
  user: { email: string; emailVerifiedAt: string | null; lastLoginAt: string | null };
  employeeProfile: EmployeeProfile | null;
}

const ASSIGNABLE: TenantRole[] = ['CUSTOMER', 'STAFF', 'OWNER'];

export function TeamTable({ rows, actorUserId, actorRole }: { rows: Row[]; actorUserId: string; actorRole: TenantRole }) {
  const router = useRouter();
  const active   = rows.filter(r => r.active);
  const inactive = rows.filter(r => !r.active);

  return (
    <div className="space-y-6">
      <InviteCard onAdded={() => router.refresh()} />

      <section className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--surface-50)', color: 'var(--ink-500)' }}>
            <tr>
              <th className="text-left px-4 py-3 font-medium">Member</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Hourly rate</th>
              <th className="text-left px-4 py-3 font-medium">Vehicle / MPG</th>
              <th className="text-left px-4 py-3 font-medium">Last login</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {active.map(r => (
              <MemberRow key={r.id} row={r} actorUserId={actorUserId} actorRole={actorRole} onChange={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      </section>

      {inactive.length > 0 && (
        <details className="card p-4">
          <summary className="text-sm cursor-pointer" style={{ color: 'var(--ink-500)' }}>
            {inactive.length} removed member{inactive.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-3 text-sm divide-y" style={{ color: 'var(--ink-500)', borderColor: 'var(--surface-200)' }}>
            {inactive.map(r => (
              <InactiveRow key={r.id} row={r} onChange={() => router.refresh()} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function InactiveRow({ row, onChange }: { row: Row; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function purge() {
    if (!window.confirm(
      `Permanently delete ${row.fullName ?? row.user.email}?\n\nThis removes them and their time entries, routes, and pay profile from the database. This cannot be undone.`
    )) return;
    setBusy(true);
    try { await api('DELETE', `/api/me/team/${row.id}/permanent`); onChange(); }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Could not delete this member.'); setBusy(false); }
  }
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>{row.user.email} · {displayRole(row.role)}</span>
      <button onClick={purge} disabled={busy} className="text-xs font-semibold disabled:opacity-50" style={{ color: '#dc2626' }}>
        {busy ? 'Deleting…' : 'Delete permanently'}
      </button>
    </li>
  );
}

function InviteCard({ onAdded }: { onAdded: () => void }) {
  const [email,    setEmail]    = useState('');
  const [fullName, setFullName] = useState('');
  const [role,     setRole]     = useState<TenantRole>('STAFF');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSuccess(null);
    try {
      const r = await api<{ immediate: boolean; inviteUrlForDev?: string }>(
        'POST', '/api/me/team/invite', { email, fullName, role },
      );
      setSuccess(r.immediate ? 'Added.' : r.inviteUrlForDev ? `Invite sent. Dev: ${r.inviteUrlForDev}` : 'Invite emailed.');
      setEmail(''); setFullName('');
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <div className="font-semibold mb-3" style={{ color: 'var(--ink-900)' }}>Invite a member</div>
      <div className="grid md:grid-cols-12 gap-3">
        <input className="input md:col-span-5" type="email" required placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="input md:col-span-4" required placeholder="full name" value={fullName} onChange={e => setFullName(e.target.value)} />
        <select className="input md:col-span-2" value={role} onChange={e => setRole(e.target.value as TenantRole)}>
          {ASSIGNABLE.map(r => <option key={r} value={r}>{displayRole(r)}</option>)}
        </select>
        <button className="btn-primary md:col-span-1" disabled={busy}>{busy ? '…' : 'Add'}</button>
      </div>
      {error   && <div className="text-xs mt-2" style={{ color: '#dc2626' }}>{error}</div>}
      {success && <div className="text-xs mt-2" style={{ color: '#059669' }}>{success}</div>}
    </form>
  );
}

function MemberRow({ row, actorUserId, actorRole, onChange }: {
  row: Row; actorUserId: string; actorRole: TenantRole; onChange: () => void;
}) {
  const [busy,       setBusy]       = useState(false);
  const [editingPay, setEditingPay] = useState(false);
  const [payRate,    setPayRate]    = useState(row.employeeProfile ? (row.employeeProfile.basePayCents / 100).toFixed(2) : '');
  const [mpg,        setMpg]        = useState(row.employeeProfile?.avgMpg?.toString() ?? '25');
  const [vehicle,    setVehicle]    = useState(row.employeeProfile?.vehicleNotes ?? '');
  const [phone,      setPhone]      = useState(row.employeeProfile?.phone ?? '');
  const [payBusy,    setPayBusy]    = useState(false);

  const isSelf  = row.userId === actorUserId;
  const canEdit = !isSelf && isAdmin(actorRole);
  const isStaff = row.role !== 'CUSTOMER';

  async function changeRole(newRole: TenantRole) {
    setBusy(true);
    try { await api('PATCH', `/api/me/team/${row.id}/role`, { role: newRole }); onChange(); }
    catch {} finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Remove ${row.user.email}?`)) return;
    setBusy(true);
    try { await api('DELETE', `/api/me/team/${row.id}`); onChange(); }
    catch {} finally { setBusy(false); }
  }

  async function savePay(e: React.FormEvent) {
    e.preventDefault();
    setPayBusy(true);
    try {
      await api('PATCH', `/api/me/team/${row.id}/pay`, {
        basePayCents: Math.round(parseFloat(payRate) * 100) || 0,
        avgMpg: parseFloat(mpg) || 25,
        vehicleNotes: vehicle || undefined,
        phone: phone.trim() || undefined,
      });
      onChange();
      setEditingPay(false);
    } catch {} finally { setPayBusy(false); }
  }

  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--surface-100)' }}>
        <td className="px-4 py-3">
          <div style={{ color: 'var(--ink-900)' }} className="font-medium">{row.fullName ?? row.user.email}</div>
          <div className="text-xs" style={{ color: 'var(--ink-500)' }}>{row.user.email}{isSelf ? ' (you)' : ''}</div>
        </td>
        <td className="px-4 py-3">
          {canEdit ? (
            <select className="input py-1 px-2 text-sm" value={row.role} onChange={e => changeRole(e.target.value as TenantRole)} disabled={busy}>
              {ASSIGNABLE.map(r => <option key={r} value={r}>{displayRole(r)}</option>)}
            </select>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: 'var(--surface-100)', color: 'var(--ink-700)' }}>
              {displayRole(row.role)}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-700)' }}>
          {isStaff && row.employeeProfile?.basePayCents
            ? `$${(row.employeeProfile.basePayCents / 100).toFixed(2)}/hr`
            : <span style={{ color: 'var(--ink-300)' }}>—</span>}
          {isStaff && canEdit && (
            <button className="ml-2 text-xs link" onClick={() => setEditingPay(v => !v)}>
              {editingPay ? 'cancel' : 'set'}
            </button>
          )}
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-500)' }}>
          {isStaff && row.employeeProfile
            ? `${row.employeeProfile.avgMpg} mpg${row.employeeProfile.vehicleNotes ? ` · ${row.employeeProfile.vehicleNotes}` : ''}`
            : <span style={{ color: 'var(--ink-300)' }}>—</span>}
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink-500)' }}>
          {row.user.lastLoginAt ? new Date(row.user.lastLoginAt).toLocaleDateString() : '—'}
        </td>
        <td className="px-4 py-3 text-right">
          {canEdit && (
            <button onClick={remove} disabled={busy} className="text-sm" style={{ color: '#dc2626' }}>Remove</button>
          )}
        </td>
      </tr>
      {editingPay && (
        <tr className="border-t" style={{ borderColor: 'var(--surface-100)', background: 'var(--surface-50)' }}>
          <td colSpan={6} className="px-4 py-3">
            <form onSubmit={savePay} className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="label text-xs">Hourly rate ($)</label>
                <input className="input w-28 text-sm" type="number" min={0} step={0.01} placeholder="0.00"
                  value={payRate} onChange={e => setPayRate(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Avg MPG</label>
                <input className="input w-20 text-sm" type="number" min={1} step={0.5}
                  value={mpg} onChange={e => setMpg(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Vehicle (optional)</label>
                <input className="input w-44 text-sm" placeholder="e.g. 2020 Toyota Camry"
                  value={vehicle} onChange={e => setVehicle(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Phone (optional)</label>
                <input className="input w-40 text-sm" type="tel" placeholder="(801) 555-0100"
                  value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <button className="btn-primary text-sm py-2 px-3" type="submit" disabled={payBusy}>
                {payBusy ? '…' : 'Save'}
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
