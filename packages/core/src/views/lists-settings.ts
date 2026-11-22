// The Bibles, the themes and the CCLI report (apps/web's Bibler, Teman, the theme editor, CCLI-rapport), and what
// Inställningar's lists and pages offer (ported back from crates/gp-core/src/settings_views.rs, settings_pages.rs'
// `freshNameView` and `themesPageView`, library_pages.rs, mutators.rs' `rules` and views.rs' `coreInfoView`).
import { CUSTOM_LIMITS } from '../custom-slides.ts';
import { MEDIA_LIMITS } from '../media.ts';
import { LIMITS, MAX_VERSES_PER_ITEM } from '../mutation.ts';
import { can, type Permission, type Role } from '../permissions.ts';
import { BUILT_IN_THEMES, CLASSIC, type Theme, themeDefinitionSchema } from '../themes.ts';
import type { RunSql } from './sql.ts';
import { type Args, argsOf, type Fields, idArg, jsNum, jsString, langOf, mapRow, readJson, rustTrim, select, sortRows, textArg } from './lists-rows.ts';

/** `can` for a role as a shell gives it: any text, an unknown one may do nothing. */
export const may = (role: string, permission: Permission) => can(role as Role, permission);

// ------------------------------------------------------------------ themes (themes.rs)

/** A built-in theme as a view hands it out: a copy, so no caller changes the one kept here. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** `themeOfRow` {id, name, definition, sort}: a definition that does not read (as serde_json and zod read it) looks as Classic, the name kept. */
function ownRow(r: unknown[]): Theme {
  const parsed = typeof r[2] === 'string' ? themeDefinitionSchema.safeParse(readJson(r[2])) : undefined;
  const definition = parsed?.success ? parsed.data : copy(CLASSIC.definition);
  // A whole sort past an i64's range is its end, as Rust's `as i64` saturates.
  const sort = typeof r[3] !== 'number' || !Number.isFinite(r[3]) ? 0 : Number.isInteger(r[3]) ? Math.min(2 ** 63, Math.max(-(2 ** 63), r[3])) : r[3];
  return { id: jsString(r[0]), sort, name: jsString(r[1]), description: '', definition };
}

/** The organisation's default theme's id, as stored (null when it has chosen none). */
const defaultThemeId = async (sql: RunSql) => (await sql("SELECT value FROM org_settings WHERE id = 'defaultThemeId'", []))[0]?.[0] ?? null;

/** `themeOf`: the theme of a presentation whose theme is `themeId` (null: the organisation's default), else Classic. */
export async function themeOf(sql: RunSql, themeId: string | null): Promise<Theme> {
  const [stored] = await sql('SELECT value FROM org_settings WHERE id = ?', ['defaultThemeId']);
  const id = themeId ?? (typeof stored?.[0] === 'string' ? stored[0] : 'classic');
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === id);
  if (builtIn) return copy(builtIn);
  const [own] = await sql('SELECT id, name, definition, sort FROM themes WHERE id = ?', [id]);
  return own ? ownRow(own) : copy(CLASSIC);
}

const BIBLE: Fields = [['id', 'str'], ['name', 'str'], ['abbreviation', 'str'], ['language', 'opt'], ['verseCount', 'num'], ['contentHash', 'str'], ['stored', 'bool'], ['kept', 'bool']];

/** `biblesView` {locale}: the translations, whether this device has each one's text and keeps it, by name in the page's language, then id (`listBibles`). */
export async function biblesView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const rows = await sql(
    `SELECT b.id, b.name, b.abbreviation, b.language, b.verse_count, b.content_hash,
             EXISTS (SELECT 1 FROM bible_blobs t WHERE t.hash = b.content_hash), EXISTS (SELECT 1 FROM kept_bibles k WHERE k.id = b.id) FROM bibles b`,
    [],
  );
  return sortRows(langOf(a), rows.map((r) => mapRow(r, BIBLE)), [['name', 'name'], ['id', 'id']]);
}

const ownThemes = async (sql: RunSql) => (await sql('SELECT id, name, definition, sort FROM themes ORDER BY sort, id', [])).map(ownRow);

/** `ownThemesView`: the organisation's own themes in the order they were made (`ownThemes`). */
export const ownThemesView = async (args: unknown, sql: RunSql) => (argsOf(args), ownThemes(sql));

/** `ownThemeView` {id}: an own theme to edit and when it was last saved, null when there is none (`getOwnTheme`). */
export async function ownThemeView(args: unknown, sql: RunSql) {
  const id = idArg(argsOf(args), 'id');
  const [r] = await sql('SELECT id, name, definition, sort, updated_at FROM themes WHERE id = ?', [id]);
  return r ? { theme: ownRow(r), updatedAt: jsNum(r[4]) } : null;
}

/** `defaultThemeIdView`: the organisation's default theme's id, null when it has chosen none (`orgDefaultThemeId`). */
export const defaultThemeIdView = async (args: unknown, sql: RunSql) => (argsOf(args), defaultThemeId(sql));

const CCLI: Fields = [['id', 'str'], ['songId', 'str'], ['songName', 'str'], ['ccli', 'str'], ['presentationId', 'str'], ['presentationName', 'str'], ['date', 'str'], ['reportedAt', 'opt']];

