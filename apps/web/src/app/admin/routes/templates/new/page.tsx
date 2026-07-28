import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { TemplateBuilder } from '../TemplateBuilder';

interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }

export const metadata = { title: 'Admin · New template' };

export default async function NewTemplatePage() {
  requireTenantRole('OWNER');
  const members = await apiServer<Member[]>('GET', '/api/me/team').catch(() => []);
  const staff = members
    .filter(m => m.active && m.role !== 'CUSTOMER')
    .map(m => ({ id: m.id, name: m.fullName ?? m.user.email }));

  return (
    <div className="max-w-2xl">
      <Link href="/admin/routes/templates" className="link text-sm">← Templates</Link>
      <h1 className="mt-3 text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>New template</h1>
      <p className="mt-1 mb-5 text-sm" style={{ color: 'var(--ink-500)' }}>
        Build a reusable route blueprint with a crew and schedule. A recurring template fills the
        Routes dashboard automatically; a one-off can be started any day from “Create a route”.
      </p>
      <TemplateBuilder staff={staff} />
    </div>
  );
}
