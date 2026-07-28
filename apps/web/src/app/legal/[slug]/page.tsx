import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEGAL_DOCS } from '@/content/legal/config';
import { loadLegalDoc, isLegalSlug } from '@/content/legal/load';
import { LegalMarkdown } from '@/components/LegalMarkdown';

export function generateStaticParams() {
  return LEGAL_DOCS.map(d => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const doc = LEGAL_DOCS.find(d => d.slug === params.slug);
  if (!doc) return { title: 'Legal' };
  return { title: doc.title, description: doc.summary };
}

export default async function LegalDocPage({ params }: { params: { slug: string } }): Promise<JSX.Element> {
  if (!isLegalSlug(params.slug)) notFound();
  const doc = LEGAL_DOCS.find(d => d.slug === params.slug)!;
  const markdown = await loadLegalDoc(params.slug);

  return (
    <div className="section py-14 max-w-3xl">
      <Link href="/legal" className="inline-flex items-center gap-1.5 text-sm mb-8 transition-opacity hover:opacity-70" style={{ color: 'var(--ink-500)' }}>
        <span aria-hidden>←</span> All legal documents
      </Link>
      <article
        className="rounded-2xl p-7 md:p-10"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--surface-200)' }}
      >
        <LegalMarkdown markdown={markdown} />
      </article>
      <p className="text-xs mt-6 text-center" style={{ color: 'var(--ink-300)' }}>
        Looking for another document? See the{' '}
        <Link href="/legal" className="underline" style={{ color: 'var(--brand-600)' }}>legal index</Link>.
      </p>
    </div>
  );
}
