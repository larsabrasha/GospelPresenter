// A view's arguments and stored JSON read as the Rust core read them (serde_json's `Value`, ADR 0008): what counts as
// an integer, a number, a text or an object there, and the refusal of arguments that are not an object.
import { MutationError } from '../mutation.ts';

/** A JSON object's fields. */
export type Obj = Record<string, unknown>;

/** `invalid-args`, the refusal of arguments that do not read. */
export const invalidArgs = (): MutationError => new MutationError('invalid-args');

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The view's arguments: an object, else `invalid-args` (mutators.rs `run`). */
export function argsOf(args: unknown): Obj {
  if (!isObj(args)) throw invalidArgs();
  return args;
}

/** JavaScript's truthiness of a text: a string that is not empty. */
export const filled = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * Two JSON values alike, as serde_json's `Value` compares them: objects by their fields, whatever their order; a value
 * left out (undefined) as null, as JSON carries it.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  const [x, y] = [a ?? null, b ?? null];
  if (Array.isArray(x)) return Array.isArray(y) && x.length === y.length && x.every((v, i) => sameJson(v, y[i]));
  if (isObj(x)) return isObj(y) && Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => Object.hasOwn(y, k) && sameJson(x[k], y[k]));
  return x === y;
}

/** `as_str`. */
export const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** A text, else "" (`s(&r[0])`: a column read as text). */
export const strOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `as_f64`: any number JSON carries (NaN and the infinities travel as null). */
export const asF64 = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `as_i64`: a whole number JSON writes without a point that fits an i64. */
export const asI64 = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= -(2 ** 63) && v < 2 ** 63 ? v : null);

/** `as_bool`. */
export const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** A text's first code point at most `max` long (`chars().count()`). */
export const charsAtMost = (s: string, max: number): boolean => s.length <= max || [...s].length <= max;

/** `id`: a text of 1–100 characters. */
export function idOf(o: Obj, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0 || !charsAtMost(v, 100)) throw invalidArgs();
  return v;
}

/** `opt_id`: absent or null, else an id. */
export const optId = (o: Obj, k: string): string | null => (o[k] === undefined || o[k] === null ? null : idOf(o, k));

/** `int(lo, hi)`: a number without a fraction in the range. */
export function intIn(o: Obj, k: string, lo: number, hi: number): number {
  const f = asF64(o[k]);
  if (f === null || !Number.isInteger(f) || f < lo || f > hi) throw invalidArgs();
  return f;
}

/** Rust's white space (`char::is_whitespace`, `trim`, `split_whitespace`): JavaScript's without U+FEFF, with U+0085. */
const RUST_SPACES = [9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
const RUST_CLASS = `[${String.fromCharCode(...RUST_SPACES)}]`;
/** A run of Rust's white space. */
export const RUST_SPACE_RUN = new RegExp(`${RUST_CLASS}+`, 'u');
const RUST_EDGES = new RegExp(`^${RUST_CLASS}+|${RUST_CLASS}+$`, 'gu');

/** `str::trim`. */
export const rustTrim = (s: string): string => s.replace(RUST_EDGES, '');

/** Whether a parsed value holds what serde_json refuses to read: a lone surrogate, a number out of range. */
function unreadable(v: unknown): boolean {
  if (typeof v === 'string') return /\p{Surrogate}/u.test(v);
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(unreadable);
  if (isObj(v)) return Object.entries(v).some(([k, x]) => unreadable(k) || unreadable(x));
  return false;
}

/** `serde_json::from_str::<Value>`: the value, or undefined where it does not read. */
export function parseJson(text: string): unknown {
  try {
    const v: unknown = JSON.parse(text);
    return unreadable(v) ? undefined : v;
  } catch {
    return undefined;
  }
}

/** Whether JSON `text`, read already as numbers and texts alone, has a number serde reads as a float: with a point or an exponent, or -0. */
export function hasFraction(text: string): boolean {
  let inText = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inText) {
      if (c === '\\') i++;
      else if (c === '"') inText = false;
    } else if (c === '"') inText = true;
    else if (c === '.' || c === 'e' || c === 'E' || (c === '-' && text[i + 1] === '0')) return true;
  }
  return false;
}

/** JavaScript's `<` order of strings: by UTF-16 code units. */
export const byUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rust's `str` order: by code point (UTF-8's bytes), not UTF-16's units. */
export function byCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  const [x, y] = [[...a], [...b]];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}
