// What the lists' views share (ported back from crates/gp-core/src/rows.rs, args.rs, collation.rs and json.rs): a row
// of the local database as the web's reads gave it, SQLite's snake_case columns mapped to camelCase fields, each
// converted as the web's mapper converts it; the arguments' checks; the order by name in the page's language
// (Intl.Collator, which collation.rs was proved equal to); and JSON text read as the Rust core read it.
import { MutationError } from '../mutation.ts';
import type { Rows, RunSql } from './sql.ts';

/** A view's arguments: an object, else refused as the Rust core refused them. */
export type Args = Record<string, unknown>;

export function argsOf(args: unknown): Args {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new MutationError('invalid-args', 'the arguments are not an object');
  return args as Args;
}

/** `id`: 1–100 characters (code points, as Rust counts them). */
export function idArg(a: Args, key: string): string {
  const v = a[key];
  if (typeof v !== 'string' || v.length === 0 || [...v].length > 100) throw new MutationError('invalid-args', key);
  return v;
}

/** A string argument that must be given; refused otherwise. */
export function textArg(a: Args, key: string): string {
  const v = a[key];
  if (typeof v !== 'string') throw new MutationError('invalid-args', key);
  return v;
}

/** Rust's white space (`char::is_whitespace`, Unicode's White_Space), which `trim` and `split_whitespace` take: U+0085, not U+FEFF. */
const RUST_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const rustTrimmed = new RegExp(`^${RUST_SPACE}+|${RUST_SPACE}+$`, 'g');
const rustTrim = (s: string) => s.replace(rustTrimmed, '');

/** How a field is read: `String(x)`, `Number(x)`, `Boolean(x)`, `x ?? null` (kept as it is), or null kept and anything else `Number(x)`. */
type K = 'str' | 'num' | 'bool' | 'opt' | 'optNum';
export type Fields = readonly (readonly [string, K])[];

/** `String(x)`: a text as it is, a number or a flag written, anything else "null". */
export function jsString(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : 'null';
}

/** A column's value as the Rust core got it, through JSON: a number past a double's range (SQLite's Inf) is null. */
const sqlValue = (v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? null : (v ?? null));

/** `Number(x)` as the Rust core read it: null as 0, a text as Rust parses a number (trimmed, no hex), else null. */
export function jsNum(value: unknown): number | null {
  const v = sqlValue(value);
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return null;
  const t = rustTrim(v);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function jsBool(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v !== '';
  return true;
}

/** A row, its columns in `fields`' order, as an object of those fields. */
export function mapRow(row: unknown[], fields: Fields): Args {
  const out: Args = {};
  fields.forEach(([key, kind], i) => {
    const v = sqlValue(row[i]);
    out[key] = kind === 'str' ? jsString(v) : kind === 'num' ? jsNum(v) : kind === 'bool' ? jsBool(v) : kind === 'opt' ? v : v === null ? null : jsNum(v);
  });
  return out;
}

/** The columns of `fields`, snake_case, for a SELECT in their order. */
export const columns = (fields: Fields) => fields.map(([k]) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)).join(', ');

/** The rows of `fields` from `from` (a table and what follows it), mapped. */
export async function select(sql: RunSql, fields: Fields, from: string, params: unknown[] = []): Promise<Args[]> {
  return ((await sql(`SELECT ${columns(fields)} FROM ${from}`, params)) as Rows).map((r) => mapRow(r, fields));
}

/** `?, ?, …`: `n` parameters. */
export const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** `Song`. */
export const SONG: Fields = [['id', 'str'], ['name', 'str'], ['author', 'opt'], ['publisher', 'opt'], ['year', 'opt'], ['ccli', 'opt'], ['deletedAt', 'opt']];
/** `Presentation`. */
export const PRESENTATION: Fields = [['id', 'str'], ['name', 'str'], ['eventDate', 'opt'], ['deletedAt', 'opt'], ['themeId', 'opt'], ['isTemplate', 'bool'],
  ['weekday', 'opt'], ['time', 'opt'], ['location', 'opt'], ['description', 'opt'], ['updatedAt', 'opt'], ['lastUsedAt', 'opt']];
/** `SongPart`. */
export const PART: Fields = [['id', 'str'], ['songId', 'str'], ['sort', 'num'], ['labelId', 'opt'], ['content', 'str']];
/** `Label`. */
export const LABEL: Fields = [['id', 'str'], ['text', 'str'], ['color', 'str'], ['sort', 'num']];

// ------------------------------------------------------------------ the order by name (collation.rs)

/** The page's language a view is asked in (`locale`, i18n.ts's): English for `en…`, else Swedish. */
export const langOf = (a: Args) => (typeof a.locale === 'string' && a.locale.startsWith('en') ? 'en' : 'sv');

const collators = new Map<string, Intl.Collator>();
const collator = (lang: string, base: boolean) => {
  const key = `${lang} ${base}`;
  let c = collators.get(key);
  if (!c) collators.set(key, (c = new Intl.Collator(lang, base ? { sensitivity: 'base' } : {})));
  return c;
};
/** Names compared as the language orders them, case and accents aside. */
const byName = (lang: string) => collator(lang, true).compare;
/** Ids compared as `localeCompare` without options does: case and accents too. */
const byId = (lang: string) => collator(lang, false).compare;

/** A key rows are ordered by: a name, an id (or a date), one the other way, or a number (missing as -1), smallest or largest first. */
export type Key = ['name' | 'id' | 'desc' | 'asc' | 'last', string];

/** A field as String() has it: a string itself, a number written, else "null". */
const keyText = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : 'null');
const keyNumber = (v: unknown) => (typeof v === 'number' ? v : -1);

/** `rows` ordered by `keys`, ties kept in the order they came. */
export function sortRows(lang: string, rows: Args[], keys: Key[]): Args[] {
  const [names, ids] = [byName(lang), byId(lang)];
  return rows.toSorted((a, b) => {
    for (const [kind, k] of keys) {
      const o =
        kind === 'name' ? names(keyText(a[k]), keyText(b[k])) : kind === 'id' ? ids(keyText(a[k]), keyText(b[k])) : kind === 'desc' ? ids(keyText(b[k]), keyText(a[k])) : kind === 'asc' ? keyNumber(a[k]) - keyNumber(b[k]) : keyNumber(b[k]) - keyNumber(a[k]);
      if (o) return o;
    }
    return 0;
  });
}

// ------------------------------------------------------------------ JSON text as serde_json read it

/** Half a surrogate pair, which serde_json refuses as an escape. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** How deep serde_json reads before it gives up. */
const DEPTH = 128;

/** Whether `v`, an array or object `depth` deep, or one in it, is as deep as serde_json refuses. */
const tooDeep = (v: unknown, depth: number): boolean =>
  !!v && typeof v === 'object' && (depth >= DEPTH || Object.values(v).some((x) => tooDeep(x, depth + 1)));

/**
 * JSON text as the Rust core read it, or undefined where it did not: a number past a double's range, half a surrogate
 * pair written as an escape, or nesting past serde_json's 128.
 */
export function readJson(text: string): unknown {
  let bad = false;
  let value: unknown;
  try {
    value = JSON.parse(text, (_, v: unknown) => {
      if ((typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && LONE_SURROGATE.test(v))) bad = true;
      return v;
    });
  } catch {
    return undefined;
  }
  return bad || tooDeep(value, 1) ? undefined : value;
}
