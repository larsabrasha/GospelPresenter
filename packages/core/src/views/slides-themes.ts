// The theme a presentation shows (ADR 0008; ported back from crates/gp-core/src/themes.rs): a built-in one, the
// organisation's own, and which one a presentation gets: its own, else the organisation's default, else Classic
// (THEME-R1), as lists-settings.ts's `themeOf` resolves and reads it.
import type { Theme } from '../themes.ts';
import type { RunSql } from './sql.ts';
import { themeOf } from './lists-settings.ts';
import { argsOf, optId } from './serde.ts';

/** `themeView` {id}: the theme `id` (null: the organisation's default), as `themeOf` resolves it. */
export const themeView = (args: unknown, sql: RunSql): Promise<Theme> => themeOf(sql, optId(argsOf(args), 'id'));
