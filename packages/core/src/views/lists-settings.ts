// The Bibles, the themes and the CCLI report (apps/web's Bibler, Teman, the theme editor, CCLI-rapport) (ported back
// from crates/gp-core/src/settings_views.rs, settings_pages.rs).
import { CCLI_COLLECTION_SETTING, DEFAULT_THEME_SETTING } from '../mutation.ts';
import { BUILT_IN_THEMES, CLASSIC, DEFAULT_THEME_ID, type Theme, themeDefinitionSchema } from '../themes.ts';
import type { RunSql } from './sql.ts';
import { type Fields, jsNum, jsString, langOf, mapRow, readJson, select, sortRows } from './lists-rows.ts';
import { argsOf, idOf } from './serde.ts';

// ------------------------------------------------------------------ themes (themes.rs)

/** A built-in theme as a view hands it out: a copy, so no caller changes the one kept here. */
export const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** `themeOfRow` {id, name, definition, sort}: a definition that does not read (as serde_json and zod read it) looks as Classic, the name kept. */
function ownRow(r: unknown[]): Theme {
  const parsed = typeof r[2] === 'string' ? themeDefinitionSchema.safeParse(readJson(r[2])) : undefined;
  const definition = parsed?.success ? parsed.data : copy(CLASSIC.definition);
  // A whole sort past an i64's range is its end, as Rust's `as i64` saturates.
  const sort = typeof r[3] !== 'number' || !Number.isFinite(r[3]) ? 0 : Number.isInteger(r[3]) ? Math.min(2 ** 63, Math.max(-(2 ** 63), r[3])) : r[3];
  return { id: jsString(r[0]), sort, name: jsString(r[1]), description: '', definition };
}

/** The organisation's default theme's id, as stored (null when it has chosen none). */
const defaultThemeId = async (sql: RunSql) => (await sql('SELECT value FROM org_settings WHERE id = ?', [DEFAULT_THEME_SETTING]))[0]?.[0] ?? null;

/**
 * `themeOf`: the theme of a presentation whose theme is `themeId` (null: the organisation's default), else Classic; an
 * own theme's row [id, name, definition, sort] read by `row`.
 */
export async function themeOf(sql: RunSql, themeId: string | null, row: (r: unknown[]) => Theme = ownRow): Promise<Theme> {
  const stored = await defaultThemeId(sql);
  const id = themeId ?? (typeof stored === 'string' ? stored : DEFAULT_THEME_ID);
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === id);
  if (builtIn) return copy(builtIn);
  const [own] = await sql('SELECT id, name, definition, sort FROM themes WHERE id = ?', [id]);
  return own ? row(own) : copy(CLASSIC);
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
  const id = idOf(argsOf(args), 'id');
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
  const [on] = await sql('SELECT value FROM org_settings WHERE id = ?', [CCLI_COLLECTION_SETTING]);
  return { entries, on: on?.[0] === 'true' };
}
