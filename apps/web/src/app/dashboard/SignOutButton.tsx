'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { clearSession, getRefreshToken } from '@/lib/auth';

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    const refreshToken = getRefreshToken();
    if (refreshToken) { try { await api('POST', '/api/auth/logout', { refreshToken }); } catch {} }
    clearSession();
    // Return to the tenant's storefront home, not the sign-in screen.
    router.push('/');
    router.refresh();
  }
  return (
    <button onClick={signOut} className="text-sm" style={{ color: 'var(--ink-500)' }}>
      Sign out
    </button>
  );
}
