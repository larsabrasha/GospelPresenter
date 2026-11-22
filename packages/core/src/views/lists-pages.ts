// What Inställningar's list and its libraries' lists can do, the same for every shell (ported back from
// crates/gp-core/src/library_pages.rs and settings_models.rs' `settingsListView` and `settingsSearchView`). The words
// are the shell's: only i18n.ts's keys are given.
import { MutationError } from '../mutation.ts';
import type { Permission } from '../permissions.ts';
import { argsOf, rustTrim, rustWords, textArg } from './lists-rows.ts';
import { may } from './lists-settings.ts';

// ------------------------------------------------------------------ libraryPageView (library_pages.rs)

/** An action: its id, its text's key, whether it removes, and the row's field it needs (`when`). */
const action = (id: string, text: string, destructive = false, when: string | null = null) => ({ id, text, destructive, when });
const rename = () => action('rename', 'library.rename');
const download = () => action('download', 'library.download');
/** Radera on a row: one word for every library, as the web's (`images.remove`). */
const remove = () => action('delete', 'images.remove', true);
const deletePicked = () => action('delete', 'common.delete', true);
/** The page's + (`new` makes one, `import` picks files) and a second action beside it. */
const add = (id: string, text: string) => ({ id, text });
const extra = (text: string, title: string) => ({ id: 'import', text, title });

type Action = ReturnType<typeof action>;

/**
 * `libraryPageView` {kind, role, host?}: what the list of `kind` can do for `role`: `list` (a `collection` or `pages`),
 * what a row `opens`, the page's `add` and `extra`, whether rows may be picked (`pick`, `pickOnly`), the actions for
 * the rows `picked` and a `row`'s menu, in order.
 */
export function libraryPageView(args: unknown) {
  const a = argsOf(args);
  const kind = textArg(a, 'kind');
  const role = typeof a.role === 'string' ? a.role : '';
  const host = a.host === true;
  const manage = (p: Permission) => may(role, p);
  type Add = ReturnType<typeof add> | null;
  const page = (list: string, opens: string, plus: Add, beside: object | null, pick: boolean, picked: Action[], row: Action[]) => ({
    kind, list, opens, add: plus, extra: beside, pick, pickOnly: null as string | null, picked: pick ? picked : [], row,
  });
  // A file library: the files may be looked at by all, imported, picked and acted on by one who manages them.
  const files = (permission: Permission, row: Action[]) => {
    const m = manage(permission);
    return page('collection', 'preview', m ? add('import', 'images.import') : null, null, m, [download(), deletePicked()], m ? row : []);
  };
  switch (kind) {
    case 'songs':
      return page('collection', 'page', add('new', 'songs.new'), extra('songs.import.short', 'songs.import.menu'), true, [deletePicked()], [rename(), remove()]);
    case 'bibles':
      return page('collection', 'page', add('import', 'images.import'), null, true, [deletePicked()], [remove()]);
    case 'images':
      return files('ManageImages', [action('edit', 'images.edit'), action('revert', 'images.revert', false, 'originalFullHash'), rename(), download(), remove()]);
    case 'audios':
      return files('ManageAudios', [rename(), download(), remove()]);
    case 'videos':
      return files('ManageVideos', [rename(), download(), remove()]);
    case 'customSlides':
      return page('collection', 'page', add('new', 'customSlides.new'), extra('slides.importShort', 'slides.import'), true, [deletePicked()], [
        action('replace', 'slideDecks.replace', false, 'fromDeck'), rename(), remove(),
      ]);
    case 'overlays':
      return page('collection', 'page', add('new', 'common.create'), null, true, [deletePicked()], [rename(), remove()]);
    case 'labels':
      return page('collection', 'sheet', add('new', 'common.create'), null, true, [deletePicked()], []);
    case 'themes': {
      const m = manage('ManageThemes');
      const p = page('collection', 'page', m ? add('new', 'themes.new') : null, null, m, [deletePicked()], []);
      if (m) p.pickOnly = 'own';
      return p;
    }
    case 'trash':
      return page('collection', 'none', null, null, true, [action('restore', 'common.restore'), action('purge', 'common.delete', true)], [
        action('restore', 'common.restore'), action('purge', 'trash.purge', true),
      ]);
    // Ny användare on a host, which makes one; elsewhere an invitation.
    case 'users':
      return page('pages', 'page', manage('ManageUsers') ? add('new', host ? 'users.create' : 'users.invite') : null, null, false, [], []);
    case 'devices':
      return page('pages', 'none', add('new', 'devices.pair'), null, false, [], []);
    case 'orgs':
      return page('pages', 'page', add('new', 'common.create'), null, false, [], []);
    default:
      throw new MutationError('invalid-args', 'kind');
  }
}

