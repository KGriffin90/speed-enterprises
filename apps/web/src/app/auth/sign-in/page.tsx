import type { JSX } from 'react';
import Link from 'next/link';
import { loadTenantConfig } from '@/lib/tenant';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { tenant?: string; next?: string };
}): Promise<JSX.Element> {
  const explicitSlug = searchParams.tenant ?? null;
  const next = searchParams.next ?? '';

  const cfg = await loadTenantConfig().catch(() => null);
  const tenantSlug = explicitSlug ?? cfg?.slug ?? null;
  const businessName = cfg?.businessName ?? tenantSlug ?? null;

  const signUpHref = next
    ? `/auth/sign-up?next=${encodeURIComponent(next)}`
    : '/auth/sign-up';

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
          Welcome back{businessName ? ` to ${businessName}` : ''}
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-500)' }}>
          Sign in to track your quotes and book service.
        </p>
        <div className="mt-6">
          <SignInForm tenantSlug={tenantSlug} />
        </div>
        <div className="mt-6 text-sm flex items-center justify-between">
          <Link href="/auth/forgot-password" className="link">Forgot password?</Link>
          <span style={{ color: 'var(--ink-500)' }}>
            No account?{' '}
            <Link href={signUpHref} className="link">Create one</Link>
          </span>
        </div>
      </div>
    </div>
  );
}
