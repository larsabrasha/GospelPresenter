// Inställningar's list (docs/layout-2-0.md): its groups and rows, apart from the page so they can be tested.
import type { ReactNode } from 'react';
import { can, type Me } from '@gp/core';
import type { TextKey } from '../../i18n.ts';
import {
  BarsIcon,
  BookOpenIcon,
  CcliReportIcon,
  CogIcon,
  DesktopIcon,
  DevicesIcon,
  InformationCircleIcon,
  MusicalNoteIcon,
  PhotoIcon,
  SpeakerWaveIcon,
  SquaresOverlapIcon,
  TagIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
  ViewGridIcon,
} from '../../ui/icons.tsx';
import type { Route } from '../../ui/router.ts';

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
}

export interface SettingsGroup {
  /** None for Om Gospel Presenter, apart at the foot. */
  title: TextKey | null;
  links: SettingsLink[];
}

/** The profile cell at the top: Mina inställningar, and its sign-in methods under it. */
export const MINE: Pick<SettingsLink, 'route' | 'pages'> = { route: { page: 'settings' }, pages: ['settings', 'logins'] };

/** The groups of the list; a row the user may not open is left out (as the pages refuse them), and so is an empty group. */
export function settingsGroups(me: Pick<Me, 'role'>, host: boolean): SettingsGroup[] {
  const groups: { title: TextKey | null; links: (SettingsLink | false)[] }[] = [
    {
      title: 'settings.group.library',
      links: [
        { route: { page: 'songs' }, label: 'nav.songs', icon: MusicalNoteIcon, colour: 'bg-blue-500', pages: ['songs', 'song', 'songHistory'] },
        can(me.role, 'ManageBibles') && { route: { page: 'bibles' }, label: 'nav.bibles', icon: BookOpenIcon, colour: 'bg-amber-700', pages: ['bibles'] },
        can(me.role, 'ViewImages') && { route: { page: 'images' }, label: 'nav.images', icon: PhotoIcon, colour: 'bg-rose-500', pages: ['images'] },
        can(me.role, 'ViewAudios') && { route: { page: 'audios' }, label: 'nav.audios', icon: SpeakerWaveIcon, colour: 'bg-orange-500', pages: ['audios'] },
        can(me.role, 'ViewVideos') && { route: { page: 'videos' }, label: 'nav.videos', icon: VideoIcon, colour: 'bg-purple-500', pages: ['videos'] },
      ],
    },
    {
      title: 'settings.group.presentation',
      links: [
        can(me.role, 'ManageOverlays') && { route: { page: 'overlays' }, label: 'overlays.title', icon: SquaresOverlapIcon, colour: 'bg-indigo-500', pages: ['overlays', 'overlay'], intro: 'intro.overlays' },
        can(me.role, 'ManageTemplates') && { route: { page: 'templates' }, label: 'nav.templates', icon: ViewGridIcon, colour: 'bg-cyan-600', pages: ['templates'], intro: 'intro.templates' },
        can(me.role, 'ManageSongs') && { route: { page: 'labels' }, label: 'nav.labels', icon: TagIcon, colour: 'bg-green-500', pages: ['labels'], intro: 'intro.labels' },
      ],
    },
    {
      title: 'settings.group.display',
      links: [
        can(me.role, 'ManageRemoteDisplays') && { route: { page: 'displays' }, label: 'nav.displays', icon: DesktopIcon, colour: 'bg-sky-500', pages: ['displays'], intro: 'intro.displays' },
        { route: { page: 'themes' }, label: 'nav.themes', icon: BarsIcon, colour: 'bg-stone-500', pages: ['themes'], intro: 'themes.text' },
        can(me.role, 'ViewCcliReport') && { route: { page: 'ccliReport' }, label: 'nav.ccliReport', icon: CcliReportIcon, colour: 'bg-cyan-500', pages: ['ccliReport'], intro: 'intro.ccliReport' },
      ],
    },
    {
      title: 'settings.group.church',
      links: [
        can(me.role, 'ViewUsers') && { route: { page: 'users' }, label: 'nav.users', icon: UsersIcon, colour: 'bg-blue-500', pages: ['users', 'user'] },
        host && can(me.role, 'ManageUsers') && { route: { page: 'devices' }, label: 'nav.devices', icon: DevicesIcon, colour: 'bg-teal-500', pages: ['devices'], intro: 'intro.devices' },
        can(me.role, 'ManageOrganizationSettings') && { route: { page: 'orgSettings' }, label: 'nav.orgSettings', icon: CogIcon, colour: 'bg-stone-500', pages: ['orgSettings'], intro: 'intro.orgSettings' },
        // The SuperAdmin's pages, across organisations (spec 01 sidebar).
        can(me.role, 'ManageOrganizations') && { route: { page: 'orgs' }, label: 'nav.orgs', icon: ViewGridIcon, colour: 'bg-indigo-600', pages: ['orgs', 'org'] },
      ],
    },
    // The one trash for everything deleted (Lars, 2026-11-02), rather than one beside every list.
    { title: null, links: [{ route: { page: 'trash', kind: null }, label: 'nav.trash', icon: TrashIcon, colour: 'bg-stone-500', pages: ['trash'] }] },
    { title: null, links: [{ route: { page: 'about' }, label: 'nav.about', icon: InformationCircleIcon, colour: 'bg-stone-500', pages: ['about'] }] },
  ];
  return groups.map((g) => ({ title: g.title, links: g.links.filter((l): l is SettingsLink => !!l) })).filter((g) => g.links.length > 0);
}

/** Whether `link` is the row of the page open; on a computer the list alone (`/admin`) shows the songs. */
export function isOpen(link: Pick<SettingsLink, 'pages'>, route: Route): boolean {
  const page = route.page === 'admin' ? 'songs' : route.page;
  return link.pages.includes(page);
}
