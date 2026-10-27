import { useLayoutEffect, useRef, useState } from 'react';
import { CANVAS, CLASSIC, type Slide, type Theme } from '@gp/core';
import { useBlobUrl } from '../db/react.tsx';
import type { ShownOverlay } from '../db/queries.ts';
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

/** A media slide's picture, contained within the stage over the theme's media background. Nothing until this device has the blob. */
function SlideImage({ hash }: { hash: string }) {
  const url = useBlobUrl(hash);
  return url ? <img className="slide-image" src={url} alt="" data-testid="slide-image" draggable={false} /> : null;
}

/**
 * An overlay above the slide (LIVE-R15): its picture over the whole stage,
 * contained, and its text at the top left. Outside the theme.
 */
function OverlayLayer({ overlay }: { overlay: ShownOverlay }) {
  const url = useBlobUrl(overlay.imageHash);
  return (
    <div className="slide-overlay" data-testid="slide-overlay">
      {url && <img className="slide-overlay-image" src={url} alt="" draggable={false} />}
      {overlay.content && <div className="slide-overlay-text">{overlay.content}</div>}
    </div>
  );
}

/**
 * One slide on a fixed 1920×1080 stage, scaled to fit its container (ADR 0007,
 * decision 8), styled by `theme` (spec 05, THEME-R9). The same component draws
 * previews, thumbnails and the output, so they always agree. `slide` null
 * draws an empty stage: black, whatever the theme, as the black screen must
 * be. The part label is for the operator: tiles show it, outputs never do (LIVE-R20). The stage view draws its preview without credits (spec 04 §3).
 * `overlay` is drawn above the slide, also when no slide is selected.
 */
export function SlideView({
  slide,
  theme = CLASSIC,
  label = true,
  credits = true,
  overlay = null,
}: {
  slide: Slide | null;
  theme?: Theme;
  label?: boolean;
  credits?: boolean;
  overlay?: ShownOverlay | null;
}) {
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
              <span className="absolute top-6 right-10 z-[1] rounded-full px-8 py-1 font-sans text-[48px]/[1.5] font-semibold text-white" style={{ background: slide.label.color }}>
                {slide.label.text}
              </span>
            )}
            {slide.kind === 'media' ? (
              slide.image && <SlideImage hash={slide.image} />
            ) : (
              <>
                <div className="slide-content">
                  <div className="slide-text" data-testid="slide-text" style={mainCss(theme, slide.kind)}>
                    {slide.verses ? <BibleText slide={slide} /> : slide.text}
                  </div>
                </div>
                {credits && slide.credits && (
                  <div className="slide-credits" data-testid="slide-credits" style={creditsCss(theme, slide.kind)}>
                    {slide.credits}
                  </div>
                )}
              </>
            )}
          </>
        )}
        {overlay && <OverlayLayer overlay={overlay} />}
      </div>
    </div>
  );
}
