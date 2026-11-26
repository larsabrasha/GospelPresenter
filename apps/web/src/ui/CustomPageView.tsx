import type { CSSProperties, ReactNode } from 'react';
import { CANVAS, type CustomElement, type CustomPage, type Theme } from '@gp/core';
import { useLocalUrl } from '../db/react.tsx';
import { mainCss } from '../themes.ts';
import { elementTextCss } from './customText.ts';

// A slideshow's page on the 1920×1080 stage (docs/custom-slides.md): what is not set follows the theme, the text
// colour and font of its song slides, and the stage under the page is the theme's background. A PDF's page is a
// picture under the elements.

/** A picture of Bilder from this device: its full copy, else its thumbnail. */
function BlobPagePicture({ hash, thumb, style, id }: { hash: string; thumb: string; style: CSSProperties; id?: string }) {
  const full = useLocalUrl(hash);
  const small = useLocalUrl(full || thumb === hash ? null : thumb);
  const url = full ?? small;
  return url ? <img src={url} alt="" draggable={false} style={style} data-element={id} /> : <div style={style} data-element={id} />;
}

/**
 * A picture of Bilder: this device's, or, on a page with no database (a paired screen),
 * `media`'s URL, read with no hook of the database, which such a page lacks (SlideView's `Picture` does the same).
 */
function PagePicture({ hash, thumb, media, style, id }: { hash: string; thumb: string; media?: (hash: string) => string; style: CSSProperties; id?: string }) {
  if (!media) return <BlobPagePicture hash={hash} thumb={thumb} style={style} id={id} />;
  return <img src={media(hash)} alt="" draggable={false} style={style} data-element={id} />;
}

/** Where an element sits: its box, and a line's from its start to its end, whichever way it runs. */
function elementBox(e: CustomElement): CSSProperties {
  return { position: 'absolute', left: Math.min(e.x, e.x + e.w), top: Math.min(e.y, e.y + e.h), width: Math.abs(e.w), height: Math.abs(e.h) };
}

function Element({ e, theme, media }: { e: CustomElement; theme: Theme; media?: (hash: string) => string }): ReactNode {
  const box = elementBox(e);
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
    return <PagePicture id={e.id} hash={e.picture.full} thumb={e.picture.thumb} media={media} style={{ ...box, objectFit: e.fit }} />;
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
export function CustomPageView({ page, theme, media, hide, children }: { page: CustomPage; theme: Theme; media?: (hash: string) => string; hide?: string; children?: ReactNode }) {
  const background = page.backgroundPicture;
  return (
    <div className="absolute inset-0 overflow-hidden" style={page.background ? { background: page.background } : undefined} data-testid="custom-page">
      {background && <PagePicture hash={background.full} thumb={background.thumb} media={media} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {/* A PDF's page, fitted as it was rendered (to 1920×1080), on the page's background. */}
      {page.backgroundPage && (
        <PagePicture hash={page.backgroundPage.full} thumb={page.backgroundPage.thumb} media={media} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      )}
      {/* `hide`: the text the editor writes over (pages/custom-slides/EditorCanvas.tsx). */}
      {page.elements.map((e) => (e.id === hide ? null : <Element key={e.id} e={e} theme={theme} media={media} />))}
      {children}
    </div>
  );
}
