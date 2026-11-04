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
import { KEEP_COMING_CHANGED, keepComingSetting } from './ui/KeepOffline.tsx';
import { CACHE_LIMIT_CHANGED, cacheLimitSetting, Storage } from './pages/Storage.tsx';
import { useCcliCounter } from './live/ccli.ts';
import { useLiveOwner } from './live/owner.ts';
import type { LiveLink } from './live/remote.ts';
import { About } from './pages/About.tsx';
import { Bibles } from './pages/Bibles.tsx';
import { Audios } from './pages/Audios.tsx';
import { CustomSlides } from './pages/custom-slides/CustomSlides.tsx';
import { SlideEditor } from './pages/custom-slides/SlideEditor.tsx';
import { Videos } from './pages/Videos.tsx';
import { Overlays } from './pages/Overlays.tsx';
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
import { CcliReport } from './pages/CcliReport.tsx';
import { OrgDetail, Orgs } from './pages/Orgs.tsx';
import { SongEditor } from './pages/SongEditor.tsx';
import { SongArrangement } from './pages/SongArrangement.tsx';
import { SongArrangements } from './pages/SongArrangements.tsx';
import { SongHistory } from './pages/SongHistory.tsx';
import { SongMaterials } from './pages/song-materials/SongMaterials.tsx';
import { Themes } from './pages/Themes.tsx';
import { Songs } from './pages/Songs.tsx';
import { Templates } from './pages/Templates.tsx';
import { Labels } from './pages/Labels.tsx';
import { Trash } from './pages/Trash.tsx';
import { UserDetail } from './pages/UserDetail.tsx';
import { Users } from './pages/Users.tsx';
import { RejectedChanges, SyncWarnings, UnexpectedError } from './Shell.tsx';
import { PageDialog } from './ui/Dialog.tsx';
import { TopBar } from './TopBar.tsx';
import { SettingsLayout } from './pages/settings/SettingsLayout.tsx';
import { settingsGroups } from './pages/settings/settingsLinks.ts';
import { ShortcutHelp } from './ui/ShortcutHelp.tsx';
import { PageContainer } from './ui/PageContainer.tsx';
import { adminBack, aloneInSettings, closeAdmin, href, isAdminPage, navigate, SONG_PAGES, useRoute, type Route } from './ui/router.ts';
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
  // And counts the songs it shows for the CCLI report (SONG-R48).
  useCcliCounter(live, db);
  // Starta presentation fetches the presentation's files here, at once and quietly; looking around fetches none.
  // Inställningar… in the desktop app's menu bar.
  useEffect(() => window.gpDesktop?.onMenu?.((command) => command === 'settings' && navigate({ page: 'admin' })), []);
  useEffect(() => {
    let last: string | null | undefined;
    return live.subscribe((p) => {
      if (p.presentationId !== last) void db.present((last = p.presentationId));
    });
  }, [live, db]);
  // "Spara kommande presentationer offline" is this device's choice, kept by the page; the worker follows it.
  useEffect(() => {
    const send = () => void db.keepComing(keepComingSetting());
    send();
    addEventListener(KEEP_COMING_CHANGED, send);
    return () => removeEventListener(KEEP_COMING_CHANGED, send);
  }, [db]);
  // So is the cache limit (Lagring på den här enheten).
  useEffect(() => {
    const send = () => void db.setBudget(cacheLimitSetting());
    send();
    addEventListener(CACHE_LIMIT_CHANGED, send);
    return () => removeEventListener(CACHE_LIMIT_CHANGED, send);
  }, [db]);
  const [me, setMe] = useState(initial);
  const [host, setHost] = useState(false);
  // Whether the intro card's title of a page in Inställningar is in view: the bar names the page only once it is not.
  const [introTitleInView, setIntroTitleInView] = useState(false);

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
      {(route.page === 'songs' || route.page === 'admin') && <Songs />}
      {route.page === 'settings' && <Settings />}
      {route.page === 'logins' && <Logins error={route.error} />}
      {route.page === 'storage' && <Storage />}
      {/* Keyed by the song, so its fields write their pending saves to it before another song's open. */}
      {route.page === 'song' && <SongEditor key={route.id} id={route.id} />}
      {route.page === 'users' && (viewUsers ? <Users me={me} /> : <Refused text={t('users.forbidden')} />)}
      {route.page === 'user' && (viewUsers ? <UserDetail key={route.id} id={route.id} me={me} host={host} /> : <Refused text={t('users.forbidden')} />)}
      {route.page === 'devices' && (host ? <Devices me={me} /> : <Refused text={t('devices.onlyHost')} />)}
      {route.page === 'bibles' && (can(me.role, 'ManageBibles') ? <Bibles /> : <Refused text={t('bibles.forbidden')} />)}
      {route.page === 'images' && (can(me.role, 'ViewImages') ? <Images role={me.role} /> : <Refused text={t('images.forbidden')} />)}
      {route.page === 'audios' && (can(me.role, 'ViewAudios') ? <Audios role={me.role} /> : <Refused text={t('audios.forbidden')} />)}
      {route.page === 'videos' && (can(me.role, 'ViewVideos') ? <Videos role={me.role} /> : <Refused text={t('videos.forbidden')} />)}
      {route.page === 'customSlides' && <CustomSlides />}
      {route.page === 'customSlide' && <SlideEditor key={route.id} id={route.id} />}
      {route.page === 'overlays' && (can(me.role, 'ManageOverlays') ? <Overlays /> : <Refused text={t('overlays.forbidden')} />)}
      {route.page === 'overlay' && (can(me.role, 'ManageOverlays') ? <SlideEditor key={route.id} id={route.id} edits="overlay" /> : <Refused text={t('overlays.forbidden')} />)}
      {route.page === 'orgs' && (can(me.role, 'ManageOrganizations') ? <Orgs /> : <Refused text={t('orgs.forbidden')} />)}
      {route.page === 'org' && (can(me.role, 'ManageOrganizations') ? <OrgDetail key={route.id} id={route.id} me={me} /> : <Refused text={t('orgs.forbidden')} />)}
      {route.page === 'ccliReport' && (can(me.role, 'ViewCcliReport') ? <CcliReport role={me.role} /> : <Refused text={t('ccli.forbidden')} />)}
      {route.page === 'labels' && <Labels />}
      {route.page === 'songHistory' && <SongHistory key={route.id} id={route.id} />}
      {route.page === 'songArrangements' && <SongArrangements key={route.id} id={route.id} />}
      {route.page === 'songArrangement' && <SongArrangement key={route.arrangementId} id={route.id} arrangementId={route.arrangementId} />}
      {route.page === 'songMaterials' && <SongMaterials key={route.id} id={route.id} />}
      {route.page === 'themes' && <Themes role={me.role} />}
      {route.page === 'displays' && (can(me.role, 'ManageRemoteDisplays') ? <Displays key="screen" link={link} kind="screen" /> : <Refused text={t('displays.forbidden')} />)}
      {route.page === 'publicOutputs' && (can(me.role, 'ManageRemoteDisplays') ? <Displays key="public" link={link} kind="public" /> : <Refused text={t('displays.forbidden')} />)}
      {route.page === 'about' && <About />}
      {route.page === 'trash' && <Trash key={route.kind ?? 'all'} kind={route.kind} role={me.role} />}
      {route.page === 'orgSettings' && (can(me.role, 'ManageOrganizationSettings') ? <OrgSettings /> : <Refused text={t('orgSettings.forbidden')} />)}
    </>
  );
  // Inställningar opens in a dialog over the page the user was on, which stays as it was (presenting goes
  // on); opened from the address bar, over the start page.
  const adminOpen = isAdminPage(route);
  const [under, setUnder] = useState<Route>(adminOpen ? { page: 'presentations' } : route);
  if (!adminOpen && route !== under) setUnder(route);
  // A presentation or a template has a bar of its own, before and while presenting, at every width (docs/layout-2-0.md).
  const ownBar = under.page === 'presentation' || under.page === 'template';
  return (
    <ToastProvider>
      <ShortcutHelp />
      <UnexpectedError />
      <RejectedChanges />
      {/* Out of reach under the dialog, for the keyboard and screen readers too. */}
      <div className="contents" inert={adminOpen} aria-hidden={adminOpen || undefined}>
        {/* A presentation has its own bar (PresentationBar, PhoneLive); the warnings stay under it. */}
        {ownBar ? (
          !adminOpen && <SyncWarnings />
        ) : (
          <TopBar me={me} warnings={!adminOpen} />
        )}
        {under.page === 'presentations' ? (
          <Presentations link={link} ownSessionId={sessionId} manageTemplates={can(me.role, 'ManageTemplates')} />
        ) : under.page === 'presentation' ? (
          <Live key={`${under.id}:${under.remote ? (under.session ?? 'remote') : 'own'}`} id={under.id} role={me.role} live={live} link={link} audio={audio} video={video} sessionId={sessionId} remote={under.remote} session={under.session} />
        ) : under.page === 'templates' ? (
          can(me.role, 'ManageTemplates') ? <Templates /> : <Refused text={t('templates.forbidden')} />
        ) : under.page === 'template' ? (
          // Editing a template is for admins (D24): a user who has the link is told so.
          can(me.role, 'ManageTemplates') ? (
            <PresentationEditor key={under.id} id={under.id} role={me.role} live={live} template />
          ) : (
            <Refused text={t('templates.forbidden')} />
          )
        ) : null}
      </div>
      {adminOpen && (
        <PageDialog
          title={settingsTitle(route)}
          compactTitle={settingsPageTitle(route, me, host)}
          compactTitleShown={!introTitleInView}
          back={settingsBack(route)}
          split
          narrow={aloneInSettings(route, adminBack())}
          onClose={() => closeAdmin(under)}
        >
          <SyncWarnings />
          <SettingsLayout
            me={me}
            host={host}
            route={route}
            // From `lg` the list's own page shows Sånger beside it.
            bar={{ title: route.page === 'admin' ? t('nav.songs') : settingsPageTitle(route, me, host), titleShown: !introTitleInView, back: settingsBack(route), onClose: () => closeAdmin(under) }}
            onIntroTitle={setIntroTitleInView}
          >
            {admin}
          </SettingsLayout>
        </PageDialog>
      )}
    </ToastProvider>
  );
}

