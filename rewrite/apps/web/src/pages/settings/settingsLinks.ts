// Inställningar's list (docs/layout-2-0.md): its groups and rows, apart from the page so they can be tested.
import type { ReactNode } from 'react';
import { can, type Me } from '@gp/core';
import type { TextKey } from '../../i18n.ts';
import {
  AdjustmentsIcon,
  ArrowDownTrayIcon,
  BarsIcon,
  BookOpenIcon,
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

/** The profile cell at the top: Mina inställningar, and its sign-in methods under it. */
export const MINE: Pick<SettingsLink, 'route' | 'pages'> = { route: { page: 'settings' }, pages: ['settings', 'logins', 'storage'] };

/** The groups of the list; a row the user may not open is left out (as the pages refuse them), and so is an empty group. */
export function settingsGroups(me: Pick<Me, 'role'>, host: boolean): SettingsGroup[] {
  const groups: { title: TextKey | null; links: (SettingsLink | false)[] }[] = [
    {
      title: 'settings.group.library',
      links: [
        { route: { page: 'songs' }, label: 'nav.songs', keywords: 'search.songs', icon: MusicalNoteIcon, colour: 'bg-blue-500', pages: ['songs', 'song', ...SONG_PAGES] },
        can(me.role, 'ManageBibles') && { route: { page: 'bibles' }, label: 'nav.bibles', keywords: 'search.bibles', icon: BookOpenIcon, colour: 'bg-amber-700', pages: ['bibles'] },
        can(me.role, 'ViewImages') && { route: { page: 'images' }, label: 'nav.images', keywords: 'search.images', icon: PhotoIcon, colour: 'bg-rose-500', pages: ['images'] },
        can(me.role, 'ViewAudios') && { route: { page: 'audios' }, label: 'nav.audios', keywords: 'search.audios', icon: SpeakerWaveIcon, colour: 'bg-orange-500', pages: ['audios'] },
        can(me.role, 'ViewVideos') && { route: { page: 'videos' }, label: 'nav.videos', keywords: 'search.videos', icon: VideoIcon, colour: 'bg-purple-500', pages: ['videos'] },
        can(me.role, 'ManagePresentations') && { route: { page: 'customSlides' }, label: 'nav.customSlides', keywords: 'search.customSlides', icon: SlideshowIcon, colour: 'bg-orange-700', pages: ['customSlides', 'customSlide'] },
      ],
    },
    {
      title: 'settings.group.presentation',
      links: [
        can(me.role, 'ManageOverlays') && { route: { page: 'overlays' }, label: 'overlays.title', keywords: 'search.overlays', icon: SquaresOverlapIcon, colour: 'bg-indigo-500', pages: ['overlays', 'overlay'], intro: 'intro.overlays' },
        can(me.role, 'ManageSongs') && { route: { page: 'labels' }, label: 'nav.labels', keywords: 'search.labels', icon: TagIcon, colour: 'bg-green-500', pages: ['labels'], intro: 'intro.labels' },
      ],
    },
    {
      title: 'settings.group.display',
      links: [
        can(me.role, 'ManageRemoteDisplays') && { route: { page: 'displays' }, label: 'nav.displays', keywords: 'search.displays', icon: DesktopIcon, colour: 'bg-sky-500', pages: ['displays', 'publicOutputs'], intro: 'intro.displays' },
        { route: { page: 'themes' }, label: 'nav.themes', keywords: 'search.themes', icon: BarsIcon, colour: 'bg-stone-500', pages: ['themes'], intro: 'themes.text' },
        can(me.role, 'ViewCcliReport') && { route: { page: 'ccliReport' }, label: 'nav.ccliReport', keywords: 'search.ccliReport', icon: CcliReportIcon, colour: 'bg-cyan-500', pages: ['ccliReport'], intro: 'intro.ccliReport' },
      ],
    },
    {
      title: 'settings.group.church',
      links: [
        can(me.role, 'ViewUsers') && { route: { page: 'users' }, label: 'nav.users', keywords: 'search.users', icon: UsersIcon, colour: 'bg-blue-500', pages: ['users', 'user'] },
        host && can(me.role, 'ManageUsers') && { route: { page: 'devices' }, label: 'nav.devices', keywords: 'search.devices', icon: DevicesIcon, colour: 'bg-teal-500', pages: ['devices'], intro: 'intro.devices' },
        can(me.role, 'ManageOrganizationSettings') && { route: { page: 'orgSettings' }, label: 'nav.orgSettings', keywords: 'search.orgSettings', icon: CogIcon, colour: 'bg-stone-500', pages: ['orgSettings'], intro: 'intro.orgSettings' },
        // The SuperAdmin's pages, across organisations (spec 01 sidebar).
        can(me.role, 'ManageOrganizations') && { route: { page: 'orgs' }, label: 'nav.orgs', keywords: 'search.orgs', icon: ViewGridIcon, colour: 'bg-indigo-600', pages: ['orgs', 'org'] },
      ],
    },
    // The one trash for everything deleted (Lars, 2026-11-02), rather than one beside every list.
    { title: null, links: [{ route: { page: 'trash', kind: null }, label: 'nav.trash', keywords: 'search.trash', icon: TrashIcon, colour: 'bg-stone-500', pages: ['trash'] }] },
    { title: null, links: [{ route: { page: 'about' }, label: 'nav.about', keywords: 'search.about', icon: InformationCircleIcon, colour: 'bg-stone-500', pages: ['about'] }] },
  ];
  return groups.map((g) => ({ title: g.title, links: g.links.filter((l): l is SettingsLink => !!l) })).filter((g) => g.links.length > 0);
}

/**
 * What Mina inställningar holds, for the search only: its choices and its pages, each found by its own name (Lars,
 * 2026-11-03), and opening Mina inställningar or the page.
 */
const MINE_LINKS: SettingsLink[] = [
  { route: { page: 'settings' }, label: 'settings.theme', icon: AdjustmentsIcon, colour: 'bg-blue-500', pages: [], keywords: 'search.theme', where: 'nav.settings' },
  { route: { page: 'settings' }, label: 'settings.language', icon: GlobeIcon, colour: 'bg-sky-600', pages: [], keywords: 'search.language', where: 'nav.settings' },
  { route: { page: 'storage' }, label: 'storage.title', icon: ArrowDownTrayIcon, colour: 'bg-stone-500', pages: ['storage'], keywords: 'search.storage', where: 'nav.settings' },
  { route: { page: 'logins', error: null }, label: 'logins.title', icon: UserIcon, colour: 'bg-stone-500', pages: ['logins'], keywords: 'search.logins', where: 'nav.settings' },
];

/** Lower case, accents kept (å, ä and ö are letters of their own in Swedish). */
const fold = (s: string) => s.toLocaleLowerCase('sv').trim();

/**
 * The rows `query` finds, in the list's order and then Mina inställningar's: a row whose name or one of whose words
 * holds every word of the query. `text` gives a key's words (i18n `t`). Empty for an empty query.
 */
export function searchSettings(groups: SettingsGroup[], query: string, text: (key: TextKey) => string): SettingsLink[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rows = [...groups.flatMap((g) => g.links), ...MINE_LINKS];
  return rows.filter((l) => {
    const said = fold([text(l.label), l.keywords ? text(l.keywords) : ''].join(','));
    return words.every((w) => said.includes(w));
  });
}

/** Whether `link` is the row of the page open; on a computer the list alone (`/admin`) shows the songs. */
export function isOpen(link: Pick<SettingsLink, 'pages'>, route: Route): boolean {
  const page = route.page === 'admin' ? 'songs' : route.page;
  return link.pages.includes(page);
}
