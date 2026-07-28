'use client';

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * Hero background that cycles through several muted, looping clips with a
 * gentle crossfade. All clips are stacked and preloaded; only the active one
 * plays — when it ends we advance to the next and fade between them. A single
 * source just loops natively.
 *
 * Hidden under prefers-reduced-motion via the parent `.hero-media` wrapper
 * (globals.css), so the static washed `--hero-image` shows instead.
 */
export function HeroVideoRotator({
  sources,
  poster,
}: {
  sources: string[];
  poster?: string;
}): JSX.Element {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLVideoElement | null>>([]);
  const single = sources.length === 1;

  // Play the active clip from its start; pause the rest. Runs on the initial
  // mount (autoplay) and on every advance.
  useEffect(() => {
    sources.forEach((_, i) => {
      const v = refs.current[i];
      if (!v) return;
      if (i === active) {
        v.currentTime = 0;
        // Muted autoplay is permitted; if the browser still blocks it the
        // poster (and washed --hero-image behind) remain visible.
        void v.play().catch(() => undefined);
      } else {
        v.pause();
      }
    });
  }, [active, sources]);

  return (
    <>
      {sources.map((src, i) => (
        <video
          key={src}
          ref={el => { refs.current[i] = el; }}
          muted
          playsInline
          loop={single}
          preload="auto"
          poster={poster}
          onEnded={single ? undefined : () => setActive(j => (j + 1) % sources.length)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: i === active ? 1 : 0,
            transition: 'opacity 1600ms ease-in-out',
          }}
        >
          <source src={src} type="video/mp4" />
        </video>
      ))}
    </>
  );
}
