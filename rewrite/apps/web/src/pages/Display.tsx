import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveTheme, type Canvas } from '@gp/core';
import { canPlayVideo } from '../media/video.ts';
import { FollowingVideo } from '../ui/FollowingVideo.tsx';
import { followStream } from '../live/watch-stream.ts';
import { t } from '../i18n.ts';
import { LogoIcon } from '../ui/icons.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { askFullScreen } from '../ui/fullScreen.ts';
import { viewerId } from './Watch.tsx';

// A paired screen (spec 04 §5): a TV or a PC that shows a session, with no
// database and no sign-in. A saved screen opens `/display?id={code}`; a
// temporary one opens `/display`, shows a code until an operator pairs it,
// and starts again with a new code when it is let go. Like every output it
// shows no error or reconnection screen (LIVE-R33): what was there stays.
// Bound to a session it draws the projector's canvas, as the output window
// does (Display.razor renders LiveDisplay), from the canvas the server sends.

/** `offset`: the server's clock less this page's, from the moment the canvas came, for a video's `at`. */
type Shown = { kind: 'idle' } | { kind: 'canvas'; canvas: Canvas | null; offset: number };

const SCREEN_KEY = 'ad-hoc-display-id';
const POLL_MS = 3000;

/** The id also kept in memory: a TV browser without storage would otherwise make a new screen, and show a new code, on every poll. */
let screenInMemory: string | null = null;

function keptScreen(): string | null {
  try {
    return sessionStorage.getItem(SCREEN_KEY) ?? screenInMemory;
  } catch {
    return screenInMemory;
  }
}

function keepScreen(id: string | null) {
  screenInMemory = id;
  try {
    if (id) sessionStorage.setItem(SCREEN_KEY, id);
    else sessionStorage.removeItem(SCREEN_KEY);
  } catch {
    // no storage: a reload pairs again
  }
}

type StartReply = { ok: boolean; body: { id?: string; pin?: string; paired?: boolean } };