// ------------------------------------------------------------------ Inställningar's list (settings_models.rs)

/** A row's icon square, as iOS's Settings colours its rows: its Tailwind name and its hex. */
const HEX: Record<string, string> = {
  'blue-500': '#3b82f6', 'amber-700': '#b45309', 'rose-500': '#f43f5e', 'orange-500': '#f97316', 'purple-500': '#a855f7', 'orange-700': '#c2410c',
  'indigo-500': '#6366f1', 'green-500': '#22c55e', 'sky-500': '#0ea5e9', 'sky-600': '#0284c7', 'cyan-500': '#06b6d4', 'teal-500': '#14b8a6',
  'indigo-600': '#4f46e5', 'red-500': '#ef4444',
};

/** A row: the page it opens, its name's key, its icon, its square's colour, the key of the other words a search finds it by, the key of what the page is for, and whether it is Mina inställningar's. */
type Row = [id: string, text: string, icon: string, colour: string, keywords: string, intro: string | null, mine?: boolean];

const rowJson = ([id, text, icon, colour, keywords, intro, mine]: Row) => ({
  id, text, icon, colour: { name: colour, hex: HEX[colour] ?? '#78716c' }, keywords, intro, where: mine ? 'nav.settings' : null,
});

/** The permission a row needs, none for everyone's; Enheter is the desktop host's only. */
const NEEDS: Record<string, Permission> = {
  bibles: 'ManageBibles', images: 'ViewImages', audios: 'ViewAudios', videos: 'ViewVideos', customSlides: 'ManagePresentations', overlays: 'ManageOverlays',
  labels: 'ManageSongs', displays: 'ManageRemoteDisplays', ccliReport: 'ViewCcliReport', users: 'ViewUsers', devices: 'ManageUsers',
  orgSettings: 'ManageOrganizationSettings', orgs: 'ManageOrganizations', reports: 'ManageOrganizations',
};