/**
 * The dialog's title: Inställningar, or what a page opened straight from outside it is (a song from a presentation's
 * item), since it stands there alone, without the list.
 */
function settingsTitle(route: Route, detail = false): string {
  if (!detail && !aloneInSettings(route, adminBack())) return t('nav.admin');
  switch (route.page) {
    case 'song':
      return t('song.one');
    case 'songHistory':
      return t('history.versions');
    case 'songArrangements':
      return t('song.arrangements');
    case 'songArrangement':
      return t('song.arrangement');
    case 'songMaterials':
      return t('material.title');
    case 'user':
      return t('users.title');
    case 'overlay':
      return t('overlays.itemOverlay');
    case 'customSlide':
      return t('nav.customSlides');
    case 'org':
      return t('orgs.one');
    default:
      return t('nav.admin');
  }
}

/**
 * The page's name for the dialog's bar on a phone, where the page shows no heading of its own (PageHeader): its row's
 * name in the list, or what a detail page is.
 */
function settingsPageTitle(route: Route, me: Me, host: boolean): string {
  if (route.page === 'admin') return t('nav.admin');
  if (route.page === 'settings') return t('nav.settings');
  if (route.page === 'trash') return t('trash.title');
  if (route.page === 'logins') return t('logins.title');
  if (route.page === 'storage') return t('storage.title');
  if (DETAIL_TITLES.has(route.page)) return settingsTitle(route, true);
  const link = settingsGroups(me, host).flatMap((g) => g.links).find((l) => l.route.page === route.page);
  return link ? t(link.label) : t('nav.admin');
}

