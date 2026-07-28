import { apiServer } from '@/lib/server-auth';
import { ProfileForm } from './ProfileForm';
import { PasswordForm } from './PasswordForm';

interface ProfilePayload {
  user: { id: string; email: string; platformRole: string; emailVerifiedAt: string | null; createdAt: string };
  profile: { fullName: string; phone: string; addressLine: string | null; city: string | null; state: string | null; postalCode: string | null; marketingConsent: boolean } | null;
  membership: { role: string; createdAt: string } | null;
}

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const me = await apiServer<ProfilePayload>('GET', '/api/me/profile');
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Account</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-500)' }}>
          Signed in as <span style={{ color: 'var(--ink-900)' }}>{me.user.email}</span>
          {me.membership ? ` · ${me.membership.role.toLowerCase()}` : ''}
        </p>
      </div>

      <ProfileForm initial={me.profile} />
      <PasswordForm />
    </div>
  );
}
