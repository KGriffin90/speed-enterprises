import { apiServer, requireTenantRole } from '@/lib/server-auth';
import type { BusinessConfig } from '@speed-enterprises/shared';
import { SettingsForm } from './SettingsForm';
import { PaymentsForm } from './PaymentsForm';

export const metadata = { title: 'Admin · Settings' };

export default async function AdminSettings() {
  requireTenantRole('OWNER');
  const cfg = await apiServer<BusinessConfig>('GET', '/api/me/config');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Settings</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-500)' }}>
          Changes go live immediately across all tenant pages.
        </p>
      </div>
      <SettingsForm cfg={cfg} />
      <PaymentsForm cfg={cfg} />
    </div>
  );
}
