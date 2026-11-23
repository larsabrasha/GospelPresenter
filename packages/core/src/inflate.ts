// Raw DEFLATE (RFC 1951) inflated at once, as the Rust core's miniz_oxide did (`decompress_to_vec`) and refusing what
// it refused, so a damaged zip is refused alike: a code of lengths that is not complete (the literals' and the
// distances' may hold one code or none), a length code past 285, a distance code past 29 or before the start, a stored
// block whose length's check fails, a block of type 3, or the input ending before the last block. Bytes after the
// last block are left. Synchronous, so a page can read a zip on its own thread.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const LENGTHS_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class Bad extends Error {}

/** A canonical code: its symbols by code, per length. `single` is the one symbol of a code of one. */
interface Code {
  counts: number[];
  symbols: number[];
  single: { symbol: number; length: number } | null;
}

/** The code of `lengths`; a code of lengths must be complete, the others too unless they hold one symbol or none. */
function code(lengths: number[], lengthsCode: boolean): Code {
  const counts = Array<number>(16).fill(0);
  for (const l of lengths) counts[l]!++;
  let total = 0;
  let used = 0;
  for (let l = 1; l < 16; l++) {
    used += counts[l]!;
    total = (total + counts[l]!) << 1;
  }
  if (total !== 65_536 && (used > 1 || lengthsCode)) throw new Bad();
  const offsets = [0];
  for (let l = 1; l < 16; l++) offsets[l] = offsets[l - 1]! + (l > 1 ? counts[l - 1]! : 0);
  const symbols: number[] = [];
  lengths.forEach((l, symbol) => {
    if (l) symbols[offsets[l]!++] = symbol;
  });
  const one = used === 1 ? lengths.findIndex((l) => l > 0) : -1;
  counts[0] = 0;
  return { counts, symbols, single: one >= 0 ? { symbol: one, length: lengths[one]! } : null };
}

/** The bytes of raw DEFLATE data; throws where miniz_oxide refused it. */
export function inflate(input: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(1024, input.length * 4));
  let size = 0;
  let at = 0;
  let bitBuf = 0;
  let bitCount = 0;
  const bits = (n: number): number => {
    while (bitCount < n) {
      if (at >= input.length) throw new Bad();
      bitBuf |= input[at++]! << bitCount;
      bitCount += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return v;
  };
  const put = (b: number) => {
    if (size === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[size++] = b;
  };
  /** A symbol; an invalid code is refused (miniz_oxide's 286). A code of one symbol past 10 bits (miniz_oxide's fast table) reads as its tree does. */
  const decode = (c: Code, invalid: number): number => {
    if (c.single && c.single.length > 10) {
      if (bits(10) !== 0) return invalid;
      for (let l = 11; l <= c.single.length; l++) if (bits(1)) return 0;
      return c.single.symbol;
    }
    let first = 0;
    let index = 0;
    let value = 0;
    for (let l = 1; l < 16; l++) {
      value |= bits(1);
      const count = c.counts[l]!;
      if (value - first < count) return c.symbols[index + value - first]!;
      index += count;
      first = (first + count) << 1;
      value <<= 1;
      if (l === 10 && index === 0 && c.single === null) return invalid;
    }
    return invalid;
  };
  for (;;) {
    const last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (at + 4 > input.length) throw new Bad();
      const len = input[at]! | (input[at + 1]! << 8);
      const check = input[at + 2]! | (input[at + 3]! << 8);
      at += 4;
      if (len !== (~check & 0xffff)) throw new Bad();
      if (at + len > input.length) throw new Bad();
      for (let i = 0; i < len; i++) put(input[at + i]!);
      at += len;
    } else if (type === 3) throw new Bad();
    else {
      let lit: Code;
      let dist: Code;
      if (type === 1) {
        lit = code([...Array<number>(144).fill(8), ...Array<number>(112).fill(9), ...Array<number>(24).fill(7), ...Array<number>(8).fill(8)], false);
        dist = code(Array<number>(32).fill(5), false);
      } else {
        const nLit = bits(5) + 257;
        const nDist = bits(5) + 1;
        const nLen = bits(4) + 4;
        if (nLit > 286 || nDist > 30) throw new Bad();
        const lengthLengths = Array<number>(19).fill(0);
        for (let i = 0; i < nLen; i++) lengthLengths[LENGTHS_ORDER[i]!] = bits(3);
        const lengthCode = code(lengthLengths, true);
        const lengths: number[] = [];
        while (lengths.length < nLit + nDist) {
          const sym = decode(lengthCode, 19);
          if (sym < 16) lengths.push(sym);
          else if (sym === 16) {
            if (!lengths.length) throw new Bad();
            const prev = lengths[lengths.length - 1]!;
            for (let n = 3 + bits(2); n > 0; n--) lengths.push(prev);
          } else if (sym === 17) for (let n = 3 + bits(3); n > 0; n--) lengths.push(0);
          else if (sym === 18) for (let n = 11 + bits(7); n > 0; n--) lengths.push(0);
          else throw new Bad();
        }
        if (lengths.length !== nLit + nDist) throw new Bad();
        lit = code(lengths.slice(0, nLit), false);
        dist = code(lengths.slice(nLit), false);
      }
      for (;;) {
        const sym = decode(lit, 286);
        if (sym < 256) put(sym);
        else if (sym === 256) break;
        else {
          if (sym > 285) throw new Bad();
          const length = LENGTH_BASE[sym - 257]! + bits(LENGTH_EXTRA[sym - 257]!);
          const d = decode(dist, 30);
          if (d > 29) throw new Bad();
          const distance = DIST_BASE[d]! + bits(DIST_EXTRA[d]!);
          if (distance > size) throw new Bad();
          for (let i = 0; i < length; i++) put(out[size - distance]!);
        }
      }
    }
    if (last) return out.slice(0, size);
  }
}
