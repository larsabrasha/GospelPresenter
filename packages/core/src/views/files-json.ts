// The values the views of files read and write as the Rust core had them (ADR 0008; ported back from
// crates/gp-core/src/files.rs, json.rs, ordered.rs and the helpers of media_plan.rs and mutators.rs): arguments as JSON
// carries them, the JSON text of 1.x's and 2.0's files (`parseLegacyJson`; the app's own is stored-json.ts's), whole
// numbers as i64 with its wrapping, `String(v)` and numbers written as Rust wrote them, and strings cut in UTF-16 units.
import { MutationError } from '../mutation.ts';
import { byCodePoint } from './serde.ts';

export type Json = Record<string, unknown>;

/**
 * A view's arguments as JSON carries them to the core (`RustCore`'s `json`), a copy: undefined gone, NaN and infinities
 * null, a bigint a number; an object, else `invalid-args`. serde.ts's `argsOf` takes them as they are.
 */
export function jsonArgs(args: unknown): Json {
  const a = asJson(args);
  if (!isObject(a)) throw new MutationError('invalid-args');
  return a;
}

/** A value as JSON carries it (`RustCore`'s `json`): undefined gone, NaN and infinities null, a bigint a number. */
function asJson(v: unknown): unknown {
  const text = JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? Number(x) : x));
  return text === undefined ? null : (JSON.parse(text) as unknown);
}

/** A JSON object (`Value::Object`): not an array or null. */
export const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map);

/** `v.get(k)`: a field of an object, undefined for anything else. */
export const field = (v: unknown, k: string): unknown => (isObject(v) && Object.hasOwn(v, k) ? v[k] : undefined);

/** `Value::as_str`. */
export const strOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Each text once, in the order first met. */
export const unique = (xs: string[]): string[] => [...new Set(xs)];

/** A unit of a pair that pairs with none as U+FFFD, as a Rust string holds it. */
export function wellFormed(t: string): string {
  if (!/[\ud800-\udfff]/.test(t)) return t;
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const u = t.charCodeAt(i);
    const pair = u >= 0xd800 && u < 0xdc00 && i + 1 < t.length && (t.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    if (pair) out += t[i]! + t[++i]!;
    else out += u >= 0xd800 && u < 0xe000 ? '�' : t[i]!;
  }
  return out;
}

/** At most `max` UTF-16 units, as `slice` cuts; half a pair cut off is U+FFFD (`cut`). */
export const cut = (t: string, max: number): string => (t.length > max ? wellFormed(t.slice(0, max)) : t);

const number = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
/** `Value::as_f64`. */
export const numberOf = number;

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const U64_MAX = 2n ** 64n - 1n;
const INTEGER = /^-?\d+$/;

/** Whether serde_json holds the number as an integer (i64, or u64 past it), as JSON.stringify writes it, and which. */
function integerOf(v: number): bigint | null {
  const lit = JSON.stringify(v);
  if (!INTEGER.test(lit)) return null;
  const b = BigInt(lit);
  return b >= I64_MIN && b <= U64_MAX ? b : null;
}

/** `f as i64`: truncated, NaN 0, saturating. */
function saturate(f: number): bigint {
  if (Number.isNaN(f)) return 0n;
  if (f >= 2 ** 63) return I64_MAX;
  if (f <= -(2 ** 63)) return I64_MIN;
  return BigInt(Math.trunc(f));
}

/** `int_of`: an integer as it is, a float truncated, anything else 0, as an i64. */
export function intOf(v: unknown): bigint {
  if (typeof v === 'bigint') v = Number(v);
  const n = number(v);
  if (n === undefined || !Number.isFinite(n)) return 0n;
  const b = integerOf(n);
  return b !== null && b <= I64_MAX ? b : saturate(n);
}

/** `Value::as_i64`: an integer that fits, else none. */
export function i64Of(v: unknown): bigint | null {
  const n = number(v);
  if (n === undefined || !Number.isFinite(n)) return null;
  const b = integerOf(n);
  return b !== null && b <= I64_MAX ? b : null;
}

/** i64 arithmetic as the Rust core's (wrapping: the WASM was built without overflow checks). */
export const i64 = (x: bigint): bigint => BigInt.asIntN(64, x);

/** JavaScript's `String(v)` of a field that may be missing, as media_plan.rs's `js_string` wrote it. */
export function mediaPlanString(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null';
    const b = integerOf(v);
    if (b !== null && b <= I64_MAX) return b.toString();
    // A float: whole ones with every digit and without their ".0", the rest as serde_json writes them (as JavaScript).
    if (Number.isInteger(v) && Math.abs(v) < 1e21) return Object.is(v, -0) ? '-0' : BigInt(v).toString();
    return String(v);
  }
  if (Array.isArray(v)) return v.map((x) => (x === null ? '' : mediaPlanString(x))).join(',');
  return '[object Object]';
}

/**
 * The JSON text of a 1.x or 2.0 export's rows (the legacy views, files-legacy.ts), as ordered.rs read it: undefined
 * where `JSON.parse` throws, half a UTF-16 pair mended to U+FFFD (in a key too: the two then are one key, the later
 * value in the first's place). The app's own JSON is read strictly, by stored-json.ts.
 */
export function parseLegacyJson(text: string): unknown {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  const fix = (x: unknown): unknown => {
    if (typeof x === 'string') return wellFormed(x);
    if (Array.isArray(x)) return x.map(fix);
    if (x === null || typeof x !== 'object') return x;
    const out: Json = {};
    for (const [k, y] of Object.entries(x)) Object.defineProperty(out, wellFormed(k), { value: fix(y), enumerable: true, writable: true, configurable: true });
    return out;
  };
  return fix(v);
}

/** `js_number`: as JavaScript prints a number, but a whole one below 10²¹ with all its digits, and infinity "inf". */
function jsNumber(f: number): string {
  if (f === 0) return '0';
  if (!Number.isFinite(f)) return f > 0 ? 'inf' : '-inf';
  const a = Math.abs(f);
  if (a < 1e-6 || a >= 1e21 || !Number.isInteger(f)) return String(f);
  return BigInt(f).toString();
}

/** `String(v)` as ordered.rs's `js_string` wrote it: a number by `js_number`, a missing value "undefined". */
export function orderedString(v: unknown): string {
  if (typeof v === 'number') return jsNumber(v);
  if (Array.isArray(v)) return v.map((x) => (x === null ? '' : orderedString(x))).join(',');
  if (v !== null && typeof v === 'object') return '[object Object]';
  return String(v);
}

/** `J::of`: a value of serde_json's, its objects' keys in its order (sorted, as UTF-8 bytes are), kept by a Map. */
export function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (v instanceof Uint8Array) return sortedKeys(Object.fromEntries([...v].map((b, i) => [String(i), b])));
  if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? Number(v) : v;
  return new Map(Object.keys(v).toSorted(byCodePoint).map((k) => [k, sortedKeys((v as Json)[k])]));
}

/** `J::stringify`: JSON text with numbers by `js_number`, a Map's keys in its order. */
export function stringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return jsNumber(v);
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringify).join(',')}]`;
  const entries = v instanceof Map ? [...(v as Map<string, unknown>)] : Object.entries(v);
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stringify(x)}`).join(',')}}`;
}
