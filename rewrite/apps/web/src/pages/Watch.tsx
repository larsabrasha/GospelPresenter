import { useEffect, useState } from 'react';
import { resolveTheme, type PublicSlide } from '@gp/core';
import { followStream } from '../live/watch-stream.ts';
import { t } from '../i18n.ts';
import { creditsCss, mainCss, stageCss } from '../themes.ts';

type State = { kind: 'waiting' } | { kind: 'slide'; slide: PublicSlide } | { kind: 'full' } | { kind: 'not-found' };

/** The tab's viewer id (LIVE-R36): 16 hex characters, kept for the tab, so a reload is counted once. */
function viewerId(): string {
  const key = 'watch-viewer-id';
  try {
    const known = sessionStorage.getItem(key);
    if (known && /^[0-9a-f]{16}$/.test(known)) return known;
    const made = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(key, made);
    return made;
  } catch {
    return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

/** LIVE-R31: sized from the viewport, never larger than the theme's own size. */
function fluid(size: number, min: number): string {
  return `clamp(${min}px, min(${((size / 1920) * 100 * 1.6).toFixed(3)}vw, ${((size / 1080) * 100).toFixed(3)}vh), ${size}px)`;
}

/** An overlay's text (spec 04 §6): centred near the top, 60 % white, sized like the credits. */
function PublicOverlay({ text }: { text: string | null }) {
  return text ? (
    <div className="watch-overlay" data-testid="watch-overlay" style={{ fontSize: fluid(40, 11) }}>
      {text}
    </div>
  ) : null;
}

function PublicSlideView({ code, slide }: { code: string; slide: PublicSlide }) {
  const theme = resolveTheme(slide.themeId, null);
  if (slide.kind === 'media') {
    return (
      <div className="watch-slide" style={stageCss(theme, 'media')}>
        {slide.image && <img className="watch-image" src={`/api/watch/${encodeURIComponent(code)}/image/${slide.image}`} alt="" data-testid="watch-image" />}
        <PublicOverlay text={slide.overlay} />
      </div>
    );
  }
  const main = mainCss(theme, slide.kind);
  const credits = creditsCss(theme, slide.kind);
  return (
    <div className="watch-slide" style={stageCss(theme, slide.kind)} data-testid="watch-slide" data-theme={theme.id}>
      <div className="watch-text" data-testid="watch-text" style={{ ...main, fontSize: fluid(Number.parseFloat(String(main.fontSize)), 18) }}>
        {slide.verses
          ? slide.verses.map((v, i) => (
              <span key={i}>
                {i > 0 && ' '}
                {v.n !== null && <sup className="verse-number">{v.n}</sup>}
                {v.n !== null && ' '}
                {v.t}
              </span>
            ))
          : slide.text}
      </div>
      {slide.credits && (
        <div className="watch-credits" style={{ ...credits, fontSize: fluid(Number.parseFloat(String(credits.fontSize)), 11) }}>
          {slide.credits}
        </div>
      )}
      <PublicOverlay text={slide.overlay} />
    </div>
  );
}

/**
 * A public output (spec 04 §6): anonymous, no database. It never shows a
 * blank page: before the first slide and while black it shows the waiting
 * screen. When the connection drops, the last slide stays (spec 04: public
 * outputs freeze, never blank) while it reconnects (`followStream`).
 */
export function Watch({ code }: { code: string }) {
  const [state, setState] = useState<State>({ kind: 'waiting' });
  const [names, setNames] = useState<{ orgName: string; outputName: string } | null>(null);

  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.append(robots);
    const stop = followStream(
      `/api/watch/${encodeURIComponent(code)}/stream?v=${viewerId()}`,
      {
        event: (m) => {
          if (m.type === 'meta') {
            setNames({ orgName: m.orgName, outputName: m.outputName });
            document.title = m.orgName || 'Gospel Presenter';
          } else if (m.type === 'slide') setState({ kind: 'slide', slide: m.slide });
          else if (m.type === 'idle') setState({ kind: 'waiting' });
          else setState({ kind: 'full' });
        },
        notFound: () => setState({ kind: 'not-found' }),
      },
      {
        open: (url) => new EventSource(url),
        exists: () => fetch(`/api/watch/${encodeURIComponent(code)}/exists`).then((r) => r.status, () => null),
        later: (fn, ms) => setTimeout(fn, ms),
      },
    );
    return () => {
      stop();
      robots.remove();
    };
  }, [code]);

  if (state.kind === 'slide') return <PublicSlideView code={code} slide={state.slide} />;
  return (
    <div className="watch-waiting" data-testid="watch-waiting">
      {state.kind === 'waiting' && (
        <>
          <div className="watch-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="watch-name">{names?.outputName || names?.orgName}</p>
          <p>{t('watch.waiting')}</p>
        </>
      )}
      {state.kind === 'full' && <p>{t('watch.full')}</p>}
      {state.kind === 'not-found' && <p>{t('watch.notFound')}</p>}
    </div>
  );
}
