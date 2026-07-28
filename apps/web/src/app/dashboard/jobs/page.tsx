import Link from 'next/link';
import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { StatusPill } from '@/components/StatusPill';
import { JobsView } from './JobsView';
import type { QuoteStatus } from '@speed-enterprises/shared';

export interface JobRow {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  scheduledAt: string | null;
  preferredAt: string | null;
  guestName: string | null;
  guestEmail: string | null;
  addressLine: string;
  city: string;
  state: string;
  service: { name: string };
  user: { email: string; customerProfiles: { fullName: string }[] } | null;
}

export const metadata = { title: 'Jobs' };

export default async function StaffJobs({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; view?: string };
}) {
  requireTenantRole('STAFF');

  const filter = new URLSearchParams();
  if (searchParams.status && searchParams.status !== 'ALL') filter.set('status', searchParams.status);
  if (searchParams.q) filter.set('q', searchParams.q);
  const path = `/api/admin/quotes${filter.toString() ? `?${filter.toString()}` : ''}`;
  const rows = await apiServer<JobRow[]>('GET', path).catch(() => []);

  return (
    <JobsView
      rows={rows}
      defaultView={(searchParams.view as 'list' | 'week') ?? 'list'}
      defaultStatus={searchParams.status ?? 'ALL'}
      defaultQuery={searchParams.q ?? ''}
    />
  );
}
