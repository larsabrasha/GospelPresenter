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

/** Where a picture comes from: this device's blob (nothing until it has it), or, on a page with no database (a paired screen), the URL `media` gives. */
type Media = ((hash: string) => string) | undefined;

function BlobPicture({ hash, className, testId }: { hash: string | null; className: string; testId?: string }) {
  const url = useBlobUrl(hash);
  return url ? <img className={className} src={url} alt="" data-testid={testId} draggable={false} /> : null;
}

function Picture({ hash, media, className, testId }: { hash: string | null; media: Media; className: string; testId?: string }) {
  if (!media) return <BlobPicture hash={hash} className={className} testId={testId} />;
  return hash ? <img className={className} src={media(hash)} alt="" data-testid={testId} draggable={false} /> : null;
}

/**
 * An overlay above the slide (LIVE-R15): its picture over the whole stage,
 * contained, and its text at the top left. Outside the theme.
 */
function OverlayLayer({ overlay, media }: { overlay: ShownOverlay; media: Media }) {
  return (
    <div className="slide-overlay" data-testid="slide-overlay">
      <Picture hash={overlay.imageHash} media={media} className="slide-overlay-image" testId="slide-overlay-image" />
      {overlay.content && <div className="slide-overlay-text">{overlay.content}</div>}
    </div>
  );
}

/**
 * One slide on a fixed 1920×1080 stage, scaled to fit its container (ADR 0007,
 * decision 8), and centred in a box that is not 16:9, as the output window
 * often is (Slide.razor), styled by `theme` (spec 05, THEME-R9). The same component draws
 * previews, thumbnails and the output, so they always agree. `slide` null
 * draws an empty stage: black, whatever the theme, as the black screen must
 * be. The part label is for the operator: tiles show it, outputs never do (LIVE-R20). The stage view draws its preview without credits (spec 04 §3).
 * `overlay` is drawn above the slide, also when no slide is selected.
 * `media` gives a picture's URL on a page with no database (a paired screen).
 */
export function SlideView({
  slide,
  theme = CLASSIC,
  label = true,
  credits = true,
  overlay = null,
  media,
}: {
  slide: Slide | null;
  theme?: Theme;
  label?: boolean;
  credits?: boolean;
  overlay?: ShownOverlay | null;
  media?: (hash: string) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, x: 0, y: 0 });
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      const scale = Math.min(el.clientWidth / STAGE_WIDTH, el.clientHeight / STAGE_HEIGHT);
      // Whole pixels, so a 16:9 box (every tile and preview) keeps the stage at its corner.
      setFit({ scale, x: Math.round((el.clientWidth - STAGE_WIDTH * scale) / 2), y: Math.round((el.clientHeight - STAGE_HEIGHT * scale) / 2) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const style = { width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`, ...(slide ? stageCss(theme, slide.kind) : {}) };
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
              slide.image && <Picture hash={slide.image} media={media} className="slide-image" testId="slide-image" />
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
        {overlay && <OverlayLayer overlay={overlay} media={media} />}
      </div>
    </div>
  );
}
