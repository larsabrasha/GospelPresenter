import { useLayoutEffect, useRef, useState } from 'react';
import type { Slide } from '@gp/core';

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/**
 * One slide on a fixed 1920×1080 stage, scaled to fit its container (ADR 0007,
 * decision 8). The same component draws previews, thumbnails and the output,
 * so they always agree. `slide` null draws an empty (black) stage.
 */
export function SlideView({ slide }: { slide: Slide | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => setScale(Math.min(el.clientWidth / STAGE_WIDTH, el.clientHeight / STAGE_HEIGHT));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="slide-box">
      <div className="slide-stage" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }} data-testid="slide-stage">
        {slide && (
          <>
            {slide.label && (
              <span className="slide-label" style={{ background: slide.label.color }}>
                {slide.label.text}
              </span>
            )}
            <div className="slide-text" data-testid="slide-text">
              {slide.text}
            </div>
            {slide.credits && <div className="slide-credits">{slide.credits}</div>}
          </>
        )}
      </div>
    </div>
  );
}
