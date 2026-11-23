// Inställningar's list (docs/layout-2-0.md): its groups and rows, as the core gives them for every shell
// (`settingsListView`, `settingsSearchView`; crates/gp-core/src/settings_models.rs), and where each row goes here.
import type { ReactNode } from 'react';
import type { Me } from '@gp/core';
import { pageCore } from '../../db/pageCore.ts';
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

/** A row as the core gives it: the page it opens (by its id here), its keys, its icon's name and its square's colour. */
interface CoreRow {
  id: string;
  text: TextKey;
  icon: string;
  colour: { name: string; hex: string };
  keywords: TextKey;
  intro: TextKey | null;
  where: TextKey | null;
}

/** Where a row goes, and the pages that mark it open: navigation is each shell's own. */
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

/** The core's icon names, as the web draws them (Heroicons). */
const ICONS: Record<string, SettingsLink['icon']> = {
  song: MusicalNoteIcon,
  bible: BookOpenIcon,
  image: PhotoIcon,
  audio: SpeakerWaveIcon,
  video: VideoIcon,
  slides: SlideshowIcon,
  overlay: SquaresOverlapIcon,
  label: TagIcon,
  display: DesktopIcon,
  theme: BarsIcon,
  ccli: CcliReportIcon,
  users: UsersIcon,
  devices: DevicesIcon,
  settings: CogIcon,
  orgs: ViewGridIcon,
  bug: BugIcon,
  trash: TrashIcon,
  about: InformationCircleIcon,
  appearance: AdjustmentsIcon,
  language: GlobeIcon,
  storage: ArrowDownTrayIcon,
  user: UserIcon,
};

/** The core's colours by their Tailwind names, as classes written out, which Tailwind finds only so. */
const COLOURS: Record<string, string> = {
  'blue-500': 'bg-blue-500',
  'amber-700': 'bg-amber-700',
  'rose-500': 'bg-rose-500',
  'orange-500': 'bg-orange-500',
  'purple-500': 'bg-purple-500',
  'orange-700': 'bg-orange-700',
  'indigo-500': 'bg-indigo-500',
  'green-500': 'bg-green-500',
  'sky-500': 'bg-sky-500',
  'sky-600': 'bg-sky-600',
  'cyan-500': 'bg-cyan-500',
  'teal-500': 'bg-teal-500',
  'indigo-600': 'bg-indigo-600',
  'red-500': 'bg-red-500',
  'stone-500': 'bg-stone-500',
};

/** The texts of the list and its search, written out here as every text the web shows must be (packages/architecture's texts test). */
const SETTINGS_TEXTS = [
  'settings.group.library', 'settings.group.presentation', 'settings.group.display', 'settings.group.church',
  'nav.songs', 'nav.bibles', 'nav.images', 'nav.audios', 'nav.videos', 'nav.customSlides', 'overlays.title', 'nav.labels',
  'nav.displays', 'nav.themes', 'nav.ccliReport', 'nav.users', 'nav.devices', 'nav.orgSettings', 'nav.orgs', 'nav.reports',
  'nav.trash', 'nav.about', 'settings.theme', 'settings.language', 'storage.title', 'logins.title', 'myReports.title', 'nav.settings',
  'search.songs', 'search.bibles', 'search.images', 'search.audios', 'search.videos', 'search.customSlides', 'search.overlays',
  'search.labels', 'search.displays', 'search.themes', 'search.ccliReport', 'search.users', 'search.devices', 'search.orgSettings',
  'search.orgs', 'search.reports', 'search.trash', 'search.about', 'search.theme', 'search.language', 'search.storage',
  'search.logins', 'search.myReports',
  'intro.overlays', 'intro.labels', 'intro.displays', 'themes.text', 'intro.ccliReport', 'intro.devices', 'intro.orgSettings',
] as const satisfies readonly TextKey[];

function toLink(r: CoreRow): SettingsLink {
  return {
    ...ROUTES[r.id]!,
    label: r.text,
    icon: ICONS[r.icon] ?? CogIcon,
    colour: COLOURS[r.colour.name] ?? 'bg-stone-500',
    keywords: r.keywords,
    ...(r.intro ? { intro: r.intro } : {}),
    ...(r.where ? { where: r.where } : {}),
  };
}

/** The profile cell at the top: Mina inställningar, and its sign-in methods under it. */
export const MINE: Pick<SettingsLink, 'route' | 'pages'> = { route: { page: 'settings' }, pages: ['settings', 'logins', 'storage', 'myReports', 'myReport'] };

/** The groups of the list, the core's: a row the user may not open is left out (as the pages refuse them), and so is an empty group. */
export function settingsGroups(me: Pick<Me, 'role'>, host: boolean): SettingsGroup[] {
  const groups = pageCore().pure<{ title: TextKey | null; rows: CoreRow[] }[]>('settingsListView', { role: me.role, host });
  return groups.map((g) => ({ title: g.title, links: g.rows.map(toLink) }));
}

/**
 * The rows `query` finds, the core's (`settingsSearchView`): in the list's order and then Mina inställningar's, a row
 * whose name or one of whose words holds every word of the query. `text` gives a key's words (i18n `t`).
 */
export function searchSettings(me: Pick<Me, 'role'>, host: boolean, query: string, text: (key: TextKey) => string): SettingsLink[] {
  if (!query.trim()) return [];
  const texts = Object.fromEntries(SETTINGS_TEXTS.map((k) => [k, text(k)]));
  return pageCore().pure<CoreRow[]>('settingsSearchView', { role: me.role, host, query, texts }).map(toLink);
}

/** Whether `link` is the row of the page open; on a computer the list alone (`/admin`) shows the songs. */
export function isOpen(link: Pick<SettingsLink, 'pages'>, route: Route): boolean {
  const page = route.page === 'admin' ? 'songs' : route.page;
  return link.pages.includes(page);
}
