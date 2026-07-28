import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { RouteBuilder, type RouteInitial } from '../../new/RouteBuilder';
import type { RouteDetail } from '../RouteTimeline';

export const metadata = { title: 'Admin · Edit route' };
export const dynamic = 'force-dynamic';

interface Member { id: string; fullName: string | null; user: { email: string }; active: boolean; role: string }

export default async function EditRoutePage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  requireTenantRole('OWNER');

  const [route, members] = await Promise.all([
    apiServer<RouteDetail>('GET', `/api/admin/routes/${params.id}`).catch(() => null),
    apiServer<Member[]>('GET', '/api/me/team').catch(() => [] as Member[]),
  ]);
  if (!route) notFound();

  const staff = members
    .filter(m => m.active && m.role !== 'CUSTOMER')
    .map(m => ({ id: m.id, name: m.fullName ?? m.user.email }));

  const initial: RouteInitial = {
    id: route.id,
    name: route.name,
    plannedForDate: route.plannedForDate,
    membershipIds: (route.crew && route.crew.length > 0)
      ? route.crew.map(c => c.membershipId)
      : [],
    stops: route.stops.map(s => ({
      label: s.label,
      addressLine: s.addressLine ?? '',
      city: s.city ?? '',
      state: s.state ?? '',
      postalCode: s.postalCode ?? '',
    })),
    lockStructure: route.status !== 'PLANNED',
  };

  return (
    <div className="max-w-2xl">
      <Link href={`/admin/routes/${route.id}`} className="link text-sm">← Back to route</Link>
      <h1 className="mt-3 mb-6 text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Edit route</h1>
      <RouteBuilder staff={staff} initial={initial} />
    </div>
  );
}
