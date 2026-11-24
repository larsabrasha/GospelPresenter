// A text's length as every limit counts it: in characters, code points, as zod 4's `.max` counts them, so a name of
// 200 emoji is 200 characters, not 400 UTF-16 units. The core's views and imports, and the web's fields, count here.

/** Whether a pair starts at `i`: a high surrogate followed by a low one (a lone half is a character of its own). */
const pairAt = (s: string, i: number): boolean => (s.charCodeAt(i) & 0xfc00) === 0xd800 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00;

/** The UTF-16 units of the first `max` characters of `s`, and how many characters those are. */
function unitsOf(s: string, max: number): { units: number; chars: number } {
  let i = 0;
  let chars = 0;
  for (; i < s.length && chars < max; chars++) i += pairAt(s, i) ? 2 : 1;
  return { units: i, chars };
}

/** How many characters (code points) `s` has. */
export const charCount = (s: string): number => unitsOf(s, s.length).chars;

/** Whether `s` has at most `max` characters; no counting when its UTF-16 units are already few enough. */
export const charsAtMost = (s: string, max: number): boolean => s.length <= max || charCount(s) <= max;

/** The first `max` characters of `s`: a surrogate pair is kept whole or left out, never split. */
export const cutChars = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, unitsOf(s, max).units));

/**
 * At most `max` UTF-16 units of `s`, for a limit on what is sent rather than on what is typed (the outputs' wire, whose
 * message size is reckoned in units): a surrogate pair that would be split at the end is left out whole.
 */
export function cutUnits(s: string, max: number): string {
  if (s.length <= max) return s;
  return (s.charCodeAt(max - 1) & 0xfc00) === 0xd800 && (s.charCodeAt(max) & 0xfc00) === 0xdc00 ? s.slice(0, max - 1) : s.slice(0, max);
}
