// Files made for the `files` group's checks, as the old checks of the way there made them (views/propresenter.mjs,
// views/bible-import.mjs, whose generators are taken here over a seeded `random`): ProPresenter files as ProPresenter
// writes them, translations' zips of every layout, and both damaged; and DEFLATE streams made by hand, sound and not.
import { crc32, constants, deflateRawSync } from 'node:zlib';

export function makers(random) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const int = (n) => Math.floor(random() * n);
  const enc = new TextEncoder();
  const utf8 = (s) => enc.encode(s);

  // ------------------------------------------------------------------ ProPresenter

  function varint(n) {
    const out = [];
    let v = BigInt(n);
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v) b |= 0x80;
      out.push(b);
    } while (v);
    return out;
  }
  function message(fields) {
    const out = [];
    for (const [no, v] of fields) {
      if (typeof v === 'number' || typeof v === 'bigint') out.push(...varint((no << 3) | 0), ...varint(v));
      else {
        const bytes = typeof v === 'string' ? utf8(v) : v instanceof Uint8Array ? v : message(v);
        out.push(...varint((no << 3) | 2), ...varint(bytes.length), ...bytes);
      }
    }
    return new Uint8Array(out);
  }
  const uuid = (id) => [[1, id]];
  const WORDS = ['Härlig', 'är', 'jorden', 'Guds', 'nåd', 'Äran', 'och', 'makten', 'Jesus', '𝄞', 'Café', 'crème', 'Grün', 'O', 'store', 'Gud', ''];
  const line = () => Array.from({ length: 1 + int(6) }, () => pick(WORDS)).join(pick([' ', '  ', ' ', '\t']));
  const rtfLine = () =>
    Array.from({ length: 1 + int(5) }, () =>
      pick([
        () => line(),
        () => `\\'${pick(['e5', 'E4', 'f6', '96', '93', '94', '80', '9f', 'a0', 'ff', '41', 'zz', '7'])}`,
        () => `\\u${pick(['252', '8232', '8233', '-3', '-0', '65', '55357', '56478', '73768', '999999999999999999999', ''])}${pick(['', ' ', '?', '??'])}`,
        () => `\\uc${pick(['0', '1', '2', '', '99'])} `,
        () => pick(['\\b ', '\\i0 ', '\\fs48 ', '\\cf1', '\\par ', '\\pard', '\\\\', '\\{', '{', '}', '\\-', '\\ul-12x']),
        () => line().normalize('NFD'),
        () => pick([' ', ' ', '﻿', '\u0085', '\r', '   ']),
      ])(),
    ).join('');
  const rtf = (lines) =>
    [
      pick(['{\\rtf1\\ansi\\ansicpg1252\\cocoartf2511', '{\\rtf1', '{\\rtf']),
      '\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}',
      pick(['{\\colortbl;\\red255\\green255\\blue255;}', '{\\colortbl;\\red255\\green255\\blue255;', '']),
      pick(['{\\*\\expandedcolortbl;;}', '{\\info{\\title x}}', '{\\stylesheet{\\s0 Normal;}}', '']),
      pick(['\\pard\\pardirnatural\\qc\\partightenfactor0', '', '\\pard']),
      '',
      pick(['\\f0\\fs48 \\cf1 ', '']) + lines.join(pick(['\\\n', '\\\r\n', '\n', '\\\n\\\n\\\n'])),
      '}',
    ].join('\n');
  function cue(id, text) {
    const element = text === null ? [] : [[1, [[13, [[5, text === '' ? new Uint8Array() : utf8(text)]]]]]];
    return [[1, uuid(id)], [10, [[23, [[2, [[1, [[1, element]]]]]]]]]];
  }
  const TITLES = [undefined, '', 'Untitled', 'untitled 2', 'Untitled-12', 'UNTITLED_3', 'Untitled 1 2', 'Härlig är jorden', 'Äran och makten'.normalize('NFD'), '  Hos Dig  ', 'x'.repeat(250), '𝄞'.repeat(150)];

  /** A file as ProPresenter writes one, with what varies in real files. */
  function proFile() {
    const fields = [];
    const title = pick(TITLES);
    if (title !== undefined) fields.push([3, title]);
    const groups = Array.from({ length: int(5) }, (_, g) => ({ id: pick([`g${g}`, `g${g}`, '', `g${int(3)}`]), name: pick(['Verse 1', 'Chorus', '', '  Bridge ', 'x'.repeat(60), 'Vers'.normalize('NFD'), '𝄞'.repeat(30)]), slides: int(14) }));
    for (let a = 0; a < int(4); a++) fields.push([11, [[1, uuid(`a${a}`)], [2, pick(['Kort', '', 'Lång'.repeat(30), '𝄞'.repeat(60)])], ...Array.from({ length: int(6) }, () => [3, uuid(pick(groups)?.id ?? 'none')])]]);
    let n = 0;
    const cues = [];
    for (const g of groups) {
      const ids = Array.from({ length: g.slides }, () => {
        const id = pick([`c${n++}`, `c${n++}`, '', `c${int(n + 1)}`]);
        const text = pick([null, '', 'plain', 'rtf', 'rtf', 'long']);
        const made = text === 'rtf' ? rtf(Array.from({ length: 1 + int(4) }, rtfLine)) : text === 'plain' ? line() : text === 'long' ? rtf(['𝄞'.repeat(2499) + 'ab' + '𝄞'.repeat(10)]) : text;
        cues.push([13, cue(id, made)]);
        return id;
      });
      fields.push([12, [[1, [[1, uuid(g.id)], [2, g.name]]], ...ids.map((id) => [2, uuid(id)])]]);
    }
    fields.push(...cues);
    if (random() < 0.6) {
      const block = [];
      if (random() < 0.7) block.push([1, pick(['R. Gunnargard', 'Björn'.normalize('NFD'), '', 'y'.repeat(220)])]);
      if (random() < 0.5) block.push([3, pick(['Pappa', 'Untitled', ''])]);
      if (random() < 0.5) block.push([4, pick(['Förlaget', ' '])]);
      if (random() < 0.8) block.push([6, pick([0, 1234567, 2 ** 53 + 1, 10n ** 21n, 2n ** 69n, 7])]);
      fields.push([14, block]);
    }
    return message(fields);
  }

  /** The bytes with some changed, cut or added, as a damaged file would be. */
  function damaged(bytes) {
    const b = [...bytes];
    for (let k = 0; k < 1 + int(3); k++) {
      const at = int(b.length + 1);
      pick([() => (b[at] = int(256)), () => b.splice(at), () => b.splice(at, 0, int(256), int(256)), () => b.splice(at, 1)])();
    }
    return new Uint8Array(b);
  }
  const noise = (n) => new Uint8Array(Array.from({ length: int(n) }, () => int(256)));

  // ------------------------------------------------------------------ zips

  /** A zip of `files` ({name, text or bytes, deflate or raw (the stream as given)}). */
  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const data = f.bytes ?? enc.encode(f.text);
      const body = f.raw ?? (f.deflate ? deflateRawSync(data, f.options) : data);
      const method = f.method ?? (f.deflate || f.raw ? 8 : 0);
      const name = enc.encode(f.name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(crc32(data), 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      const dir = Buffer.alloc(46);
      dir.writeUInt32LE(0x02014b50, 0);
      dir.writeUInt16LE(method, 10);
      dir.writeUInt32LE(crc32(data), 16);
      dir.writeUInt32LE(body.length, 20);
      dir.writeUInt32LE(f.size ?? Math.max(data.length, 1), 24);
      dir.writeUInt16LE(name.length, 28);
      dir.writeUInt32LE(offset, 42);
      parts.push(local, name, body);
      central.push(dir, name);
      offset += 30 + name.length + body.length;
    }
    const size = central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...parts, ...central, end]));
  }

  const BWORDS = ['I', 'begynnelsen', 'skapade', 'Gud', 'himmel', 'och', 'jord.', 'Herren', 'är', 'min', 'herde', '“Ljus”', 'Æ', 'Ö', 'å'.normalize('NFD'), '𝄞', ';', ','];
  const SPACES = [' ', ' ', ' ', '  ', '\t', '\n', ' ', ' ', '﻿', '\u0085', '\r\n'];
  const words = (n = 1 + int(8)) => Array.from({ length: n }, () => pick(BWORDS)).join(pick(SPACES));
  const ENTITY = ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;', '&#229;', '&#xE4;', '&#X41;', '&#0;', '&#xD800;', '&#1114112;', '&foo;', '&AMP;', '&#x;', '&', '&#12a;', '&#128526;', '&#x0000000000000000000000000000000041;', '&#99999999999999999999999999999999999999999;'];
  const CODES = ['GEN', 'EXO', 'PSA', 'MAT', 'JHN', 'REV', 'TOB', '1MA', 'FRT', 'BAK', 'gen', 'Ps', 'ABCD', 'ß', '', 'XYZ', '9AB', 'ZZ1'];
  const NUMBER = () => pick(['1', '2', '3', '10', '5-6', ' 7', '+3', '-2', 'x', '', '007', '99999999999999999999999', '1'.repeat(400)]);

  function usx(code, many) {
    const out = [pick(['<?xml version="1.0" encoding="utf-8"?>\n', '', '<!-- made here -->']), `<usx version="${pick(['2.0', '3.0'])}">`];
    if (random() < 0.9) out.push(`<book code="${code}" style="id">Bok</book>`);
    out.push(`<para style="${pick(['h', 'mt1', 'toc1'])}">${words(2)}</para>`);
    if (random() < 0.3) out.push(`<para style="p">Före kapitlen ${words(2)}</para>`);
    for (let c = 0; c < 1 + int(many ? 6 : 3); c++) {
      out.push(`<chapter number="${pick([String(c + 1), String(c + 1), NUMBER()])}" style="c"${random() < 0.3 ? ' sid="x"/' : ''}>`.replace('>', random() < 0.7 ? '/>' : '></chapter>'));
      for (let p = 0; p < 1 + int(4); p++) {
        const tag = pick(['para', 'para', 'para', 'table', 'list', 'note']);
        const style = pick(['p', 'q1', 'q2', 'm', 's1', 'mr', 'd', 'li1', 'b']);
        let inner = '';
        for (let v = 0; v < 1 + int(many ? 8 : 4); v++) {
          inner += pick([
            () => `<verse number="${pick([String(v + 1), String(v + 1), NUMBER()])}" style="v"/>`,
            () => `<verse number=${pick(['"1"', "'2'", '"3" ', '"4"/'])}/>`,
            () => `<verse eid="${code} 1:${v}"/>`,
          ])();
          inner += pick([
            () => words(),
            () => `${words(2)}<char style="${pick(['wj', 'nd', 'add'])}">${words(2)}</char>${pick(['.', ' ', ''])}`,
            () => `${words(2)}<note caller="+" style="f"><char style="ft">Fotnot ${words(2)}</char></note>`,
            () => `${words(1)} ${pick(ENTITY)} ${words(1)}`,
            () => `<![CDATA[${words(2)} <rå> & ]]>`,
            () => `${words(1)}<!-- kommentar -->${words(1)}`,
            () => `<figure style="fig">bild</figure>${words(1)}`,
            () => `<char style="w" lemma="a &amp; b" x='"' y = "1" z=bad w>${words(1)}</char>`,
            () => `${words(1)}</stray>${words(1)}`,
            () => `<row><cell>${words(1)}</cell></row>`,
          ])();
        }
        out.push(`<${tag} style="${style}">${inner}</${tag}>`);
      }
    }
    if (random() < 0.9) out.push('</usx>');
    return out.join(pick(['\n', '', ' ']));
  }

  function usfm(code, many) {
    const out = [random() < 0.9 ? `\\id ${code} ${words(2)}` : '', pick(['\\usfm 3.0', '', '\\ide UTF-8']), `\\h ${words(1)}`, `\\toc1 ${words(2)}`, `\\mt1 ${words(2)}`];
    if (random() < 0.3) out.push(`\\ip Inledning ${words(3)}`);
    for (let c = 0; c < 1 + int(many ? 6 : 3); c++) {
      out.push(`\\${pick(['c', 'c', 'C'])} ${pick([String(c + 1), String(c + 1), NUMBER()])}`);
      if (random() < 0.4) out.push(`\\s1 ${words(3)}`);
      for (let p = 0; p < 1 + int(3); p++) {
        out.push(pick(['\\p', '\\q1', '\\q2', '\\m', '\\b', '\\li1', '\\P', '\\pi1', '\\i', '\\io2', '\\+', '\\']));
        for (let v = 0; v < 1 + int(many ? 8 : 4); v++) {
          out.push(
            `\\v ${pick([String(v + 1), String(v + 1), NUMBER()])} ` +
              pick([
                () => words(),
                () => `${words(2)} \\f + \\fr 1:1 \\ft ${words(2)}\\f* ${words(1)}`,
                () => `${words(1)} \\x - \\xo 5:3 \\xt Luk 6:20\\x*${words(1)}`,
                () => `\\w ${pick(BWORDS)}|strong="H1"\\w* ${words(1)}`,
                () => `\\nd Herren\\nd*${pick(['.', ' ', ''])}`,
                () => `\\+nd ${words(1)}\\+nd* ${words(1)}`,
                () => `\\qt-s |who="Jesus"\\*${words(2)}\\qt-e\\*`,
                () => `${words(1)} \\\\ ${words(1)} \\1 ${words(1)}`,
                () => `\\ND STORA\\ND* ${words(1)}`,
                () => `\\fig bild|src="a.jpg"\\fig*${words(1)}`,
                () => `${words(1)} \\va 2\\va* ${words(1)}`,
                () => `${words(1)} a|b \\fqa x|y\\fqa* \\c`,
              ])(),
          );
        }
      }
    }
    return out.join(pick(['\n', '\r\n', ' ', '\n\n']));
  }

  /** A translation's zip of one of the layouts real ones have; `many` verses at times, past the sort's small runs. */
  function translation() {
    const codes = Array.from({ length: 1 + int(4) }, () => pick(CODES));
    const many = random() < 0.3;
    const deflate = () => random() < 0.6;
    const options = () => pick([undefined, { level: 0 }, { level: 1 }, { strategy: constants.Z_FIXED }, { strategy: constants.Z_HUFFMAN_ONLY }, { level: 9, memLevel: 1 }]);
    const layout = pick(['dbl1', 'dbl2', 'dblLoose', 'usx', 'usfm', 'sfm', 'copr', 'none']);
    const files = [];
    const dir = pick(['', 'release/', 'Bibel/', 'Ä/']);
    if (layout.startsWith('dbl')) {
      const name = pick(['Svenska Folkbibeln', '  ', '', 'Bibel &amp; x', '𝄞'.repeat(150)]);
      const meta = `<DBLMetadata><identification><name>${name}</name>${random() < 0.5 ? `<nameLocal>${pick(['', 'Folkbibeln'])}</nameLocal>` : ''}<abbreviation>${pick(['SFB', '', 'x'.repeat(60), '𝄞'.repeat(30)])}</abbreviation></identification>${random() < 0.7 ? `<language><iso>${pick(['swe', ' ', 'sv'.repeat(15)])}</iso></language>` : ''}</DBLMetadata>`;
      files.push({ name: `${dir}${pick(['metadata.xml', 'METADATA.XML'])}`, text: meta, deflate: deflate(), options: options() });
      const sub = layout === 'dbl1' ? 'USX_1/' : layout === 'dbl2' ? 'USX_2/' : 'loose/';
      codes.forEach((code, i) => files.push({ name: `${dir}${sub}${pick([String(i).padStart(2, '0'), 'a', 'B', 'é', '_'])}${code}.usx`, text: usx(code, many), deflate: deflate(), options: options() }));
    } else if (layout === 'usx' || layout === 'copr') {
      if (layout === 'copr')
        files.push({ name: 'copr.htm', text: `<html><head><TITLE lang="sv">${pick(['World English Bible', 'svenska folk bibeln', '  Ett  Två\tTre ', '𝐀lpha 𝐁eta', 'Ⅻ Ⓐb Cd', ''])}</TITLE></head></html>`, deflate: deflate() });
      codes.forEach((code, i) => files.push({ name: `${String(i).padStart(2, '0')}${code}.${pick(['usx', 'USX'])}`, text: usx(code, many), deflate: deflate(), options: options() }));
    } else if (layout === 'usfm' || layout === 'sfm') {
      codes.forEach((code, i) => files.push({ name: `${String(i).padStart(2, '0')}-${code}.${layout === 'sfm' ? 'SFM' : 'usfm'}`, text: usfm(code, many), deflate: deflate(), options: options() }));
    } else files.push({ name: 'readme.txt', text: 'hej', deflate: false });
    if (random() < 0.2) files.push({ name: `${dir}tom/`, text: '', deflate: false });
    if (random() < 0.1) files.push({ name: 'x.usfm', text: '\\id GEN\n\\c 1\n\\v 1 a', method: pick([1, 9, 12]) });
    return zip(files);
  }

  // ------------------------------------------------------------------ DEFLATE by hand

  /** Bits written least significant first, as DEFLATE packs them. */
  function bitWriter() {
    const out = [];
    let acc = 0;
    let n = 0;
    return {
      put(v, bits) {
        for (let i = 0; i < bits; i++) {
          acc |= ((v >> i) & 1) << n;
          if (++n === 8) {
            out.push(acc);
            acc = 0;
            n = 0;
          }
        }
      },
      /** A Huffman code, its bits most significant first. */
      code(v, bits) {
        for (let i = bits - 1; i >= 0; i--) this.put((v >> i) & 1, 1);
      },
      bytes: () => new Uint8Array(n ? [...out, acc] : out),
    };
  }

  /** A stream of one dynamic block whose code lengths are as given (literal/length then distance), with symbols to write. */
  function dynamic(litLengths, distLengths, write) {
    const w = bitWriter();
    w.put(1, 1);
    w.put(2, 2);
    w.put(litLengths.length - 257, 5);
    w.put(distLengths.length - 1, 5);
    w.put(19 - 4, 4);
    // The code lengths written with a complete code of their own: 13 symbols of 4 bits, 6 of 5.
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const lens = Array(19).fill(4);
    for (const s of [13, 14, 15, 16, 17, 18]) lens[s] = 5;
    for (const s of order) w.put(lens[s], 3);
    const codes = canonical(lens);
    for (const l of [...litLengths, ...distLengths]) w.code(codes[l], lens[l]);
    const lit = canonical(litLengths);
    const dist = canonical(distLengths);
    write({ lit: (s) => w.code(lit[s], litLengths[s]), dist: (s) => w.code(dist[s], distLengths[s]), bits: (v, n) => w.put(v, n) });
    return w.bytes();
  }
  function canonical(lengths) {
    const count = Array(16).fill(0);
    for (const l of lengths) if (l) count[l]++;
    const next = Array(16).fill(0);
    for (let b = 1, code = 0; b < 16; b++) next[b] = code = (code + count[b - 1]) << 1;
    return lengths.map((l) => (l ? next[l]++ : 0));
  }

  /** DEFLATE streams sound and damaged in the ways a decoder may differ on. */
  function streams() {
    const text = utf8('Herren är min herde, mig skall intet fattas. '.repeat(3));
    const lit257 = (extra) => [...Array(256).fill(0), 1, ...extra];
    return [
      ['empty fixed', new Uint8Array([0x03, 0x00])],
      ['empty stored', new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff])],
      ['stored bad length', new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00, 0x41])],
      ['stored short', new Uint8Array([0x01, 0x05, 0x00, 0xfa, 0xff, 0x41])],
      ['type 3', new Uint8Array([0x07, 0x00])],
      ['nothing', new Uint8Array([])],
      ['not last', deflateRawSync(text).subarray(0, 3)],
      ['trailing bytes', new Uint8Array([...deflateRawSync(text), 1, 2, 3])],
      ['fixed', deflateRawSync(text, { strategy: constants.Z_FIXED })],
      ['huffman only', deflateRawSync(text, { strategy: constants.Z_HUFFMAN_ONLY })],
      ['stored', deflateRawSync(text, { level: 0 })],
      // One literal/length code (end of block alone): allowed, as is no distance code.
      ['only end', dynamic(lit257([]), [0], (c) => c.lit(256))],
      ['only end, one distance', dynamic(lit257([]), [1], (c) => c.lit(256))],
      // Two codes of length 1 for 'A' and the end; then a length symbol with no distance code.
      ['A and end', dynamic([...Array(65).fill(0), 1, ...Array(190).fill(0), 1], [0], (c) => (c.lit(65), c.lit(65), c.lit(256)))],
      ['match without distances', dynamic([...Array(65).fill(0), 2, ...Array(190).fill(0), 2, 1], [0], (c) => (c.lit(65), c.lit(257), c.bits(1, 1)))],
      ['distance too far', dynamic([...Array(65).fill(0), 2, ...Array(190).fill(0), 2, 1], [1, 1], (c) => (c.lit(65), c.lit(257), c.dist(1), c.lit(256)))],
      ['distance in reach', dynamic([...Array(65).fill(0), 2, ...Array(190).fill(0), 2, 1], [1, 1], (c) => (c.lit(65), c.lit(257), c.dist(0), c.lit(256)))],
      ['incomplete literals', dynamic([...Array(65).fill(0), 2, ...Array(190).fill(0), 2], [1], (c) => (c.lit(65), c.lit(256)))],
      ['over-subscribed', dynamic([...Array(65).fill(0), 1, 1, ...Array(189).fill(0), 1], [1], (c) => c.lit(256))],
      ['one literal code of 12 bits', dynamic([...Array(256).fill(0), 12], [0], (c) => c.lit(256))],
      ['one code of 12 bits, then other bits', dynamic([...Array(256).fill(0), 12], [0], (c) => (c.bits(0, 9), c.bits(1, 1), c.lit(256)))],
      ['one code of 12 bits, a 1 late', dynamic([...Array(256).fill(0), 12], [0], (c) => (c.bits(0, 11), c.bits(1, 1), c.lit(256)))],
      ['one code of 3 bits, other bits', dynamic([...Array(256).fill(0), 3], [0], (c) => (c.bits(2, 3), c.lit(256)))],
      ['one distance of 11 bits', dynamic([...Array(65).fill(0), 2, ...Array(190).fill(0), 2, 1], [...Array(29).fill(0), 11], (c) => (c.lit(65), c.lit(257), c.bits(0, 9), c.bits(4, 3), c.lit(256)))],
      ['too many literal lengths', (() => { const b = dynamic(lit257([]), [0], (c) => c.lit(256)); b[0] |= 0xf8; return b; })()],
    ];
  }

  return { proFile, damaged, noise, translation, zip, streams, pick, int };
}
