import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { TemplateBuilder, type TemplateInitial, type Recurrence } from '../../TemplateBuilder';

export const metadata = { title: 'Admin · Edit template' };
export const dynamic = 'force-dynamic';

interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }

interface TemplateDetail {
  id: string;
  name: string;
  recurrence: Recurrence | null;
  startDate: string | null;
  assignees: Array<{ membershipId: string }>;
  stops: Array<{ label: string; addressLine: string | null; city: string | null; state: string | null; postalCode: string | null }>;
}

export default async function EditTemplatePage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  requireTenantRole('OWNER');

  const [tpl, members] = await Promise.all([
    apiServer<TemplateDetail>('GET', `/api/admin/route-templates/${params.id}`).catch(() => null),
    apiServer<Member[]>('GET', '/api/me/team').catch(() => [] as Member[]),
  ]);
  if (!tpl) notFound();

  const staff = members
    .filter(m => m.active && m.role !== 'CUSTOMER')
    .map(m => ({ id: m.id, name: m.fullName ?? m.user.email }));

  const initial: TemplateInitial = {
    id: tpl.id,
    name: tpl.name,
    recurrence: tpl.recurrence ?? 'WEEKLY',
    startDate: tpl.startDate,
    membershipIds: tpl.assignees.map(a => a.membershipId),
    stops: tpl.stops.map(s => ({
      label: s.label,
      addressLine: s.addressLine ?? '',
      city: s.city ?? '',
      state: s.state ?? '',
      postalCode: s.postalCode ?? '',
    })),
  };

  return (
    <div className="max-w-2xl">
      <Link href="/admin/routes/templates" className="link text-sm">← Templates</Link>
      <h1 className="mt-3 mb-5 text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Edit template</h1>
      <TemplateBuilder initial={initial} staff={staff} />
    </div>
  );
}
