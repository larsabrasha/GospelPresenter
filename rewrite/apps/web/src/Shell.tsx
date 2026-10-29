import { useEffect, useState, type ReactNode } from 'react';
import { can, type Me } from '@gp/core';
import { api } from './auth/api.ts';
import { forgetSession, saveDeviceToken } from './auth/session.ts';
import { REPAIR_KEY } from './Boot.tsx';
import { useDbStatus } from './db/react.tsx';
import { t, type TextKey } from './i18n.ts';
import { AppButton } from './ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from './ui/Dropdown.tsx';
import {
  BarsIcon,
  BookOpenIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CogIcon,
  DesktopIcon,
  DevicesIcon,
  KeyIcon,
  LogoIcon,
  MenuIcon,
  MusicalNoteIcon,
  PhotoIcon,
  SettingsIcon,
  SignOutIcon,
  SpeakerWaveIcon,
  SquaresOverlapIcon,
  UserIcon,
  UsersIcon,
  ViewGridIcon,
  WarningIcon,
} from './ui/icons.tsx';
import { href, type Route } from './ui/router.ts';

// The frame around the signed-in app, as the current app's Layout/MainLayout.razor
// and Layout/AdminLayout.razor: a bar at the top, and a menu at the side of the admin pages.

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

/**
 * How the sync stands, as a cloud in the bar (Components/SyncStatusIndicator.razor):
 * synced, offline, or a warning, with a dot while changes wait. The words
 * are there for screen readers, and are what the tests read.
 */
function SyncStatus() {
  const s = useDbStatus();
  if (!s) return null;
  const warn = s.authError === 'device-not-paired' || s.authError === 'unauthenticated' || s.authError === 'not-a-member' || s.rejected.length > 0;
  const connection = t(s.connected ? 'status.connected' : 'status.offline');
  const pending = s.pending > 0 ? t('status.pending', { n: s.pending }) : null;
  return (
    <div data-testid="status" className="relative size-8 flex items-center justify-center" title={[connection, pending].filter(Boolean).join(' · ')}>
      {warn ? (
        <WarningIcon className="size-5 text-amber-500" />
      ) : s.connected ? (
        <CloudCheckIcon className="size-5 text-neutral-400 dark:text-neutral-500" />
      ) : (
        <CloudOffIcon className="size-5 text-neutral-400 dark:text-neutral-500" />
      )}
      {pending && <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-sky-500" />}
      <span className="sr-only">{connection}</span>
      {pending && <span className="sr-only">{pending}</span>}
    </div>
  );
}

/**
 * What needs the user's attention (sign in again, pair again, a refused
 * change, data only in memory), in a strip under the bar until it is dealt
 * with. In the page's flow, so it never covers a button.
 */
function SyncWarnings() {
  const s = useDbStatus();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => setError(e.reason instanceof Error ? e.reason.message : String(e.reason));
    addEventListener('unhandledrejection', on);
    return () => removeEventListener('unhandledrejection', on);
  }, []);
  const warnings: ReactNode[] = [];
  if (s && s.storage !== 'opfs') warnings.push(t('status.memory', { reason: s.storage }));
  if (s?.updateRequired) warnings.push(t('status.updateRequired'));
  if (s?.authError === 'device-not-paired')
    warnings.push(
      <>
        {t('status.notPaired')}
        <AppButton variant="secondary" className="ml-3 py-1.5!" onClick={pairAgain}>
          {t('status.pairAgain')}
        </AppButton>
      </>,
    );
  if (s?.authError === 'unauthenticated' || s?.authError === 'not-a-member')
    warnings.push(
      <>
        {t('status.authRequired')}
        <AppButton variant="secondary" className="ml-3 py-1.5!" onClick={toSignIn}>
          {t('status.signInAgain')}
        </AppButton>
      </>,
    );
  const last = s?.rejected.at(-1);
  if (last) warnings.push(t('status.rejected', { error: last.error }));
  if (error) warnings.push(<span role="alert">{error}</span>);
  if (!warnings.length) return null;
  return (
    <div data-testid="sync-warnings" className="shrink-0 px-4 py-2 space-y-1 bg-amber-50 dark:bg-amber-950/40 border-b-[0.5px] border-amber-200 dark:border-amber-900 text-sm text-neutral-800 dark:text-neutral-100">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <WarningIcon className="size-5 shrink-0 text-amber-500" />
          <div className="min-w-0 break-words">{w}</div>
        </div>
      ))}
    </div>
  );
}