/** `ccliReportView` {locale}: {entries newest day first, then by presentation and song name in the page's language (SONG-R52), whether collection is on (SONG-R49: only "true" is)}. */
export async function ccliReportView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const entries = sortRows(langOf(a), await select(sql, CCLI, 'ccli_entries ORDER BY date DESC'), [['desc', 'date'], ['name', 'presentationName'], ['id', 'presentationId'], ['name', 'songName']]);
  const [on] = await sql("SELECT value FROM org_settings WHERE id = 'ccliCollection'", []);
  return { entries, on: on?.[0] === 'true' };
}

/**
 * `themesPageView` {role}: Teman as the page shows it (the web's Themes.tsx `themeChoices`): the two built-in themes
 * first (their names' and descriptions' keys), then the organisation's own in their order; which is the `default`
 * (Classic where none is chosen, or the one chosen is gone); and each theme's `actions` for one who may manage themes.
 * `canAdd`: + makes a theme from the default's look.
 */
export async function themesPageView(args: unknown, sql: RunSql) {
  const manage = may(textArg(argsOf(args), 'role'), 'ManageThemes');
  const chosenId = await defaultThemeId(sql);
  const themes: Args[] = [
    ...['classic', 'light'].map((id) => ({ id, name: null, nameKey: `theme.${id}`, descriptionKey: `theme.${id}Description`, builtIn: true })),
    ...(await ownThemes(sql)).map((t) => ({ id: t.id, name: t.name, nameKey: null, descriptionKey: null, builtIn: false })),
  ];
  const chosen = typeof chosenId === 'string' && themes.some((t) => t.id === chosenId) ? chosenId : 'classic';
  const action = (id: string, text: string, icon: string, destructive = false) => ({ id, text, icon, destructive });
  for (const t of themes) {
    const [current, own] = [t.id === chosen, t.builtIn === false];
    t.default = current;
    t.actions = [
      ...(manage && !current ? [action('default', 'themes.useAsDefault', 'tick')] : []),
      ...(manage && own ? [action('edit', 'themes.edit', 'edit')] : []),
      ...(manage ? [action('duplicate', 'themes.duplicate', 'duplicate')] : []),
      ...(manage && own ? [action('delete', 'themes.delete', 'delete', true)] : []),
    ];
  }
  return { themes, default: chosen, canAdd: manage };
}

// ------------------------------------------------------------------ pure views

/**
 * `freshNameView` {base, taken}: `base`, or `base 2`, `base 3` … the first that no name in `taken` is, any case, as
 * Finder names a new folder (the web's `freshName`): what + names a new song, slideshow, overlay or theme.
 */
export function freshNameView(args: unknown): string {
  const a = argsOf(args);
  const base = textArg(a, 'base');
  const taken = new Set((Array.isArray(a.taken) ? a.taken : []).filter((n): n is string => typeof n === 'string').map((n) => rustTrim(n).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

const EVERYONE: Permission[] = ['ViewPresentations', 'ManagePresentations', 'ViewTemplates', 'ViewSongs', 'ManageSongs', 'ViewBibles', 'ViewThemes',
  'ViewImages', 'ManageImages', 'ViewAudios', 'ManageAudios', 'ViewVideos', 'ManageVideos', 'ViewOverlays', 'ManageOverlays'];
const ADMIN: Permission[] = ['ManageTemplates', 'ManageBibles', 'ManageThemes', 'ViewUsers', 'ManageUsers', 'ManageRemoteDisplays',
  'ManageOrganizationSettings', 'ViewCcliReport', 'ManageCcliReport'];

/**
 * `rulesView`: what each role may do, and the limits the mutators hold to, for the shells to show only what will be
 * taken (a button hidden, a field's length); and each field's rule as the mutators check it.
 */
export function rulesView(args: unknown) {
  argsOf(args);
  const of = (role: Role) => [...EVERYONE, ...ADMIN, 'ManageOrganizations' as const].filter((p) => can(role, p));
  return {
    permissions: { user: of('user'), admin: of('admin'), superAdmin: of('superAdmin') },
    limits: {
      songs: LIMITS.songs, partsPerSong: LIMITS.partsPerSong, arrangementsPerSong: LIMITS.arrangementsPerSong, itemsPerPresentation: LIMITS.itemsPerPresentation,
      versesPerItem: MAX_VERSES_PER_ITEM, customSlides: CUSTOM_LIMITS.slides, customElements: CUSTOM_LIMITS.elements, customPages: CUSTOM_LIMITS.pages,
      customText: CUSTOM_LIMITS.text, fileName: MEDIA_LIMITS.fileName,
    },
    // The most characters of a name (base.ts's `name`), an item's note, a presentation's place and description.
    fields: {
      presentationName: { required: true, max: 200 },
      itemTitle: { required: true, max: 200 },
      itemNote: { required: false, max: 200 },
      location: { required: false, max: 100 },
      description: { required: false, max: 5000 },
    },
  };
}

/** `coreInfoView`: what the running core is, for Om Gospel Presenter: the Rust crate's name and version, as it answered. */
export const coreInfoView = (args: unknown) => (argsOf(args), { name: 'gp-core', version: '0.1.0' });
