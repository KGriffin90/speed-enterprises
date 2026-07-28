import Link from 'next/link';
import { loadTenantConfig } from '@/lib/tenant';

export const metadata = { title: 'Request received' };

export default async function Thanks({ searchParams }: { searchParams: { id?: string } }) {
  const cfg = await loadTenantConfig().catch(() => null);
  return (
    <div className="max-w-xl mx-auto px-6 py-16 text-center">
      <div className="card p-10">
        <div className="text-5xl">✓</div>
        <h1 className="mt-4 text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
          Thanks — we've got it
        </h1>
        <p className="mt-3" style={{ color: 'var(--ink-700)' }}>
          {cfg
            ? <>Our team at <strong>{cfg.businessName}</strong> is reviewing your request. You'll get a custom estimate within 1–2 business days.</>
            : 'Your request has been submitted.'}
        </p>
        {searchParams.id && (
          <p className="mt-4 text-xs" style={{ color: 'var(--ink-500)' }}>
            Reference: <span className="font-mono">{searchParams.id}</span>
          </p>
        )}
        <div className="mt-8">
          <Link href="/" className="btn-primary">Back to {cfg?.businessName ?? 'home'}</Link>
        </div>
      </div>
    </div>
  );
}