/** The signed-in user's menu (Components/LoginDisplay.razor): who, their logins, their settings, sign out. */
function AccountMenu({ me }: { me: Me }) {
  const who = `${me.name} · ${me.orgName}`;
  return (
    <Dropdown
      menuClassName="w-60"
      button={{ className: 'block cursor-pointer rounded-full', 'data-testid': 'me', 'aria-label': who, title: who }}
      trigger={
        <span className="size-8 rounded-full bg-neutral-300 dark:bg-neutral-600 shrink-0 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
          <UserIcon className="size-4" />
        </span>
      }
    >
      <div className="px-4 py-3 border-b-[0.5px] border-neutral-200 dark:border-neutral-600">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{me.name}</div>
        {me.email && <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{me.email}</div>}
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{me.orgName}</div>
      </div>
      <a href={href({ page: 'logins', error: null })} className={MENU_ITEM} role="menuitem">
        <KeyIcon className="size-4" />
        {t('logins.title')}
      </a>
      <a href={href({ page: 'settings' })} className={MENU_ITEM} role="menuitem">
        <SettingsIcon className="size-4" />
        {t('nav.settings')}
      </a>
      <div className="border-t-[0.5px] border-neutral-200 dark:border-neutral-600" />
      <AppButton variant="plain" className={MENU_ITEM} role="menuitem" onClick={() => void signOut()}>
        <SignOutIcon className="size-4" />
        {t('auth.signOut')}
      </AppButton>
    </Dropdown>
  );
}

/** The bar at the top: the logo (to the start page), Beta, and at the right the sync, the admin pages and the user; warnings under it. */
export function TopBar({ me }: { me: Me }) {
  return (
    <>
      <nav className="relative flex items-center justify-between px-4 h-12 shrink-0 border-b-[0.5px] border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
        <div className="flex items-center gap-3">
          <a href={href({ page: 'presentations' })} className="flex items-center gap-2 text-sky-500 hover:text-sky-600 no-underline">
            <LogoIcon className="size-6" />
            <span className="text-sm font-semibold uppercase tracking-wide whitespace-nowrap">
              <span className="text-sky-500">Gospel</span> <span className="text-sky-400">Presenter</span>
            </span>
          </a>
          <span className="inline-flex items-center rounded-full bg-orange-500 px-2.5 shrink-0 py-0.5 text-xs font-semibold text-white">{t('app.beta')}</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-6">
          <SyncStatus />
          <AppButton variant="icon" href={href({ page: 'songs' })} title={t('nav.admin')} aria-label={t('nav.admin')} className="bg-neutral-100 dark:bg-neutral-700">
            <CogIcon className="size-4" />
          </AppButton>
          <AccountMenu me={me} />
        </div>
      </nav>
      <SyncWarnings />
    </>
  );
}

interface AdminLink {
  route: Route;
  label: TextKey;
  icon: (p: { className?: string }) => ReactNode;
  /** The pages that light this entry up. */
  pages: Route['page'][];
}