const DETAIL_TITLES = new Set<Route['page']>(['song', ...SONG_PAGES, 'user', 'overlay', 'org', 'customSlide']);

/**
 * The dialog bar's round ‹ on a phone: one step up, a detail page to its list and a row's page to Inställningar's
 * list; none on the list, nor on a page opened alone.
 */
function settingsBack(route: Route): { href: string; label: string } | undefined {
  if (route.page === 'admin' || aloneInSettings(route, adminBack())) return undefined;
  const up: Route =
    route.page === 'song' ? { page: 'songs' }
    : route.page === 'songArrangement' ? { page: 'songArrangements', id: route.id }
    : route.page === 'songHistory' || route.page === 'songArrangements' || route.page === 'songMaterials' ? { page: 'song', id: route.id }
    : route.page === 'user' ? { page: 'users' }
    : route.page === 'overlay' ? { page: 'overlays' }
    : route.page === 'customSlide' ? { page: 'customSlides' }
    : route.page === 'org' ? { page: 'orgs' }
    : route.page === 'logins' || route.page === 'storage' ? { page: 'settings' }
    : { page: 'admin' };
  return { href: href(up), label: t('common.back') };
}

/** A page the user may not open: why, where the page would be. */
function Refused({ text }: { text: string }) {
  return (
    <PageContainer>
      <p className="px-5 text-stone-500 dark:text-stone-400">{text}</p>
    </PageContainer>
  );
}

/** The output window has no chrome; its live channel only listens. */
export function OutputApp({ live }: { live: LiveChannel }) {
  return <Output live={live} />;
}
