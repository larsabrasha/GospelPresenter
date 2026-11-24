// The bundled theme fonts (src/fonts.css): every character a Swedish Bible or
// song text needs has a glyph, and OFL.txt carries each font's own copyright
// notice. Reads the WOFF2 files themselves (only the cmap and name tables,
// which WOFF2 never transforms), with Node's own Brotli.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const fontsDir = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));

// The 63 known table tags of WOFF2, in the order of their flag index.
const KNOWN_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx ' +
  'BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty ' +
  'just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
).match(/.{4}\s?/g)!.map((t) => t.slice(0, 4));

/** The untransformed tables of a WOFF2 file, by tag. */
function woff2Tables(file: Buffer): Map<string, Buffer> {
  expect(file.toString('latin1', 0, 4)).toBe('wOF2');
  const numTables = file.readUInt16BE(12);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = file[p++]!;
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const entries: { tag: string; length: number; transformed: boolean }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[p++]!;
    const tag = (flags & 0x3f) === 0x3f ? file.toString('latin1', p, (p += 4)) : KNOWN_TAGS[flags & 0x3f]!;
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    entries.push({ tag, length: transformed ? base128() : origLength, transformed });
  }
  const totalCompressed = file.readUInt32BE(20);
  const data = brotliDecompressSync(file.subarray(p, p + totalCompressed));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const e of entries) {
    if (!e.transformed) tables.set(e.tag, data.subarray(offset, offset + e.length));
    offset += e.length;
  }
  return tables;
}

/** Every code point the font maps to a glyph (cmap formats 4 and 12, Windows platform). */
function codePoints(cmap: Buffer): Set<number> {
  const out = new Set<number>();
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    if (platform !== 3 || (encoding !== 1 && encoding !== 10)) continue;
    const t = cmap.subarray(cmap.readUInt32BE(8 + i * 8));
    const format = t.readUInt16BE(0);
    if (format === 4) {
      const segs = t.readUInt16BE(6) / 2;
      const ends = 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const ranges = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = t.readUInt16BE(ends + s * 2);
        const start = t.readUInt16BE(starts + s * 2);
        const delta = t.readUInt16BE(deltas + s * 2);
        const range = t.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = range === 0 ? (c + delta) & 0xffff : t.readUInt16BE(ranges + s * 2 + range + (c - start) * 2);
          if (glyph !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = t.readUInt32BE(12);
      for (let g = 0; g < groups; g++) {
        const start = t.readUInt32BE(16 + g * 12);
        const end = t.readUInt32BE(20 + g * 12);
        for (let c = start; c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

/** A name table string (Windows platform, UTF-16BE). */
function nameOf(name: Buffer, id: number): string | null {
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (name.readUInt16BE(r) !== 3 || name.readUInt16BE(r + 6) !== id) continue;
    const bytes = Buffer.from(name.subarray(strings + name.readUInt16BE(r + 10), strings + name.readUInt16BE(r + 10) + name.readUInt16BE(r + 8)));
    return bytes.swap16().toString('utf16le');
  }
  return null;
}

const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
/** The non-ASCII characters of Bibel 2000, as imported. */
const SWEDISH_BIBLE = '«»ÄÅÖäåéö—’…';
/** Common in Swedish, Nordic and other European song texts. */
const SONGS = 'ÆØæøÜüÉé–“”‘’•';
/** The no-break space between a verse number and its text (bible.ts). */
const APP = ' ';

const fonts = readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));

describe('bundled theme fonts', () => {
  it('are the three of fonts.css', () => {
    expect(fonts.toSorted()).toEqual(['Inter-variable.woff2', 'Lato-400.woff2', 'Montserrat-variable.woff2']);
  });

  it.each(fonts)('%s has a glyph for every character of a Swedish Bible and of common song texts', (font) => {
    const covered = codePoints(woff2Tables(readFileSync(join(fontsDir, font))).get('cmap')!);
    const missing = [...ASCII + SWEDISH_BIBLE + SONGS + APP].filter((c) => !covered.has(c.codePointAt(0)!));
    expect(missing).toEqual([]);
  });

  it.each(fonts)('%s: its own copyright notice is in OFL.txt', (font) => {
    const name = woff2Tables(readFileSync(join(fontsDir, font))).get('name')!;
    const copyright = nameOf(name, 0);
    expect(copyright).toMatch(/^Copyright /);
    expect(readFileSync(join(fontsDir, 'OFL.txt'), 'utf8')).toContain(copyright);
  });
});
