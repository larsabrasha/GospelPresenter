// The app's own JSON as it is kept (a row's column, a queued change's arguments, a Bible text the server keeps), read
// strictly and alike by every reader, as serde_json read it in the Rust core (ADR 0008). Files of 1.x and 2.0 are read
// by views/files-json.ts's `parseLegacyJson`, which mends half a surrogate pair instead.

/** How deep a value may nest: 128 levels or more do not read. */
const DEPTH = 128;

/** Whether `v`, an array or object `depth` deep, or one in it, is nested too deep. */
const tooDeep = (v: unknown, depth: number): boolean => !!v && typeof v === 'object' && (depth >= DEPTH || Object.values(v).some((x) => tooDeep(x, depth + 1)));

/**
 * Kept JSON text's value, or undefined where it does not read: a parse error, a number past a double's range, half a
 * surrogate pair in a key or a text, or nesting 128 levels deep.
 */
export function readStoredJson(text: string): unknown {
  let bad = false;
  let value: unknown;
  try {
    value = JSON.parse(text, (key, v: unknown) => {
      if (/\p{Surrogate}/u.test(key) || (typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && /\p{Surrogate}/u.test(v))) bad = true;
      return v;
    });
  } catch {
    return undefined;
  }
  return bad || tooDeep(value, 1) ? undefined : value;
}
