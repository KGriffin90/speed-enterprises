import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { TemplatesManager, type Template } from './TemplatesManager';

interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }

export const metadata = { title: 'Admin · Templates' };

export default async function RouteTemplatesPage() {
  requireTenantRole('OWNER');
  const [templates, members] = await Promise.all([
    apiServer<Template[]>('GET', '/api/admin/route-templates').catch(() => []),
    apiServer<Member[]>('GET', '/api/me/team').catch(() => []),
  ]);
  const staff = members
    .filter(m => m.active && m.role !== 'CUSTOMER')
    .map(m => ({ id: m.id, name: m.fullName ?? m.user.email }));

  return (
    <div className="max-w-2xl">
      <Link href="/admin/routes" className="link text-sm">← Routes</Link>
      <div className="flex items-center justify-between mt-3 mb-2">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Templates</h1>
        <Link href="/admin/routes/templates/new" className="btn-primary">+ New template</Link>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-500)' }}>
        Reusable route blueprints. A <strong>recurring</strong> template (weekly, monthly, …) fills
        the Routes dashboard automatically; a one-off template can be started any day from{' '}
        <strong>Create a route</strong>.
      </p>
      <TemplatesManager initial={templates} staff={staff} />
    </div>
  );
}
