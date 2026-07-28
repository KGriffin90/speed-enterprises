'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';

// Chat bubble: bottom-6 (1.5rem) + h-14 (3.5rem) + 0.75rem gap = 5.75rem
const BOTTOM_DEFAULT   = '1.75rem';
const BOTTOM_ABOVE_CHAT = '5.75rem';

/** Pass hasChatWidget=true when the chat bubble is also mounted so the
 *  button stacks above it instead of overlapping. */
export function BackToTop({ hasChatWidget = false }: { hasChatWidget?: boolean }): JSX.Element {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() { setVisible(window.scrollY > 320); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      style={{
        position:       'fixed',
        bottom:          hasChatWidget ? BOTTOM_ABOVE_CHAT : BOTTOM_DEFAULT,
        right:           '1.75rem',
        zIndex:          49,
        width:           '2.75rem',
        height:          '2.75rem',
        borderRadius:    'var(--brand-radius)',
        background:      'var(--brand-600)',
        color:           'var(--on-brand)',
        border:          'none',
        cursor:          'pointer',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        boxShadow:       '0 4px 16px rgba(0,0,0,0.18)',
        opacity:          visible ? 1 : 0,
        transform:        visible ? 'translateY(0)' : 'translateY(0.75rem)',
        transition:       'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents:    visible ? 'auto' : 'none',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10l5-5 5 5" />
      </svg>
    </button>
  );
}
