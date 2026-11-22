// The values the views of files read and write as the Rust core had them (ADR 0008; ported back from
// crates/gp-core/src/files.rs, json.rs, ordered.rs and the helpers of media_plan.rs and mutators.rs): arguments as JSON
// carries them, JSON text as serde_json read it (refusing what it refused, numbers kept as written), whole numbers as
// i64 with its wrapping, `String(v)` and numbers written as Rust wrote them, and strings cut in UTF-16 units.
import { MutationError } from '../mutation.ts';

export type Json = Record<string, unknown>;

/** A view's arguments: an object, as JSON carries it to the core, else `invalid-args`. */
export function argsOf(args: unknown): Json {
  const a = asJson(args);
  if (!isObject(a)) throw new MutationError('invalid-args');
  return a;
}

/** A value as JSON carries it (`RustCore`'s `json`): undefined gone, NaN and infinities null, a bigint a number. */
function asJson(v: unknown): unknown {
  const text = JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? Number(x) : x));
  return text === undefined ? null : (JSON.parse(text) as unknown);
}

/** A JSON object (`Value::Object`): not an array, null, or a number kept as written. */
export const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RustNumber) && !(v instanceof Map);

/** `v.get(k)`: a field of an object, undefined for anything else. */
export const field = (v: unknown, k: string): unknown => (isObject(v) && Object.hasOwn(v, k) ? v[k] : undefined);

/** `Value::as_str`. */
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** `s(&r[0])`: a column read as text, "" for anything else. */
export const s = (v: unknown): string => (typeof v === 'string' ? v : '');

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

/** A number of JSON text as serde_json read it, where its text is not JavaScript's (`1.0`, `9007199254740993`). */
class RustNumber {
  constructor(
    readonly value: number,
    readonly literal: string,
  ) {}
}

const number = (v: unknown): number | undefined => (typeof v === 'number' ? v : v instanceof RustNumber ? v.value : undefined);
/** `Value::as_f64`. */
export const asF64 = number;

/** How a number is written in JSON text: as JSON.stringify wrote it, or as the text had it. */
const literalOf = (v: number | RustNumber) => (v instanceof RustNumber ? v.literal : JSON.stringify(v));

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const U64_MAX = 2n ** 64n - 1n;
const INTEGER = /^-?\d+$/;

/** Whether serde_json holds the number as an integer (i64, or u64 past it), and which. */
function integerOf(v: number | RustNumber): bigint | null {
  const lit = literalOf(v);
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
  const b = integerOf(v as number | RustNumber);
  return b !== null && b <= I64_MAX ? b : saturate(n);
}

/** `Value::as_i64`: an integer that fits, else none. */
export function asI64(v: unknown): bigint | null {
  const n = number(v);
  if (n === undefined || !Number.isFinite(n)) return null;
  const b = integerOf(v as number | RustNumber);
  return b !== null && b <= I64_MAX ? b : null;
}

/** i64 arithmetic as the Rust core's (wrapping: the WASM was built without overflow checks). */
export const i64 = (x: bigint): bigint => BigInt.asIntN(64, x);

/** JavaScript's `String(v)` of a field that may be missing, as media_plan.rs's `js_string` wrote it. */
export function jsString(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number' || v instanceof RustNumber) {
    const n = number(v)!;
    if (!Number.isFinite(n)) return 'null';
    const b = integerOf(v);
    if (b !== null && b <= I64_MAX) return b.toString();
    // A float: whole ones with every digit and without their ".0", the rest as serde_json writes them (as JavaScript).
    if (Number.isInteger(n) && Math.abs(n) < 1e21) return Object.is(n, -0) ? '-0' : BigInt(n).toString();
    return String(n);
  }
  if (Array.isArray(v)) return v.map((x) => (x === null ? '' : jsString(x))).join(',');
  return '[object Object]';
}

/** `truthy`: as JavaScript tests a value. */
export const truthy = (v: unknown): boolean => v !== undefined && v !== null && v !== false && v !== '' && number(v) !== 0;

/** How deep serde_json reads nested arrays and objects. */
const DEPTH = 128;

/**
 * `serde_json::from_str`: JSON text, or null where serde_json refused it (what JSON.parse refuses, a number past f64,
 * half a UTF-16 pair, nesting 128 deep). A number written otherwise than JavaScript writes it is kept as a RustNumber.
 */
export function serdeParse(text: string): unknown {
  let out: unknown;
  try {
    out = JSON.parse(text, function (this: unknown, _k, v: unknown, context?: { source?: string }) {
      if (typeof v === 'number' && context?.source !== undefined && context.source !== JSON.stringify(v)) return new RustNumber(v, context.source);
      return v;
    } as (k: string, v: unknown) => unknown);
  } catch {
    return null;
  }
  const sound = (v: unknown, depth: number): boolean => {
    if (typeof v === 'number') return Number.isFinite(v);
    if (v instanceof RustNumber) return Number.isFinite(v.value);
    if (typeof v === 'string') return wellFormed(v) === v;
    if (v === null || typeof v !== 'object') return true;
    if (depth >= DEPTH - 1) return false;
    if (Array.isArray(v)) return v.every((x) => sound(x, depth + 1));
    return Object.entries(v).every(([k, x]) => wellFormed(k) === k && sound(x, depth + 1));
  };
  return sound(out, 0) ? out : null;
}

/** A value read with serde_json as plain JSON again, for an answer. */
export const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x: unknown) => (x instanceof RustNumber ? x.value : x)) ?? 'null');

/**
 * `JSON.parse` as ordered.rs reads JSON text another app wrote: null where it throws, half a UTF-16 pair U+FFFD (in a
 * key too: the two then are one key, the later value in the first's place).
 */
export function parseText(text: string): unknown {
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
export function textOf(v: unknown): string {
  if (typeof v === 'number') return jsNumber(v);
  if (Array.isArray(v)) return v.map((x) => (x === null ? '' : textOf(x))).join(',');
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

/** Strings in Rust's order: by code point, as their UTF-8 bytes compare. */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
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
