import { useEffect, useState } from 'react';
import { FONT_STACKS, resolveTheme, type Css, type PublicSlide } from '@gp/core';
import { followStream } from '../live/watch-stream.ts';
import { t } from '../i18n.ts';
import { creditsCss, mainCss, stageCss } from '../themes.ts';

type State = { kind: 'waiting' } | { kind: 'slide'; slide: PublicSlide } | { kind: 'full' } | { kind: 'not-found' };

/** The tab's viewer id (LIVE-R36): 16 hex characters, kept for the tab, so a reload is counted once. */
export function viewerId(): string {
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

/** The overlay's text style, outside the theme: the default text style at 40 px (PublicSlideView.razor's OverlayStyle). */
const OVERLAY: Css = { fontFamily: FONT_STACKS.tahoma, fontWeight: 400, lineHeight: 1.4, textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', textShadow: '0 1px 4px rgba(0,0,0,0.6)' };

/** An overlay (spec 04 §6): its picture over the whole page, contained; its text centred near the top, 60 % white, sized like the credits. */
function PublicOverlay({ text }: { text: string | null }) {
  return text ? (
    <div className="absolute inset-0 pointer-events-none z-50">
      <div className="absolute top-[4vh] left-0 right-0 px-[5vw] text-center text-white/60 whitespace-pre-line" data-testid="watch-overlay" style={{ ...OVERLAY, fontSize: fluid(40, 11) }}>
        {text}
      </div>
    </div>
  ) : null;
}

/**
 * A slide sent as data (spec 04 §6), as PublicSlideView.razor: the text
 * reflows in the middle and scrolls when it is taller than the screen, the
 * credits below it; its picture is under
 * `imageBase`, the output's own API path.
 */
export function PublicSlideView({ imageBase, slide }: { imageBase: string; slide: PublicSlide }) {
  const theme = resolveTheme(slide.themeId, null);
  if (slide.kind === 'media') {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden" style={stageCss(theme, 'media')}>
        <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center overflow-hidden">
          {slide.image && <img className="w-full h-full object-contain select-none" src={`${imageBase}/image/${slide.image}`} alt="" data-testid="watch-image" />}
        </div>
        <PublicOverlay text={slide.overlay} />
      </div>
    );
  }
  const main = mainCss(theme, slide.kind);
  const credits = creditsCss(theme, slide.kind);
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={stageCss(theme, slide.kind)} data-testid="watch-slide" data-theme={theme.id}>
      {/* Text taller than the screen scrolls, as PublicSlideView.razor; "safe" keeps its top reachable. */}
      <div className="flex-1 min-w-0 min-h-0 flex items-center-safe justify-center overflow-y-auto" data-testid="watch-text-area">
        <div className="w-full px-[5vw] py-[4vh] break-words whitespace-pre-wrap" data-testid="watch-text" style={{ ...main, fontSize: fluid(Number.parseFloat(String(main.fontSize)), 18) }}>
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
      </div>
      {slide.credits && (
        <div className="shrink-0 px-[5vw] pb-[3vh]" style={{ ...credits, fontSize: fluid(Number.parseFloat(String(credits.fontSize)), 11) }}>
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
          else if (m.type === 'full') setState({ kind: 'full' });
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

  if (state.kind === 'slide') return <PublicSlideView imageBase={`/api/watch/${encodeURIComponent(code)}`} slide={state.slide} />;
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-3 px-8 text-center" data-testid="watch-waiting">
      {state.kind === 'waiting' && (
        <>
          {/* Three pulsing dots, not a signal: that would read as a network to join (PublicWatchPage.razor). */}
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="size-2 rounded-full bg-white/30 animate-pulse" />
            <span className="size-2 rounded-full bg-white/30 animate-pulse [animation-delay:300ms]" />
            <span className="size-2 rounded-full bg-white/30 animate-pulse [animation-delay:600ms]" />
          </div>
          {(names?.outputName || names?.orgName) && <div className="text-white/50 text-lg font-medium">{names?.outputName || names?.orgName}</div>}
          <div className="text-white/30 text-sm">{t('watch.waiting')}</div>
        </>
      )}
      {state.kind === 'full' && <div className="text-white/50 text-sm">{t('watch.full')}</div>}
      {state.kind === 'not-found' && <div className="text-white/50 text-sm">{t('watch.notFound')}</div>}
    </div>
  );
}
