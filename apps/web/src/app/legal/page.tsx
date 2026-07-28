import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_DOCS, LEGAL_PLACEHOLDERS } from '@/content/legal/config';

export const metadata: Metadata = {
  title: 'Legal',
  description: 'Legal documents, policies, and agreements.',
};

const GROUPS: { key: 'everyone' | 'consumers' | 'businesses'; label: string; blurb: string }[] = [
  { key: 'everyone',   label: 'For everyone',        blurb: 'Core policies that apply to all users of the service.' },
  { key: 'consumers',  label: 'For app users',       blurb: 'Terms specific to the mobile application.' },
  { key: 'businesses', label: 'For businesses',      blurb: 'Agreements for trade businesses operating on the platform.' },
];

export default function LegalIndexPage(): JSX.Element {
  return (
    <div className="section py-14 max-w-3xl">
      <h1 className="text-3xl font-extrabold mb-2" style={{ color: 'var(--ink-900)' }}>Legal &amp; Policies</h1>
      <p className="text-sm mb-10" style={{ color: 'var(--ink-500)' }}>
        The documents below govern your use of {LEGAL_PLACEHOLDERS.PLATFORM_NAME}. If you have questions, contact{' '}
        <a href={`mailto:${LEGAL_PLACEHOLDERS.LEGAL_EMAIL}`} className="underline" style={{ color: 'var(--brand-600)' }}>
          {LEGAL_PLACEHOLDERS.LEGAL_EMAIL}
        </a>.
      </p>

      {GROUPS.map(group => {
        const docs = LEGAL_DOCS.filter(d => d.audience === group.key);
        if (docs.length === 0) return null;
        return (
          <section key={group.key} className="mb-10">
            <h2 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--ink-400)' }}>{group.label}</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--ink-400)' }}>{group.blurb}</p>
            <ul className="space-y-2.5">
              {docs.map(doc => (
                <li key={doc.slug}>
                  <Link
                    href={`/legal/${doc.slug}`}
                    className="block rounded-xl p-4 transition-colors hover:bg-[var(--surface-100)]"
                    style={{ border: '1px solid var(--surface-200)', background: 'var(--surface-0)' }}
                  >
                    <span className="block font-semibold text-sm" style={{ color: 'var(--ink-900)' }}>{doc.title}</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-500)' }}>{doc.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
