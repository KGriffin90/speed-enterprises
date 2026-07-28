import type { JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders a legal document's markdown into themed HTML. Server component — the
 * markdown is provided as a prop already resolved from disk with placeholders
 * filled (see content/legal/load.ts).
 */
export function LegalMarkdown({ markdown }: { markdown: string }): JSX.Element {
  return (
    <div className="legal-prose" style={{ color: 'var(--ink-700)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-3xl font-extrabold mt-0 mb-6" style={{ color: 'var(--ink-900)' }}>{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold mt-10 mb-3 pb-2" style={{ color: 'var(--ink-900)', borderBottom: '1px solid var(--surface-200)' }}>{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-bold mt-6 mb-2" style={{ color: 'var(--ink-900)' }}>{children}</h3>,
          h4: ({ children }) => <h4 className="text-base font-semibold mt-4 mb-1.5" style={{ color: 'var(--ink-900)' }}>{children}</h4>,
          p:  ({ children }) => <p className="text-sm leading-relaxed my-3">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1.5 text-sm leading-relaxed">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1.5 text-sm leading-relaxed">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a:  ({ href, children }) => (
            <a href={href} className="font-medium underline" style={{ color: 'var(--brand-600)' }}>{children}</a>
          ),
          strong: ({ children }) => <strong className="font-semibold" style={{ color: 'var(--ink-900)' }}>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          hr: () => <hr className="my-8" style={{ border: 0, borderTop: '1px solid var(--surface-200)' }} />,
          blockquote: ({ children }) => (
            <blockquote
              className="my-4 pl-4 py-1 text-sm"
              style={{ borderLeft: '3px solid var(--brand-400)', background: 'var(--surface-100)', color: 'var(--ink-700)' }}
            >
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="px-1.5 py-0.5 rounded text-[0.8em]" style={{ background: 'var(--surface-100)', color: 'var(--ink-900)' }}>{children}</code>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full text-sm border-collapse" style={{ border: '1px solid var(--surface-200)' }}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead style={{ background: 'var(--surface-100)' }}>{children}</thead>,
          th: ({ children }) => <th className="text-left font-semibold p-2.5" style={{ border: '1px solid var(--surface-200)', color: 'var(--ink-900)' }}>{children}</th>,
          td: ({ children }) => <td className="p-2.5 align-top" style={{ border: '1px solid var(--surface-200)' }}>{children}</td>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
