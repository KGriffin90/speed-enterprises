import type { JSX } from 'react';
import { VerifyForm } from './VerifyForm';

export const metadata = { title: 'Verify email' };

export default function VerifyPage({ searchParams }: { searchParams: { email?: string; token?: string; next?: string } }): JSX.Element {
  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>Check your email</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-500)' }}>
          We sent a 6-digit code to <strong>{searchParams.email ?? 'your email'}</strong>. Enter it below.
        </p>
        <div className="mt-6">
          <VerifyForm
            initialEmail={searchParams.email ?? ''}
            initialToken={searchParams.token ?? ''}
            next={searchParams.next ?? ''}
          />
        </div>
      </div>
    </div>
  );
}
