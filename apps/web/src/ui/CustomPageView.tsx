import type { CSSProperties, ReactNode } from 'react';
import { CANVAS, type CustomElement, type CustomPage, type Theme } from '@gp/core';
import { useLocalUrl } from '../db/react.tsx';
import { mainCss } from '../themes.ts';
import { elementTextCss } from './customText.ts';
import { shapePoints } from './shapePoints.ts';

// A slideshow's page on the 1920×1080 stage (docs/custom-slides.md): what is not set follows the theme, the text
// colour and font of its song slides, and the stage under the page is the theme's background. A PDF's page is a
// picture under the elements.

interface PictureLook {
  style: CSSProperties;
  id?: string;
  fit?: 'contain' | 'cover';
  /** Its pixels not see-through in this colour: the colour, cut out by the picture as a mask. */
  tint?: string | null;
}

function PictureAt({ url, style, id, fit = 'contain', tint }: PictureLook & { url: string | null }) {
  if (!url) return <div style={style} data-element={id} />;
  if (!tint) return <img src={url} alt="" draggable={false} style={{ ...style, objectFit: fit }} data-element={id} />;
  const mask = { image: `url("${url}")`, size: fit, position: 'center', repeat: 'no-repeat' } as const;
  return (
    <div
      data-element={id}
      style={{
        ...style,
        backgroundColor: tint,
        maskImage: mask.image,
        maskSize: mask.size,
        maskPosition: mask.position,
        maskRepeat: mask.repeat,
        // Safari before 15.4 knows the mask only by its prefix.
        WebkitMaskImage: mask.image,
        WebkitMaskSize: mask.size,
        WebkitMaskPosition: mask.position,
        WebkitMaskRepeat: mask.repeat,
      }}
    />
  );
}

/** A picture of Bilder from this device: its full copy, else its thumbnail. */
function BlobPagePicture({ hash, thumb, ...look }: PictureLook & { hash: string; thumb: string }) {
  const full = useLocalUrl(hash);
  const small = useLocalUrl(full || thumb === hash ? null : thumb);
  return <PictureAt url={full ?? small ?? null} {...look} />;
}

/**
 * A picture of Bilder: this device's, or, on a page with no database (a paired screen),
 * `media`'s URL, read with no hook of the database, which such a page lacks (SlideView's `Picture` does the same).
 */
function PagePicture({ hash, thumb, media, ...look }: PictureLook & { hash: string; thumb: string; media?: (hash: string) => string }) {
  if (!media) return <BlobPagePicture hash={hash} thumb={thumb} {...look} />;
  return <PictureAt url={media(hash)} {...look} />;
}

/** Where an element sits: its box, and a line's from its start to its end, whichever way it runs. */
function elementBox(e: CustomElement): CSSProperties {
  return { position: 'absolute', left: Math.min(e.x, e.x + e.w), top: Math.min(e.y, e.y + e.h), width: Math.abs(e.w), height: Math.abs(e.h) };
}

function Element({ e, theme, media, placeholder }: { e: CustomElement; theme: Theme; media?: (hash: string) => string; placeholder?: string }): ReactNode {
  const box = elementBox(e);
  // A newer app's element: nothing on an output; in the editor a box saying so, as it is kept and can be moved.
  if (e.kind === 'unknown')
    return placeholder ? (
      <div data-element={e.id} style={{ ...box, boxSizing: 'border-box', border: '4px dashed rgb(120 113 108)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, color: 'rgb(120 113 108)', fontSize: 40, textAlign: 'center', background: 'rgb(120 113 108 / 0.15)' }}>
        {placeholder}
      </div>
    ) : null;
  if (e.kind === 'text') {
    // As tall as its words at least, as Keynote's text box: a larger size grows the box with the text, so the box and
    // its handles stay round the words and a tap on them picks it (Lars, 2026-11-26). The words start at its top either way.
    // Its least height no more than to the slide's foot, so a box made taller once does not reach past it.
    const { height, top, ...rest } = box as CSSProperties & { height: number; top: number };
    return (
      <div
        data-element={e.id}
        style={{
          ...rest,
          top,
          minHeight: Math.max(0, Math.min(height, CANVAS.height - top)),
          ...elementTextCss(e, theme),
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      >
        {e.text}
      </div>
    );
  }
  if (e.kind === 'image') {
    return <PagePicture id={e.id} hash={e.picture.full} thumb={e.picture.thumb} media={media} style={box} fit={e.fit} tint={e.tint} />;
  }
  if (e.kind === 'line') {
    const { left, top, width, height } = box as { left: number; top: number; width: number; height: number };
    // Drawn from its start to its end inside its box, with room for its width on every side.
    const pad = e.strokeWidth;
    return (
      <svg data-element={e.id} style={{ position: 'absolute', left: left - pad, top: top - pad, width: width + 2 * pad, height: height + 2 * pad, overflow: 'visible' }}>
        <line
          x1={e.x - left + pad}
          y1={e.y - top + pad}
          x2={e.x + e.w - left + pad}
          y2={e.y + e.h - top + pad}
          stroke={e.stroke ?? String(mainCss(theme, 'song').color)}
          strokeWidth={e.strokeWidth}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (e.kind === 'triangle' || e.kind === 'arrow') {
    const { width, height } = box as { width: number; height: number };
    // Its outline on its edge, half outside it, as a line's; the corners rounded a little.
    return (
      <svg data-element={e.id} viewBox={`0 0 ${width} ${height}`} style={{ ...box, overflow: 'visible' }}>
        <polygon
          points={shapePoints(e.kind, width, height, e.direction)}
          fill={e.fill ?? 'none'}
          stroke={e.stroke && e.strokeWidth ? e.stroke : 'none'}
          strokeWidth={e.strokeWidth}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <div
      data-element={e.id}
      style={{
        ...box,
        boxSizing: 'border-box',
        background: e.fill ?? 'transparent',
        border: e.stroke && e.strokeWidth ? `${e.strokeWidth}px solid ${e.stroke}` : undefined,
        borderRadius: e.kind === 'ellipse' ? '50%' : e.radius,
      }}
    />
  );
}

/** The page's own background, its elements in drawing order, and `children` above them (the editor's handles). */
export function CustomPageView({
  page,
  theme,
  media,
  hide,
  placeholder,
  children,
}: {
  page: CustomPage;
  theme: Theme;
  media?: (hash: string) => string;
  hide?: string;
  /** The editor's: an element of a kind not known here drawn as a box saying this, not as nothing. */
  placeholder?: string;
  children?: ReactNode;
}) {
  const background = page.backgroundPicture;
  return (
    <div className="absolute inset-0 overflow-hidden" style={page.background ? { background: page.background } : undefined} data-testid="custom-page">
      {background && <PagePicture hash={background.full} thumb={background.thumb} media={media} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} fit="cover" />}
      {/* A PDF's page, fitted as it was rendered (to 1920×1080), on the page's background. */}
      {page.backgroundPage && (
        <PagePicture hash={page.backgroundPage.full} thumb={page.backgroundPage.thumb} media={media} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} fit="contain" />
      )}
      {/* `hide`: the text the editor writes over (pages/custom-slides/EditorCanvas.tsx). */}
      {page.elements.map((e) => (e.id === hide ? null : <Element key={e.id} e={e} theme={theme} media={media} placeholder={placeholder} />))}
      {children}
    </div>
  );
}
