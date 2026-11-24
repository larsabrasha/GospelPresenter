import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Css } from '@gp/core';

/** The smallest a text is made, of its theme's size: below it, it is clipped as before (ADR 0001 (8)). */
const MIN_SCALE = 0.35;

/**
 * A slide's main text at its theme's size, made smaller until it fits its box where it is too tall (docs/themes.md:
 * the theme's size is the most it gets, as ADR 0001 (8) foresaw). Measured in the stage's own pixels, so a tile and
 * the output make it the same size; again when the fonts have loaded, as a wider face wraps sooner. After every render:
 * a text that fits costs one measure.
 */
export function FittedText({ css, children }: { css: Css; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const base = parseFloat(String(css.fontSize));
  useLayoutEffect(() => {
    const el = ref.current!;
    const box = el.parentElement!;
    const fits = () => el.offsetHeight <= box.clientHeight + 1;
    const fit = () => {
      el.style.fontSize = `${base}px`;
      if (fits()) return;
      let [lo, hi] = [MIN_SCALE, 1];
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${base * mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${Math.floor(base * lo)}px`;
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
    };
  });
  return (
    <div ref={ref} className="slide-text" data-testid="slide-text" style={css}>
      {children}
    </div>
  );
}
