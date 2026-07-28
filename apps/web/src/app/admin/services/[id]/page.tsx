import { apiServer, requireTenantRole } from '@/lib/server-auth';
import { ServiceEditor } from './ServiceEditor';

interface ServiceDetail {
  id: string; slug: string; name: string; description: string;
  category: string; pricingMode: string; basePriceCents: number;
  active: boolean; visibleOnPublicSite: boolean;
  estimatedDurationMinutes: number | null;
  requiresOnsiteEstimate: boolean;
  questions: any[];
  pricingRules: any[];
}

export const metadata = { title: 'Admin · Edit service' };

export default async function EditServicePage({ params }: { params: { id: string } }) {
  requireTenantRole('OWNER');
  const service = await apiServer<ServiceDetail>('GET', `/api/services/${params.id}`);
  return (
    <div className="max-w-5xl">
      <ServiceEditor service={service} />
    </div>
  );
}
