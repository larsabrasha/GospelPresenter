import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, OutputApp } from './App.tsx';
import { storedSession, workerSession } from './auth/session.ts';
import { Boot, REPAIR_KEY } from './Boot.tsx';
import { CrashGuard, errorMessage, Stopped } from './Stopped.tsx';
import { Starting } from './pages/AuthCard.tsx';
import { keepApp } from './keepApp.ts';
import { Db } from './db/db.ts';
import { DbProvider, ReaderProvider } from './db/react.tsx';
import { SharedReader, shareChannelName } from './db/share.ts';
import { socketProtocols } from '@gp/sync/client';
import { LiveChannel } from './live/live.ts';
import { LiveLink, windowSessionId } from './live/remote.ts';
import { Display } from './pages/Display.tsx';
import { Watch } from './pages/Watch.tsx';
import { browserLanguage, installLanguage } from './i18n.ts';
import { currentRoute, installLinkHandler, NAVIGATED } from './ui/router.ts';
import { installTrail } from './report/trail.ts';
import { installTheme } from './ui/theme.ts';
import './fonts.css';
import './app.css';

installTheme();
// The desktop app on a Mac: the page's bar is the window's title bar (app.css `.mac-frame`).
if (window.gpDesktop?.macFrame) document.documentElement.classList.add('mac-frame');
// The desktop app behaves as a native app: nothing selects but what a native app lets you select (app.css `.native`).
if (window.gpDesktop) document.documentElement.classList.add('native');
// iOS zooms into a field whose text is under 16 px when it gets focus, and the page stays zoomed. A largest scale of 1
// stops that; Safari still lets a pinch zoom. Only on iOS: Android never zooms on focus, and there it would stop the pinch.
// An iPad says Macintosh, but has a touch screen.
if (/iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) {
  const viewport = document.querySelector('meta[name=viewport]');
  viewport?.setAttribute('content', `${viewport.getAttribute('content')}, maximum-scale=1`);
}
// The keyboard makes the page shorter (the phone app, docs/phone-app.md; Android's browser): the field being typed in
// comes back into view in the box that scrolls it, rather than staying under the keyboard.
addEventListener('resize', () => {
  const field = document.activeElement;
  if (field instanceof HTMLElement && field.matches('input, textarea, select, [contenteditable]')) field.scrollIntoView({ block: 'nearest' });
});
// How wide a scrollbar is beside the content, for a column that keeps the same margin whatever it is (app.css
// `--beside-scrollbar`).
const probe = document.createElement('div');
probe.style.cssText = 'position:absolute;top:-100px;width:50px;height:50px;overflow:scroll';
document.body.append(probe);
document.documentElement.style.setProperty('--scrollbar', `${probe.offsetWidth - probe.clientWidth}px`);
probe.remove();
const root = createRoot(document.getElementById('root')!);
installLinkHandler();
const route = currentRoute();
// A public output's viewer and a screen choose nothing: they follow their browser's language.
installLanguage(route.page === 'watch' || route.page === 'display' ? browserLanguage() : undefined);
const stored = storedSession();
// A public output's viewer is anyone's phone, and a screen is a TV: neither gets a copy of the app.
if (route.page !== 'watch' && route.page !== 'display') keepApp();

if (route.page === 'watch') {
  // A public output (spec 04 §6): anyone with the code, signed in or not; no database.
  root.render(
    <StrictMode>
      <Watch code={route.code} />
    </StrictMode>,
  );
} else if (route.page === 'display') {
  // A paired screen (spec 04 §5): anonymous, no database.
  root.render(
    <StrictMode>
      <Display id={route.id} name={route.name} token={route.token} />
    </StrictMode>,
  );
} else if (route.page === 'output') {
  // The output opens no database: it reads the operator window's, which works
  // whether that one is on OPFS or only in memory. Signed out, it stays black.
  if (stored) {
    const session = workerSession(stored);
    const live = new LiveChannel(session.orgId, 'output');
    root.render(
      <StrictMode>
        <ReaderProvider reader={new SharedReader(shareChannelName(session))}>
          <OutputApp live={live} />
        </ReaderProvider>
      </StrictMode>,
    );
  } else root.render(<div className="fixed inset-0 bg-black cursor-none" data-testid="output" />);
} else if (stored && route.page !== 'invite' && route.page !== 'signedIn' && !sessionStorage.getItem(REPAIR_KEY)) {
  // Signed in: straight into the local database, with or without a network. A start that fails, or waits on the
  // database for long, says so with a way out rather than staying blank: a reload can wait some seconds for the
  // page before to let go of the database file.
  const session = workerSession(stored);
  // The steps a bug report carries (docs/bug-reports.md), from the start.
  installTrail(NAVIGATED);
  const db = new Db();
  const waiting = setTimeout(() => root.render(<Starting />), 1000);
  const slow = setTimeout(() => root.render(<Stopped why={{ kind: 'slow' }} />), 10_000);
  try {
    await db.open(session);
    // One live channel per window, for the window's lifetime.
    const live = new LiveChannel(session.orgId, 'operator');
    // The organisation's live sessions, and this window's own (spec 04 §2).
    const link = new LiveLink(socketProtocols({ token: session.token, device: session.device }));
    root.render(
      <StrictMode>
        <CrashGuard>
          <DbProvider db={db}>
            <App me={stored.me} live={live} link={link} sessionId={windowSessionId()} />
          </DbProvider>
        </CrashGuard>
      </StrictMode>,
    );
  } catch (e) {
    root.render(<Stopped why={{ kind: 'failed', error: errorMessage(e) }} />);
  } finally {
    clearTimeout(waiting);
    clearTimeout(slow);
  }
} else {
  root.render(
    <StrictMode>
      <Boot boot={route.page === 'invite' ? { invite: route.token } : route.page === 'signedIn' ? { signedIn: true } : { error: route.page === 'signIn' ? route.error : null }} />
    </StrictMode>,
  );
}
