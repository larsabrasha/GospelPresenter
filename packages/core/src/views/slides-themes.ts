// The theme a presentation shows (ADR 0008; ported back from crates/gp-core/src/themes.rs): a built-in one, the
// organisation's own, and which one a presentation gets: its own, else the organisation's default, else Classic
// (THEME-R1), as lists-settings.ts's `themeOf` resolves it. An own theme's definition is read here as serde.ts reads
// JSON, its sort as any number; Teman's views read theirs as lists-rows.ts does.
import { CLASSIC, themeDefinitionSchema, type Theme } from '../themes.ts';
import type { RunSql } from './sql.ts';
import { jsString } from './lists-rows.ts';
import { copy, themeOf } from './lists-settings.ts';
import { argsOf, asF64, asStr, optId, parseJson } from './serde.ts';

/** `themeOfRow` [id, name, definition, sort]: a definition that does not read looks as Classic, the name kept. */
function ownRow(r: unknown[]): Theme {
  const text = asStr(r[2]);
  const parsed = text === null ? null : themeDefinitionSchema.safeParse(parseJson(text));
  return { id: jsString(r[0]), sort: asF64(r[3]) ?? 0, name: jsString(r[1]), description: '', definition: parsed?.success ? parsed.data : copy(CLASSIC.definition) };
}

/** `themeView` {id}: the theme `id` (null: the organisation's default), as `themeOf` resolves it. */
export const themeView = (args: unknown, sql: RunSql): Promise<Theme> => themeOf(sql, optId(argsOf(args), 'id'), ownRow);