/** The list's groups in order, each its title's key (none for Papperskorg and Om Gospel Presenter, apart at the foot) and its rows. */
const GROUPS: [string, string | null, Row[]][] = [
  ['library', 'settings.group.library', [
    ['songs', 'nav.songs', 'song', 'blue-500', 'search.songs', null],
    ['bibles', 'nav.bibles', 'bible', 'amber-700', 'search.bibles', null],
    ['images', 'nav.images', 'image', 'rose-500', 'search.images', null],
    ['audios', 'nav.audios', 'audio', 'orange-500', 'search.audios', null],
    ['videos', 'nav.videos', 'video', 'purple-500', 'search.videos', null],
    ['customSlides', 'nav.customSlides', 'slides', 'orange-700', 'search.customSlides', null],
  ]],
  ['presentation', 'settings.group.presentation', [
    ['overlays', 'overlays.title', 'overlay', 'indigo-500', 'search.overlays', 'intro.overlays'],
    ['labels', 'nav.labels', 'label', 'green-500', 'search.labels', 'intro.labels'],
  ]],
  ['display', 'settings.group.display', [
    ['displays', 'nav.displays', 'display', 'sky-500', 'search.displays', 'intro.displays'],
    ['themes', 'nav.themes', 'theme', 'stone-500', 'search.themes', 'themes.text'],
    ['ccliReport', 'nav.ccliReport', 'ccli', 'cyan-500', 'search.ccliReport', 'intro.ccliReport'],
  ]],
  ['church', 'settings.group.church', [
    ['users', 'nav.users', 'users', 'blue-500', 'search.users', null],
    ['devices', 'nav.devices', 'devices', 'teal-500', 'search.devices', 'intro.devices'],
    ['orgSettings', 'nav.orgSettings', 'settings', 'stone-500', 'search.orgSettings', 'intro.orgSettings'],
    ['orgs', 'nav.orgs', 'orgs', 'indigo-600', 'search.orgs', null],
    ['reports', 'nav.reports', 'bug', 'red-500', 'search.reports', null],
  ]],
  ['trash', null, [['trash', 'nav.trash', 'trash', 'stone-500', 'search.trash', null]]],
  ['about', null, [['about', 'nav.about', 'about', 'stone-500', 'search.about', null]]],
];

/** What Mina inställningar holds, for the search only: its choices and its pages, each found by its own name. */
const MINE: Row[] = [
  ['settings', 'settings.theme', 'appearance', 'blue-500', 'search.theme', null, true],
  ['settings', 'settings.language', 'language', 'sky-600', 'search.language', null, true],
  ['storage', 'storage.title', 'storage', 'stone-500', 'search.storage', null, true],
  ['logins', 'logins.title', 'user', 'stone-500', 'search.logins', null, true],
  ['myReports', 'myReports.title', 'bug', 'red-500', 'search.myReports', null, true],
];

/** `role` and `host` of the arguments: the role must be given. */
function flags(args: unknown) {
  const a = argsOf(args);
  return { a, role: textArg(a, 'role'), host: a.host === true };
}

/** Whether `role` (on a desktop host or not) may open the row: as the pages refuse the others, the list leaves them out. */
const shown = ([id]: Row, role: string, host: boolean) => (id !== 'devices' || host) && (!Object.hasOwn(NEEDS, id) || may(role, NEEDS[id]!));

/** `settingsListView` {role, host}: the list's groups in order, each its `id`, `title` and `rows`; a row the user may not open is left out, and a group left empty. */
export function settingsListView(args: unknown) {
  const { role, host } = flags(args);
  return GROUPS.flatMap(([id, title, rows]) => {
    const shownRows = rows.filter((r) => shown(r, role, host)).map(rowJson);
    return shownRows.length ? [{ id, title, rows: shownRows }] : [];
  });
}

/** Lower case, accents kept (å, ä and ö are letters of their own in Swedish), as the web's `fold`. */
const fold = (s: string) => rustTrim(s).toLowerCase();

/**
 * `settingsSearchView` {role, host, query, texts}: the rows `query` finds, in the list's order and then Mina
 * inställningar's: a row whose name or other words hold every word of the query, by `texts` ({key: words}, the
 * shell's i18n). Empty for an empty query.
 */
export function settingsSearchView(args: unknown) {
  const { a, role, host } = flags(args);
  const words = rustWords(fold(typeof a.query === 'string' ? a.query : ''));
  if (!words.length) return [];
  const texts = a.texts && typeof a.texts === 'object' && !Array.isArray(a.texts) ? (a.texts as Record<string, unknown>) : {};
  const said = (k: string) => (Object.hasOwn(texts, k) && typeof texts[k] === 'string' ? texts[k] : '');
  const rows = [...GROUPS.flatMap(([, , rs]) => rs.filter((r) => shown(r, role, host))), ...MINE];
  return rows.filter((r) => words.every((w) => fold(`${said(r[1])},${said(r[4])}`).includes(w))).map(rowJson);
}