async function askScreen(body: { id: string | null } | { token: string }): Promise<StartReply> {
  const res = await fetch('/api/screen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, body: (await res.json()) as StartReply['body'] };
}

/** A QR token is single use: sent once per page, so an effect that runs twice (StrictMode) reads the same answer. */
const tokenReplies = new Map<string, Promise<StartReply>>();
function askWithToken(token: string): Promise<StartReply> {
  let reply = tokenReplies.get(token);
  if (!reply) {
    reply = askScreen({ token });
    tokenReplies.set(token, reply);
    reply.catch(() => tokenReplies.delete(token)); // not reached: the next poll sends it again
  }
  return reply;
}

/** Follows an output's stream until it ends for good; `gone` when the output is no more (deleted, a new code, let go). */
function follow(base: string, on: { shown: (s: Shown) => void; name?: (n: string) => void; gone: () => void }) {
  return followStream(
    `${base}/stream?v=${viewerId()}`,
    {
      event: (m) => {
        if (m.type === 'meta') {
          on.name?.(m.outputName);
          document.title = m.orgName || 'Gospel Presenter';
        } else if (m.type === 'canvas') on.shown({ kind: 'canvas', canvas: m.canvas, offset: m.now === undefined ? 0 : m.now - Date.now() });
        else if (m.type === 'idle') on.shown({ kind: 'idle' });
        else if (m.type === 'unpaired') on.gone();
      },
      notFound: on.gone,
    },
    {
      open: (url) => new EventSource(url),
      exists: () => fetch(`${base}/exists`).then((r) => r.status, () => null),
      later: (fn, ms) => setTimeout(fn, ms),
    },
  );
}

/**
 * The projector's canvas, as the output window draws it (`Output.tsx`): black while unbound or black. A canvas
 * that goes null fades to black over 500 ms, as the output window's black screen (LiveDisplay.razor); the
 * last canvas is kept for it, since a null canvas no longer says what was shown.
 */
function Slide({ base, shown }: { base: string; shown: Shown }) {
  const canvas = shown.kind === 'canvas' ? shown.canvas : null;
  const [last, setLast] = useState(canvas);
  if (canvas && canvas !== last) setLast(canvas);
  const drawn = canvas ?? last;
  // The same objects while the canvas is the same, as the fade compares them.
  const slide = useMemo(() => {
    if (!drawn?.slide) return null;
    const { video, ...rest } = drawn.slide;
    return { ...rest, key: '', label: null, ...(video ? { video: { hash: video.hash, type: video.type, codec: video.codec } } : {}) };
  }, [drawn]);
  const overlay = useMemo(() => (drawn?.overlay ? { content: drawn.overlay.text, imageHash: drawn.overlay.image } : null), [drawn]);
  // A video plays here muted, streamed by this screen itself, where the server's clock says it should be; one this
  // browser cannot play shows its still (TODO.md "Video on the outputs").
  const video = drawn?.slide?.video ?? null;
  const offset = shown.kind === 'canvas' ? shown.offset : 0;
  const clock = useCallback(() => Date.now() + offset, [offset]);
  const playable = !!video && canPlayVideo(video.type, video.codec);
  return (
    // One element throughout, so the cover is there to fade when the canvas comes back.
    <div className="fixed inset-0 bg-black cursor-none" data-testid={canvas ? 'output' : 'display-black'}>
      <SlideView
        slide={slide}
        theme={resolveTheme(drawn?.themeId ?? null, null)}
        label={false}
        overlay={overlay}
        black={!canvas}
        media={(hash) => `${base}/image/${hash}`}
        video={playable && video ? <FollowingVideo key={video.hash} src={`${base}/video/${video.hash}`} video={video} clock={clock} /> : null}
      />
    </div>
  );
}

/** A screen waiting, black (Display.razor): what it says in the middle, and the logo and name at the foot. */
function Waiting({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white items-center justify-center" data-testid={testId}>
      <div className="flex-1 flex flex-col items-center justify-center gap-6">{children}</div>
      <div className="flex items-center gap-3 text-neutral-600 pb-8">
        <LogoIcon className="size-8" />
        <span className="text-xl font-semibold tracking-wide">Gospel Presenter</span>
      </div>
    </div>
  );
}

/** A saved screen: online while open; its name while nothing is sent to it. */
function SavedScreen({ code, name }: { code: string; name: string | null }) {
  const base = `/api/display/${encodeURIComponent(code)}`;
  const [shown, setShown] = useState<Shown>({ kind: 'idle' });
  const [title, setTitle] = useState(name);
  const [gone, setGone] = useState(false);
  useEffect(() => follow(base, { shown: setShown, name: (n) => setTitle(n || name), gone: () => setGone(true) }), [base, name]);
  if (shown.kind === 'canvas' && !gone) return <Slide base={base} shown={shown} />;
  return (
    <Waiting testId="display-idle">
      {title && <div className="text-neutral-300 text-[3vw] font-semibold">{title}</div>}
      {gone && <div className="text-neutral-500 text-[2.5vw] text-center max-w-3xl leading-snug">{t('display.notFound')}</div>}
    </Waiting>
  );
}

type Temporary = { kind: 'starting' } | { kind: 'code'; id: string; pin: string } | { kind: 'paired'; id: string };

/** A temporary screen (LIVE-R28): a code to type, or the operator's QR token; then the session, until it lets the screen go. */
function TemporaryScreen({ token, name }: { token: string | null; name: string | null }) {
  const [state, setState] = useState<Temporary>({ kind: 'starting' });
  const [shown, setShown] = useState<Shown>({ kind: 'idle' });
  const [round, setRound] = useState(0);

  // Asks for the code, and again every few seconds until paired (a new code once the old has run out).
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let qr = round === 0 ? token : null;
    // The token is single use: no reload should send it again. The name stays.
    if (qr) history.replaceState(null, '', name ? `/display?${new URLSearchParams({ name })}` : '/display');
    const ask = async () => {
      try {
        const res = await (qr ? askWithToken(qr) : askScreen({ id: keptScreen() }));
        const body = res.body;
        qr = null; // a used or wrong token: a code instead
        if (stopped) return;
        if (res.ok && body.id) {
          keepScreen(body.id);
          if (body.paired) return setState({ kind: 'paired', id: body.id });
          setState({ kind: 'code', id: body.id, pin: body.pin! });
        }
      } catch {
        // the server cannot be reached: what is shown stays, and it asks again
      }
      if (!stopped) timer = setTimeout(() => void ask(), POLL_MS);
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, name, round]);

  const pairedId = state.kind === 'paired' ? state.id : null;
  useEffect(() => {
    if (!pairedId) return;
    return follow(`/api/screen/${pairedId}`, {
      shown: setShown,
      gone: () => {
        keepScreen(null);
        setShown({ kind: 'idle' });
        setState({ kind: 'starting' });
        setRound((r) => r + 1);
      },
    });
  }, [pairedId]);

  if (pairedId) return <Slide base={`/api/screen/${pairedId}`} shown={shown} />;
  return (
    <Waiting testId="display-pairing">
      {name && <div className="text-neutral-300 text-[3vw] font-semibold">{name}</div>}
      {state.kind === 'code' && (
        <>
          <div className="text-neutral-400 text-[2.5vw] tracking-widest uppercase">{t('display.code')}</div>
          <div className="text-[14vw] leading-none font-bold tracking-[0.3em] font-mono" data-testid="display-pin">
            {state.pin}
          </div>
          <div className="text-neutral-500 text-[2.5vw] text-center max-w-3xl leading-snug">{t('display.codeText')}</div>
        </>
      )}
    </Waiting>
  );
}

/** `/display` (spec 04 §5): a click asks for full screen. */
export function Display({ id, name, token }: { id: string | null; name: string | null; token: string | null }) {
  return <div onClick={askFullScreen}>{id ? <SavedScreen code={id} name={name} /> : <TemporaryScreen token={token} name={name} />}</div>;
}
