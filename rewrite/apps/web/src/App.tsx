import { useEffect, useMemo, useState } from 'react';
import { can, type Me, type PairStatus } from '@gp/core';
import { api } from './auth/api.ts';
import { forgetSession, saveDeviceToken, updateMe } from './auth/session.ts';
import { REPAIR_KEY } from './Boot.tsx';
import { useDb, useDbStatus } from './db/react.tsx';
import { t } from './i18n.ts';
import type { LiveChannel } from './live/live.ts';
import { AudioEngine, audioUrlOfItem } from './live/audio.ts';
import { useLiveOwner } from './live/owner.ts';
import type { LiveLink } from './live/remote.ts';
import { Bibles } from './pages/Bibles.tsx';
import { Audios } from './pages/Audios.tsx';
import { OverlayEditor, Overlays } from './pages/Overlays.tsx';
import { Devices } from './pages/Devices.tsx';
import { Displays } from './pages/Displays.tsx';
import { Images } from './pages/Images.tsx';
import { Live } from './pages/Live.tsx';
import { Logins } from './pages/Logins.tsx';
import { Output } from './pages/Output.tsx';
import { PresentationEditor } from './pages/PresentationEditor.tsx';
import { Presentations } from './pages/Presentations.tsx';
import { SongEditor } from './pages/SongEditor.tsx';
import { Themes } from './pages/Themes.tsx';
import { Songs } from './pages/Songs.tsx';
import { Trash } from './pages/Trash.tsx';
import { Users } from './pages/Users.tsx';
import { Button } from './ui/Button.tsx';
import { href, useRoute } from './ui/router.ts';
import { ToastProvider } from './ui/Toast.tsx';

/** Back to the sign-in screen. The local database stays (D3, DESK-A7). */
function toSignIn() {
  forgetSession();
  location.reload();
}

/**
 * Signs out: the server revokes the session (if it can be reached; offline,
 * the session is only forgotten here), and this device forgets it.
 */
async function signOut() {
  await Promise.race([api('POST', '/api/auth/signout').catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  toSignIn();
}

function pairAgain() {
  saveDeviceToken(null);
  sessionStorage.setItem(REPAIR_KEY, '1');
  location.reload();
}

function StatusBar() {
  const s = useDbStatus();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => setError(e.reason instanceof Error ? e.reason.message : String(e.reason));
    addEventListener('unhandledrejection', on);
    return () => removeEventListener('unhandledrejection', on);
  }, []);
  if (!s) return null;
  const last = s.rejected.at(-1);
  return (
    <footer className="status" data-testid="status">
      <span className={s.connected ? 'ok' : 'warning'}>{s.connected ? t('status.connected') : t('status.offline')}</span>
      {s.pending > 0 && <span>{t('status.pending', { n: s.pending })}</span>}
      {s.storage !== 'opfs' && <span className="warning">{t('status.memory', { reason: s.storage })}</span>}
      {s.updateRequired && <span className="warning">{t('status.updateRequired')}</span>}
      {s.authError === 'device-not-paired' && (
        <span className="warning">
          {t('status.notPaired')} <Button onClick={pairAgain}>{t('status.pairAgain')}</Button>
        </span>
      )}
      {(s.authError === 'unauthenticated' || s.authError === 'not-a-member') && (
        <span className="warning">
          {t('status.authRequired')} <Button onClick={toSignIn}>{t('status.signInAgain')}</Button>
        </span>
      )}
      {last && <span className="warning">{t('status.rejected', { error: last.error })}</span>}
      {error && (
        <span className="warning" role="alert">
          {error}
        </span>
      )}
    </footer>
  );
}

/**
 * The signed-in app. `me` is what the server said at sign-in, refreshed in
 * the background (spec 01 `GET /api/me`), so a name or role change shows
 * without signing in again. Offline, the stored one is used.
 */
