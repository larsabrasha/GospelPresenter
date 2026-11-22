// A file's bytes as the views of files take them (ADR 0008; ported back from crates/gp-core/src/files.rs): base64 in
// the JSON a shell sends. Text is read with platform.ts's utf8Decode, as files.rs's `utf8` read it.

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUE = new Map([...DIGITS].map((c, i) => [c.charCodeAt(0), i]));

/** Standard base64, with or without its padding (every `=` at the end dropped): its bytes, or null. */
export function base64(text: string): Uint8Array | null {
  let end = text.length;
  while (end > 0 && text[end - 1] === '=') end--;
  if (end % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let o = 0;
  for (let i = 0; i < end; i += 4) {
    const n = Math.min(4, end - i);
    let v = 0;
    for (let k = 0; k < n; k++) {
      const d = VALUE.get(text.charCodeAt(i + k));
      if (d === undefined) return null;
      v |= d << (18 - 6 * k);
    }
    out[o++] = (v >>> 16) & 0xff;
    if (n > 2) out[o++] = (v >>> 8) & 0xff;
    if (n > 3) out[o++] = v & 0xff;
  }
  return out;
}
