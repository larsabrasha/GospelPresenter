// SHA-256 (FIPS 180-4) in plain JavaScript, for where Web Crypto's `subtle`
// is missing: a page that is not a secure context, such as a tablet opening
// the desktop host over http on the LAN (ADR 0007 decision 7). Everywhere
// else `crypto.subtle.digest` is used (platform.ts). A test checks the two
// agree.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The SHA-256 of bytes, in one go. */
export function sha256(data: Uint8Array): Uint8Array {
  const run = digest(data);
  let step = run.next();
  while (!step.done) step = run.next();
  return step.value;
}

/** Waits for the next task: a timer, so queued messages are answered first. (Typed here: the core has no DOM types.) */
const nextTask = () => new Promise<void>((r) => (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 0));

/** How much is hashed between two breaks: 256 KiB, a few milliseconds on a tablet. */
const SLICE_BLOCKS = 4096;

/**
 * The SHA-256 of bytes, giving the thread back every 256 KiB. On a page
 * without Web Crypto the hash runs on the thread that also answers the
 * page's queries (the database worker); a 20 MB audio file hashed in one go
 * would hold them for seconds.
 */
export async function sha256Async(data: Uint8Array, pause: () => Promise<void> = nextTask): Promise<Uint8Array> {
  const run = digest(data);
  let step = run.next();
  while (!step.done) {
    await pause();
    step = run.next();
  }
  return step.value;
}

/** The hash, yielding after every SLICE_BLOCKS blocks so a caller may pause between slices. */
function* digest(data: Uint8Array): Generator<void, Uint8Array> {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  // The message, a 1 bit, zeros, and its length in bits as 64 bits big-endian, to a multiple of 64 bytes.
  const length = data.length;
  const padded = new Uint8Array((((length + 8) >>> 6) + 1) << 6);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000), false);
  view.setUint32(padded.length - 4, (length << 3) >>> 0, false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    if (block > 0 && (block / 64) % SLICE_BLOCKS === 0) yield;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!, false);
  return out;
}
