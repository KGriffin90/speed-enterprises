'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';

/**
 * Hero background that cycles through several full-bleed stills with a gentle
 * crossfade while each image slowly zooms and pans (a Ken Burns drift), so the
 * stack reads like slow aerial drone footage. All images are stacked and only
 * the active one is opaque; a single source gets the drift but never advances.
 *
 * Hidden under prefers-reduced-motion via the parent `.hero-media` wrapper
 * (globals.css), so the static washed `--hero-image` shows instead.
 */
export function HeroImageRotator({
  sources,
  intervalMs = 6000,
}: {
  sources: string[];
  intervalMs?: number;
}): JSX.Element {
  const [active, setActive] = useState(0);

  // Advance to the next still on a fixed cadence; the crossfade itself is the
  // per-image opacity transition below.
  useEffect(() => {
    if (sources.length < 2) return;
    const id = setInterval(
      () => setActive(i => (i + 1) % sources.length),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [sources, intervalMs]);

  return (
    <>
      {sources.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          className="hero-pan absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: i === active ? 1 : 0,
            transition: 'opacity 1600ms ease-in-out',
            // Offset each image's drift so the stack isn't all at one phase.
            animationDelay: `${i * -4000}ms`,
          }}
        />
      ))}
    </>
  );
}
