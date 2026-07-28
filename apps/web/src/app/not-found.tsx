import Link from 'next/link';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="max-w-xl mx-auto px-6 py-24 text-center">
      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--brand-500)' }}>
        404
      </p>
      <h1 className="text-3xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
        Page not found
      </h1>
      <p className="mt-3" style={{ color: 'var(--ink-700)' }}>
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn-primary px-6 py-3">Back to home</Link>
        <Link href="/quote/new" className="btn-secondary px-6 py-3">Get a Free Quote</Link>
      </div>
    </div>
  );
}
