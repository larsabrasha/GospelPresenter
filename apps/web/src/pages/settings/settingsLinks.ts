// Inställningar's list (docs/layout-2-0.md): its groups and rows, which rows a role sees, and the search over them,
// as iOS's Settings has them.
import type { ReactNode } from 'react';
import { can, type Me, type Permission, type Role } from '@gp/core';
import type { TextKey } from '../../i18n.ts';
import {
  AdjustmentsIcon,
  ArrowDownTrayIcon,
  BarsIcon,
  BookOpenIcon,
  BugIcon,
  CcliReportIcon,
  CogIcon,
  DesktopIcon,
  DevicesIcon,
  GlobeIcon,
  InformationCircleIcon,
  MusicalNoteIcon,
  PhotoIcon,
  SlideshowIcon,
  SpeakerWaveIcon,
  SquaresOverlapIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  ViewGridIcon,
} from '../../ui/icons.tsx';
import { SONG_PAGES, type Route } from '../../ui/router.ts';

export interface SettingsLink {
  route: Route;
  label: TextKey;
  icon: (p: { className?: string }) => ReactNode;
  /** The icon's square, as iOS's Settings colours its rows. */
  colour: string;
  /** The pages that mark this row as the one open. */
  pages: Route['page'][];
  /** What the page is for, in a card at its top as iOS's Settings has (Lars, 2026-11-02): only where it is not plain. */
  intro?: TextKey;
  /** Other words the search finds the row by, comma-separated (`searchSettings`), as iOS's Settings finds "projector". */
  keywords?: TextKey;
  /** Where a search result lives when it is not a row of the list, in grey under its name, as iOS's Settings shows it. */
  where?: TextKey;
}

export interface SettingsGroup {
  /** None for Om Gospel Presenter, apart at the foot. */
  title: TextKey | null;
  links: SettingsLink[];
}

/** Where a row goes, and the pages that mark it open: by the row's id. */
const ROUTES: Record<string, Pick<SettingsLink, 'route' | 'pages'>> = {
  songs: { route: { page: 'songs' }, pages: ['songs', 'song', ...SONG_PAGES] },
  bibles: { route: { page: 'bibles' }, pages: ['bibles', 'bible'] },
  images: { route: { page: 'images' }, pages: ['images'] },
  audios: { route: { page: 'audios' }, pages: ['audios'] },
  videos: { route: { page: 'videos' }, pages: ['videos'] },
  customSlides: { route: { page: 'customSlides' }, pages: ['customSlides', 'customSlide'] },
  overlays: { route: { page: 'overlays' }, pages: ['overlays', 'overlay'] },
  labels: { route: { page: 'labels' }, pages: ['labels'] },
  displays: { route: { page: 'displays' }, pages: ['displays'] },
  themes: { route: { page: 'themes' }, pages: ['themes', 'theme'] },
  ccliReport: { route: { page: 'ccliReport' }, pages: ['ccliReport'] },
  users: { route: { page: 'users' }, pages: ['users', 'user'] },
  devices: { route: { page: 'devices' }, pages: ['devices'] },
  orgSettings: { route: { page: 'orgSettings' }, pages: ['orgSettings'] },
  orgs: { route: { page: 'orgs' }, pages: ['orgs', 'org'] },
  reports: { route: { page: 'reports' }, pages: ['reports', 'report'] },
  trash: { route: { page: 'trash', kind: null }, pages: ['trash'] },
  about: { route: { page: 'about' }, pages: ['about'] },
  // Mina inställningar's, which the search finds: a choice opens Mina inställningar itself.
  settings: { route: { page: 'settings' }, pages: [] },
  storage: { route: { page: 'storage' }, pages: ['storage'] },
  logins: { route: { page: 'logins', error: null }, pages: ['logins'] },
  myReports: { route: { page: 'myReports' }, pages: ['myReports', 'myReport'] },
};


/** A row of the list, by the page it opens. */
type Row = SettingsLink & { id: string };

/** A row: the page it opens, its name, its icon, its square's colour (a class written out, which Tailwind finds only so), the other words a search finds it by, and what the page is for. */
const row = (id: string, label: TextKey, icon: SettingsLink['icon'], colour: string, keywords: TextKey, intro?: TextKey): Row => ({
  id,
  ...ROUTES[id]!,
  label,
  icon,
  colour,
  keywords,
  ...(intro ? { intro } : {}),
});

