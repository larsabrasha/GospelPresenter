// The theme a presentation shows (ADR 0008; ported back from crates/gp-core/src/themes.rs): a built-in one, the
// organisation's own, and which one a presentation gets: its own, else the organisation's default, else Classic
// (THEME-R1). The presentation page and the live views are to read it through `themeOf` (exported once they import it).
import { BUILT_IN_THEMES, CLASSIC, themeDefinitionSchema, type Theme } from '../themes.ts';
import type { RunSql } from './sql.ts';
import { argsObj, asF64, asStr, optId, parseJson } from './serde.ts';

/** A fresh copy of a built-in theme, as the Rust core's JSON gave one. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** `String(x)` of a column: a text as it is, a number as JavaScript prints it, anything else as "null". */
const jsString = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : 'null');

/** `themeOfRow` [id, name, definition, sort]: a definition that does not read looks as Classic, the name kept. */
function ownRow(r: unknown[]): Theme {
  const text = asStr(r[2]);
  const parsed = text === null ? null : themeDefinitionSchema.safeParse(parseJson(text));
  return { id: jsString(r[0]), sort: asF64(r[3]) ?? 0, name: jsString(r[1]), description: '', definition: parsed?.success ? parsed.data : copy(CLASSIC.definition) };
}

/** `themeOf`: the theme of a presentation whose theme is `themeId` (null: the organisation's default). */
async function themeOf(themeId: string | null, sql: RunSql): Promise<Theme> {
  const fallback = asStr((await sql('SELECT value FROM org_settings WHERE id = ?', ['defaultThemeId']))[0]?.[0]);
  const id = themeId ?? fallback ?? 'classic';
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === id);
  if (builtIn) return copy(builtIn);
  const own = (await sql('SELECT id, name, definition, sort FROM themes WHERE id = ?', [id]))[0];
  return own ? ownRow(own) : copy(CLASSIC);
}

/** `themeView` {id}: the theme `id` (null: the organisation's default), as `themeOf` resolves it. */
export const themeView = (args: unknown, sql: RunSql): Promise<Theme> => themeOf(optId(argsObj(args), 'id'), sql);
