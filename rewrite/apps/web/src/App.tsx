import { useEffect, useMemo, useState } from 'react';
import { useDropGuard } from './ui/DropZone.tsx';
import { can, type Me, type PairStatus } from '@gp/core';
import { api } from './auth/api.ts';
import { updateMe } from './auth/session.ts';
import { useDb } from './db/react.tsx';
import { t } from './i18n.ts';
import type { LiveChannel } from './live/live.ts';
import { AudioEngine, audioUrlOfItem } from './live/audio.ts';
import { VideoEngine } from './live/video.ts';
import { useLiveOwner } from './live/owner.ts';
import type { LiveLink } from './live/remote.ts';
import { About } from './pages/About.tsx';
import { Bibles } from './pages/Bibles.tsx';
import { Audios } from './pages/Audios.tsx';
import { OverlayEditor, Overlays } from './pages/Overlays.tsx';
import { Devices } from './pages/Devices.tsx';
import { Displays } from './pages/Displays.tsx';
import { Images } from './pages/Images.tsx';
import { Live } from './pages/live/index.ts';
import { Logins } from './pages/Logins.tsx';
import { Output } from './pages/Output.tsx';
import { PresentationEditor } from './pages/presentation-editor/index.ts';
import { Presentations } from './pages/Presentations.tsx';
import { OrgSettings } from './pages/OrgSettings.tsx';
import { Settings } from './pages/Settings.tsx';
import { SongEditor } from './pages/SongEditor.tsx';
import { Themes } from './pages/Themes.tsx';
import { Songs } from './pages/Songs.tsx';
import { Templates } from './pages/Templates.tsx';
import { Trash } from './pages/Trash.tsx';
import { UserDetail } from './pages/UserDetail.tsx';
import { Users } from './pages/Users.tsx';
import { AdminLayout, SyncWarnings, TopBar, UnexpectedError } from './Shell.tsx';
import { PageDialog } from './ui/Dialog.tsx';
import { ShortcutHelp } from './ui/ShortcutHelp.tsx';
import { PageContainer } from './ui/PageContainer.tsx';
import { closeAdmin, isAdminPage, useRoute, type Route } from './ui/router.ts';
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
  // So does a video item's, and its picture's clock, which the outputs follow (TODO.md "Video on the outputs").
  const video = useMemo(() => new VideoEngine(), []);
  // This window owns whatever it presents, on every page (LIVE-R49).
  useLiveOwner(live, link, db, sessionId, audio, video);
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

  // A file dropped outside a drop zone must not make the browser open it and leave the app.
  useDropGuard();
  const viewUsers = can(me.role, 'ViewUsers');
  const admin = (
    <>
      {route.page === 'songs' && <Songs />}
      {/* Keyed by the song, so its fields write their pending saves to it before another song's open. */}
      {route.page === 'song' && <SongEditor key={route.id} id={route.id} />}
      {route.page === 'users' && (viewUsers ? <Users me={me} /> : <Refused text={t('users.forbidden')} />)}
      {route.page === 'user' && (viewUsers ? <UserDetail key={route.id} id={route.id} me={me} host={host} /> : <Refused text={t('users.forbidden')} />)}
      {route.page === 'devices' && (host ? <Devices me={me} /> : <Refused text={t('devices.onlyHost')} />)}
      {route.page === 'bibles' && (can(me.role, 'ManageBibles') ? <Bibles /> : <Refused text={t('bibles.forbidden')} />)}
      {route.page === 'images' && (can(me.role, 'ViewImages') ? <Images role={me.role} /> : <Refused text={t('images.forbidden')} />)}
      {route.page === 'audios' && (can(me.role, 'ViewAudios') ? <Audios role={me.role} /> : <Refused text={t('audios.forbidden')} />)}
      {route.page === 'overlays' && (can(me.role, 'ManageOverlays') ? <Overlays /> : <Refused text={t('overlays.forbidden')} />)}
      {route.page === 'overlay' && (can(me.role, 'ManageOverlays') ? <OverlayEditor key={route.id} id={route.id} /> : <Refused text={t('overlays.forbidden')} />)}
      {route.page === 'templates' && (can(me.role, 'ManageTemplates') ? <Templates /> : <Refused text={t('templates.forbidden')} />)}
      {route.page === 'themes' && <Themes role={me.role} />}
      {route.page === 'displays' && (can(me.role, 'ManageRemoteDisplays') ? <Displays link={link} /> : <Refused text={t('displays.forbidden')} />)}
      {route.page === 'about' && <About />}
      {route.page === 'orgSettings' && (can(me.role, 'ManageOrganizationSettings') ? <OrgSettings /> : <Refused text={t('orgSettings.forbidden')} />)}
    </>
  );
  // The admin pages open in a dialog over the page the user was on, which stays as it was (presenting goes
  // on); opened from the address bar, over the start page.
  const adminOpen = isAdminPage(route);
  const [under, setUnder] = useState<Route>(adminOpen ? { page: 'presentations' } : route);
  if (!adminOpen && route !== under) setUnder(route);
  return (
    <ToastProvider>
      <ShortcutHelp />
      <UnexpectedError />
      {/* Out of reach under the admin dialog, for the keyboard and screen readers too. */}
      <div className="contents" inert={adminOpen} aria-hidden={adminOpen || undefined}>
        <TopBar me={me} back={under.page === 'presentation'} warnings={!adminOpen} />
        {under.page === 'presentations' ? (
          <Presentations link={link} ownSessionId={sessionId} />
        ) : under.page === 'settings' ? (
          <Settings />
        ) : under.page === 'presentation' ? (
          <Live key={`${under.id}:${under.remote ? (under.session ?? 'remote') : 'own'}`} id={under.id} role={me.role} live={live} link={link} audio={audio} video={video} sessionId={sessionId} remote={under.remote} session={under.session} stage={under.stage} />
        ) : under.page === 'template' ? (
          // Editing a template is for admins (D24): a user who has the link is told so.
          can(me.role, 'ManageTemplates') ? (
            <PresentationEditor key={under.id} id={under.id} role={me.role} live={live} template />
          ) : (
            <Refused text={t('templates.forbidden')} />
          )
        ) : under.page === 'trash' ? (
          <Trash key={under.kind ?? 'all'} kind={under.kind} role={me.role} />
        ) : (
          under.page === 'logins' && <Logins error={under.error} />
        )}
      </div>
      {adminOpen && (
        <PageDialog title={t('nav.admin')} onClose={() => closeAdmin(under)}>
          <SyncWarnings />
          <AdminLayout me={me} host={host} route={route}>
            {admin}
          </AdminLayout>
        </PageDialog>
      )}
    </ToastProvider>
  );
}

/** A page the user may not open: why, where the page would be. */
function Refused({ text }: { text: string }) {
  return (
    <PageContainer>
      <p className="px-5 text-neutral-500 dark:text-neutral-400">{text}</p>
    </PageContainer>
  );
}

/** The output window has no chrome; its live channel only listens. */
export function OutputApp({ live }: { live: LiveChannel }) {
  return <Output live={live} />;
}