/** The list's groups in order, each its title (none for Papperskorg and Om Gospel Presenter, apart at the foot) and its rows. */
const GROUPS: { title: TextKey | null; rows: Row[] }[] = [
  {
    title: 'settings.group.library',
    rows: [
      row('songs', 'nav.songs', MusicalNoteIcon, 'bg-blue-500', 'search.songs'),
      row('bibles', 'nav.bibles', BookOpenIcon, 'bg-amber-700', 'search.bibles'),
      row('images', 'nav.images', PhotoIcon, 'bg-rose-500', 'search.images'),
      row('audios', 'nav.audios', SpeakerWaveIcon, 'bg-orange-500', 'search.audios'),
      row('videos', 'nav.videos', VideoIcon, 'bg-purple-500', 'search.videos'),
      row('customSlides', 'nav.customSlides', SlideshowIcon, 'bg-teal-600', 'search.customSlides'),
    ],
  },
  {
    title: 'settings.group.presentation',
    rows: [
      row('overlays', 'overlays.title', SquaresOverlapIcon, 'bg-indigo-500', 'search.overlays', 'intro.overlays'),
      row('labels', 'nav.labels', TagIcon, 'bg-green-500', 'search.labels', 'intro.labels'),
    ],
  },
  {
    title: 'settings.group.display',
    rows: [
      row('displays', 'nav.displays', DesktopIcon, 'bg-sky-500', 'search.displays', 'intro.displays'),
      row('themes', 'nav.themes', BarsIcon, 'bg-stone-500', 'search.themes', 'themes.text'),
      row('ccliReport', 'nav.ccliReport', CcliReportIcon, 'bg-cyan-500', 'search.ccliReport', 'intro.ccliReport'),
    ],
  },
  {
    title: 'settings.group.church',
    rows: [
      row('users', 'nav.users', UsersIcon, 'bg-blue-500', 'search.users'),
      row('devices', 'nav.devices', DevicesIcon, 'bg-teal-500', 'search.devices', 'intro.devices'),
      row('orgSettings', 'nav.orgSettings', CogIcon, 'bg-stone-500', 'search.orgSettings', 'intro.orgSettings'),
      row('orgs', 'nav.orgs', ViewGridIcon, 'bg-indigo-600', 'search.orgs'),
      row('reports', 'nav.reports', BugIcon, 'bg-red-500', 'search.reports'),
    ],
  },
  { title: null, rows: [row('trash', 'nav.trash', TrashIcon, 'bg-stone-500', 'search.trash')] },
  { title: null, rows: [row('about', 'nav.about', InformationCircleIcon, 'bg-stone-500', 'search.about')] },
];

/** What Mina inställningar holds, for the search only: its choices and its pages, each found by its own name. */
const MY_ROWS: Row[] = [
  row('settings', 'settings.theme', AdjustmentsIcon, 'bg-blue-500', 'search.theme'),
  row('settings', 'settings.language', GlobeIcon, 'bg-sky-600', 'search.language'),
  row('storage', 'storage.title', ArrowDownTrayIcon, 'bg-stone-500', 'search.storage'),
  row('logins', 'logins.title', UserIcon, 'bg-stone-500', 'search.logins'),
  row('myReports', 'myReports.title', BugIcon, 'bg-red-500', 'search.myReports'),
].map((r) => ({ ...r, where: 'nav.settings' }));

/** The permission a row needs, none for everyone's; Enheter is the desktop host's only. */
const NEEDS: Record<string, Permission> = {
  bibles: 'ManageBibles', images: 'ViewImages', audios: 'ViewAudios', videos: 'ViewVideos', customSlides: 'ManagePresentations', overlays: 'ManageOverlays',
  labels: 'ManageSongs', displays: 'ManageRemoteDisplays', ccliReport: 'ViewCcliReport', users: 'ViewUsers', devices: 'ManageUsers',
  orgSettings: 'ManageOrganizationSettings', orgs: 'ManageOrganizations', reports: 'ManageOrganizations',
};

/** Whether `role` (on a desktop host or not) may open the row: as the pages refuse the others, the list leaves them out. */
const shown = (r: Row, role: Role, host: boolean) => (r.id !== 'devices' || host) && (!Object.hasOwn(NEEDS, r.id) || can(role, NEEDS[r.id]!));

/** A row as a link, without its id. */
const linkOf = ({ id: _, ...link }: Row): SettingsLink => link;

/** The profile cell at the top: Mina inställningar, and its sign-in methods under it. */
export const MINE: Pick<SettingsLink, 'route' | 'pages'> = { route: { page: 'settings' }, pages: ['settings', 'logins', 'storage', 'myReports', 'myReport'] };

/** The groups of the list: a row the user may not open is left out (as the pages refuse them), and so is an empty group. */
export function settingsGroups(me: Pick<Me, 'role'>, host: boolean): SettingsGroup[] {
  return GROUPS.flatMap((g) => {
    const links = g.rows.filter((r) => shown(r, me.role, host)).map(linkOf);
    return links.length ? [{ title: g.title, links }] : [];
  });
}

/** Lower case, accents kept (å, ä and ö are letters of their own in Swedish). */
const fold = (s: string) => s.trim().toLowerCase();

/**
 * The rows `query` finds: in the list's order and then Mina inställningar's, a row whose name or one of whose words
 * holds every word of the query. `text` gives a key's words (i18n `t`).
 */
export function searchSettings(me: Pick<Me, 'role'>, host: boolean, query: string, text: (key: TextKey) => string): SettingsLink[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rows = [...GROUPS.flatMap((g) => g.rows.filter((r) => shown(r, me.role, host))), ...MY_ROWS];
  return rows.filter((r) => words.every((w) => fold(`${text(r.label)},${r.keywords ? text(r.keywords) : ''}`).includes(w))).map(linkOf);
}

/** Whether `link` is the row of the page open; on a computer the list alone (`/admin`) shows the songs. */
export function isOpen(link: Pick<SettingsLink, 'pages'>, route: Route): boolean {
  const page = route.page === 'admin' ? 'songs' : route.page;
  return link.pages.includes(page);
}
