import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { RouteTimeline, type RouteDetail } from './RouteTimeline';
import { RouteActions } from './RouteActions';

export const metadata = { title: 'Admin · Route' };
export const dynamic = 'force-dynamic';

export default async function RouteDetailPage({ params }: { params: { id: string } }): Promise<JSX.Element> {
  requireTenantRole('OWNER');
  const route = await apiServer<RouteDetail>('GET', `/api/admin/routes/${params.id}`).catch(() => null);
  if (!route) notFound();

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/routes" className="link text-sm">← Routes</Link>
        <RouteActions routeId={params.id} name={route.name} />
      </div>
      <RouteTimeline initial={route} routeId={params.id} />
    </div>
  );
}