/** The admin menu's entries, in groups; an entry the user may not open is left out (as the pages refuse them). */
function adminLinks(me: Me, host: boolean): AdminLink[][] {
  const groups: (AdminLink | false)[][] = [
    [
      { route: { page: 'songs' }, label: 'nav.songs', icon: MusicalNoteIcon, pages: ['songs', 'song'] },
      can(me.role, 'ManageBibles') && { route: { page: 'bibles' }, label: 'nav.bibles', icon: BookOpenIcon, pages: ['bibles'] },
      can(me.role, 'ViewImages') && { route: { page: 'images' }, label: 'nav.images', icon: PhotoIcon, pages: ['images'] },
      can(me.role, 'ViewAudios') && { route: { page: 'audios' }, label: 'nav.audios', icon: SpeakerWaveIcon, pages: ['audios'] },
    ],
    [
      can(me.role, 'ManageOverlays') && { route: { page: 'overlays' }, label: 'overlays.title', icon: SquaresOverlapIcon, pages: ['overlays', 'overlay'] },
      can(me.role, 'ManageTemplates') && { route: { page: 'templates' }, label: 'nav.templates', icon: ViewGridIcon, pages: ['templates'] },
    ],
    [
      can(me.role, 'ManageRemoteDisplays') && { route: { page: 'displays' }, label: 'nav.displays', icon: DesktopIcon, pages: ['displays'] },
      { route: { page: 'themes' }, label: 'nav.themes', icon: BarsIcon, pages: ['themes'] },
    ],
    [
      can(me.role, 'ViewUsers') && { route: { page: 'users' }, label: 'nav.users', icon: UsersIcon, pages: ['users'] },
      host && can(me.role, 'ManageUsers') && { route: { page: 'devices' }, label: 'nav.devices', icon: DevicesIcon, pages: ['devices'] },
    ],
  ];
  return groups.map((g) => g.filter((l): l is AdminLink => !!l)).filter((g) => g.length > 0);
}

/**
 * The admin pages' frame (Layout/AdminLayout.razor): the menu at the side.
 * From the `lg` size it is always there; below, it covers the page when the
 * admin pages are opened, goes away when a page is chosen, and comes back
 * with the round menu button at the bottom.
 */
export function AdminLayout({ me, host, route, children }: { me: Me; host: boolean; route: Route; children: ReactNode }) {
  const [menuVisible, setMenuVisible] = useState(true);
  return (
    <div className="flex flex-1 min-h-0 relative">
      <div
        className={`bg-black/30 z-[100] absolute inset-0 transition-opacity lg:invisible ${menuVisible ? 'visible opacity-100' : 'invisible opacity-0'}`}
        onClick={() => setMenuVisible(false)}
      />
      <aside
        className={`w-[300px] shrink-0 bg-white dark:bg-neutral-800 overflow-y-auto duration-200 ease-in-out absolute inset-y-0 left-0 z-[110] shadow-xl lg:relative lg:inset-auto lg:z-0 lg:shadow-none lg:visible lg:translate-x-0 ${menuVisible ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}
      >
        <nav className="flex flex-col py-3" aria-label={t('nav.adminMenu')}>
          {adminLinks(me, host).map((group, i) => (
            <div key={i} className="flex flex-col">
              {i > 0 && <div className="my-3 mx-4 h-px bg-neutral-200 dark:bg-neutral-700" />}
              {group.map((l) => {
                const active = l.pages.includes(route.page);
                return (
                  <a
                    key={l.label}
                    href={href(l.route)}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMenuVisible(false)}
                    className={`flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm no-underline ${active ? 'bg-sky-500 text-white' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                  >
                    <l.icon className="w-4 h-4 shrink-0" />
                    {t(l.label)}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {children}
        <div className="flex items-center absolute bottom-0 left-0 right-0 justify-between p-3 z-10 pointer-events-none lg:hidden">
          <AppButton
            variant="plain"
            className="pointer-events-auto cursor-pointer p-4 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
            title={t('nav.menu')}
            aria-label={t('nav.menu')}
            onClick={() => setMenuVisible(true)}
          >
            <MenuIcon className="size-8" />
          </AppButton>
        </div>
      </main>
    </div>
  );
}
