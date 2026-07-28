import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { RouteBuilder } from './RouteBuilder';

interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }
interface TemplateOption { id: string; name: string; recurrence?: string | null }

export const metadata = { title: 'Admin · New route' };

export default async function NewRoutePage() {
  requireTenantRole('OWNER');
  const [members, templates] = await Promise.all([
    apiServer<Member[]>('GET', '/api/me/team').catch(() => []),
    apiServer<TemplateOption[]>('GET', '/api/admin/route-templates').catch(() => []),
  ]);
  const staff = members
    .filter(m => m.active && m.role !== 'CUSTOMER')
    .map(m => ({ id: m.id, name: m.fullName ?? m.user.email }));
  const templateOptions = templates.map(t => ({ id: t.id, name: t.name }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Create route</h1>
      <p className="mt-1 mb-5 text-sm" style={{ color: 'var(--ink-500)' }}>
        A one-time route for a specific day — from scratch, or started from a{' '}
        <Link href="/admin/routes/templates" className="link">template</Link>.
      </p>
      {/* The back link lives inside RouteBuilder so it can guard unsaved changes. */}
      <RouteBuilder staff={staff} templates={templateOptions} />
    </div>
  );
}
