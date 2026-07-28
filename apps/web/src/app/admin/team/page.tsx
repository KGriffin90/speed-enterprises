import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { TeamTable } from './TeamTable';

interface Membership {
  id: string; userId: string;
  role: 'CUSTOMER' | 'STAFF' | 'OWNER';
  fullName: string | null; active: boolean; acceptedAt: string | null; createdAt: string;
  user: { email: string; emailVerifiedAt: string | null; lastLoginAt: string | null };
  employeeProfile: { basePayCents: number; payType: string; avgMpg: number; vehicleNotes: string | null; phone: string | null } | null;
}

export const metadata = { title: 'Admin · Team' };

export default async function AdminTeam() {
  const me = requireTenantRole('OWNER');
  const rows = await apiServer<Membership[]>('GET', '/api/me/team');
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--ink-900)' }}>Team</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        Add staff, change roles, remove access. Owners and admins can read and write quotes; staff are read-only.
      </p>
      <TeamTable rows={rows} actorUserId={me.user.id} actorRole={(me.tenant?.role ?? 'CUSTOMER') as any} />
    </div>
  );
}
