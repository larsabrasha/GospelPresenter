import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, type Me, type PairStatus } from '@gp/core';
import { api } from './auth/api.ts';
import { updateMe } from './auth/session.ts';
import { useDb } from './db/react.tsx';
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
import { Settings } from './pages/Settings.tsx';
import { SongEditor } from './pages/SongEditor.tsx';
import { Themes } from './pages/Themes.tsx';
import { Songs } from './pages/Songs.tsx';
import { Trash } from './pages/Trash.tsx';
import { Users } from './pages/Users.tsx';
import { AdminLayout, TopBar } from './Shell.tsx';
import { useRoute, type Route } from './ui/router.ts';
import { ToastProvider } from './ui/Toast.tsx';

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
  const admin = (
    <>
      {route.page === 'users' && (viewUsers ? <Users me={me} host={host} /> : <p>{t('users.forbidden')}</p>)}
      {route.page === 'devices' && (host ? <Devices me={me} /> : <p>{t('devices.onlyHost')}</p>)}
      {route.page === 'bibles' && (can(me.role, 'ManageBibles') ? <Bibles /> : <p>{t('bibles.forbidden')}</p>)}
      {route.page === 'images' && (can(me.role, 'ViewImages') ? <Images role={me.role} /> : <p>{t('images.forbidden')}</p>)}
      {route.page === 'audios' && (can(me.role, 'ViewAudios') ? <Audios role={me.role} /> : <p>{t('audios.forbidden')}</p>)}
      {route.page === 'overlays' && (can(me.role, 'ManageOverlays') ? <Overlays /> : <p>{t('overlays.forbidden')}</p>)}
      {route.page === 'overlay' && (can(me.role, 'ManageOverlays') ? <OverlayEditor key={route.id} id={route.id} /> : <p>{t('overlays.forbidden')}</p>)}
      {route.page === 'themes' && <Themes role={me.role} />}
      {route.page === 'displays' && (can(me.role, 'ManageRemoteDisplays') ? <Displays link={link} /> : <p>{t('displays.forbidden')}</p>)}
    </>
  );
  return (
    <ToastProvider>
      <TopBar me={me} />
      {route.page === 'presentations' ? (
        <Presentations link={link} ownSessionId={sessionId} />
      ) : route.page === 'settings' ? (
        <Settings />
      ) : route.page === 'presentation' ? (
        <PresentationEditor id={route.id} />
      ) : route.page === 'live' ? (
        <Live key={`${route.id}:${route.remote ? (route.session ?? 'remote') : 'own'}`} id={route.id} live={live} link={link} audio={audio} sessionId={sessionId} remote={route.remote} session={route.session} />
      ) : ADMIN_PAGES.has(route.page) ? (
        <AdminLayout me={me} host={host} route={route}>
          {route.page === 'songs' ? <Songs /> : route.page === 'song' ? <SongEditor id={route.id} /> : <Legacy>{admin}</Legacy>}
        </AdminLayout>
      ) : (
        <Legacy>
          {route.page === 'trash' && <Trash key={route.kind ?? 'all'} kind={route.kind} role={me.role} />}
          {route.page === 'logins' && <Logins error={route.error} />}
        </Legacy>
      )}
    </ToastProvider>
  );
}

/** The pages under the admin menu (Layout/AdminLayout.razor). */
const ADMIN_PAGES = new Set<Route['page']>(['songs', 'song', 'users', 'devices', 'bibles', 'images', 'audios', 'overlays', 'overlay', 'themes', 'displays']);

/** A page not yet moved to Tailwind: its old styles (styles.css), in a scrolling area. */
function Legacy({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="legacy-page">{children}</div>
    </div>
  );
}

/** The output window has no chrome; its live channel only listens. */
export function OutputApp({ live }: { live: LiveChannel }) {
  return <Output live={live} />;
}
