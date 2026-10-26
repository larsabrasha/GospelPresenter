import { useLayoutEffect, useRef, useState } from 'react';
import { CANVAS, CLASSIC, type Slide, type Theme } from '@gp/core';
import { creditsCss, mainCss, stageCss } from '../themes.ts';

export const STAGE_WIDTH = CANVAS.width;
export const STAGE_HEIGHT = CANVAS.height;

/** A Bible slide's text: each verse number small and faint, held to its first word (spec 05). */
function BibleText({ slide }: { slide: Slide }) {
  return (
    <>
      {slide.verses!.map((seg, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {seg.n !== null && (
            <>
              <sup className="verse-number">{seg.n}</sup>
              {' '}
            </>
          )}
          {seg.t}
        </span>
      ))}
    </>
  );
}

/**
 * One slide on a fixed 1920×1080 stage, scaled to fit its container (ADR 0007,
 * decision 8), styled by `theme` (spec 05, THEME-R9). The same component draws
 * previews, thumbnails and the output, so they always agree. `slide` null
 * draws an empty stage: black, whatever the theme, as the black screen must
 * be. The part label is for the operator: tiles show it, outputs never do (LIVE-R20).
 */
export function SlideView({ slide, theme = CLASSIC, label = true }: { slide: Slide | null; theme?: Theme; label?: boolean }) {
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
  const style = { width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})`, ...(slide ? stageCss(theme, slide.kind) : {}) };
  return (
    <div ref={box} className="slide-box">
      <div className="slide-stage" style={style} data-testid="slide-stage" data-theme={slide ? theme.id : undefined} data-kind={slide?.kind}>
        {slide && (
          <>
            {label && slide.label && (
              <span className="slide-label" style={{ background: slide.label.color }}>
                {slide.label.text}
              </span>
            )}
            <div className="slide-content">
              <div className="slide-text" data-testid="slide-text" style={mainCss(theme, slide.kind)}>
                {slide.verses ? <BibleText slide={slide} /> : slide.text}
              </div>
            </div>
            {slide.credits && (
              <div className="slide-credits" data-testid="slide-credits" style={creditsCss(theme, slide.kind)}>
                {slide.credits}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