export function App({ me: initial, live, link, sessionId }: { me: Me; live: LiveChannel; link: LiveLink; sessionId: string }) {
  const route = useRoute();
  const db = useDb();
  // The session's audio plays in this window, whichever page is open (spec 04 §1b).
  const audio = useMemo(() => new AudioEngine((itemId) => audioUrlOfItem(db, itemId)), [db]);
  // This window owns whatever it presents, on every page (LIVE-R49).
  useLiveOwner(live, link, db, sessionId, audio);
  const [me, setMe] = useState(initial);
  const [host, setHost] = useState(false);

  useEffect(() => {
    api<Me>('GET', '/api/auth/me')
      .then((r) => {
        if (r.error) return;
        updateMe(r.body);
        setMe(r.body);
      })
      .catch(() => undefined); // offline: keep the stored identity
    api<PairStatus>('GET', '/api/pair/status')
      .then((r) => setHost(!r.error && r.body.host))
      .catch(() => undefined);
  }, []);

  const viewUsers = can(me.role, 'ViewUsers');
  return (
    <ToastProvider>
      <div className="app">
        <header className="top">
          <strong>{t('app.name')}</strong>
          <nav>
            <a href={href({ page: 'songs' })} aria-current={route.page.startsWith('song') ? 'page' : undefined}>
              {t('nav.songs')}
            </a>
            <a href={href({ page: 'presentations' })} aria-current={route.page.startsWith('presentation') ? 'page' : undefined}>
              {t('nav.presentations')}
            </a>
            {can(me.role, 'ManageBibles') && (
              <a href={href({ page: 'bibles' })} aria-current={route.page === 'bibles' ? 'page' : undefined}>
                {t('nav.bibles')}
              </a>
            )}
            {can(me.role, 'ViewImages') && (
              <a href={href({ page: 'images' })} aria-current={route.page === 'images' ? 'page' : undefined}>
                {t('nav.images')}
              </a>
            )}
            {can(me.role, 'ViewAudios') && (
              <a href={href({ page: 'audios' })} aria-current={route.page === 'audios' ? 'page' : undefined}>
                {t('nav.audios')}
              </a>
            )}
            {can(me.role, 'ManageOverlays') && (
              <a href={href({ page: 'overlays' })} aria-current={route.page.startsWith('overlay') ? 'page' : undefined}>
                {t('overlays.title')}
              </a>
            )}
            <a href={href({ page: 'themes' })} aria-current={route.page === 'themes' ? 'page' : undefined}>
              {t('nav.themes')}
            </a>
            {viewUsers && (
              <a href={href({ page: 'users' })} aria-current={route.page === 'users' ? 'page' : undefined}>
                {t('nav.users')}
              </a>
            )}
            {can(me.role, 'ManageRemoteDisplays') && (
              <a href={href({ page: 'displays' })} aria-current={route.page === 'displays' ? 'page' : undefined}>
                {t('nav.displays')}
              </a>
            )}
            {host && can(me.role, 'ManageUsers') && (
              <a href={href({ page: 'devices' })} aria-current={route.page === 'devices' ? 'page' : undefined}>
                {t('nav.devices')}
              </a>
            )}
          </nav>
          <a href={href({ page: 'logins', error: null })} className="muted" data-testid="me" title={t('logins.title')} aria-current={route.page === 'logins' ? 'page' : undefined}>
            {me.name} · {me.orgName}
          </a>
          <Button onClick={() => void signOut()}>{t('auth.signOut')}</Button>
        </header>
        <main>
          {route.page === 'songs' && <Songs />}
          {route.page === 'song' && <SongEditor id={route.id} />}
          {route.page === 'presentations' && <Presentations link={link} ownSessionId={sessionId} />}
          {route.page === 'presentation' && <PresentationEditor id={route.id} />}
          {route.page === 'live' && <Live key={`${route.id}:${route.remote ? (route.session ?? 'remote') : 'own'}`} id={route.id} live={live} link={link} audio={audio} sessionId={sessionId} remote={route.remote} session={route.session} />}
          {route.page === 'trash' && <Trash key={route.kind ?? 'all'} kind={route.kind} role={me.role} />}
          {route.page === 'users' && (viewUsers ? <Users me={me} host={host} /> : <p>{t('users.forbidden')}</p>)}
          {route.page === 'devices' && (host ? <Devices me={me} /> : <p>{t('devices.onlyHost')}</p>)}
          {route.page === 'logins' && <Logins error={route.error} />}
          {route.page === 'bibles' && (can(me.role, 'ManageBibles') ? <Bibles /> : <p>{t('bibles.forbidden')}</p>)}
          {route.page === 'images' && (can(me.role, 'ViewImages') ? <Images role={me.role} /> : <p>{t('images.forbidden')}</p>)}
          {route.page === 'audios' && (can(me.role, 'ViewAudios') ? <Audios role={me.role} /> : <p>{t('audios.forbidden')}</p>)}
          {route.page === 'overlays' && (can(me.role, 'ManageOverlays') ? <Overlays /> : <p>{t('overlays.forbidden')}</p>)}
          {route.page === 'overlay' && (can(me.role, 'ManageOverlays') ? <OverlayEditor key={route.id} id={route.id} /> : <p>{t('overlays.forbidden')}</p>)}
          {route.page === 'themes' && <Themes role={me.role} />}
          {route.page === 'displays' && (can(me.role, 'ManageRemoteDisplays') ? <Displays link={link} /> : <p>{t('displays.forbidden')}</p>)}
        </main>
        <StatusBar />
      </div>
    </ToastProvider>
  );
}

/** The output window has no chrome; its live channel only listens. */
export function OutputApp({ live }: { live: LiveChannel }) {
  return <Output live={live} />;
}
