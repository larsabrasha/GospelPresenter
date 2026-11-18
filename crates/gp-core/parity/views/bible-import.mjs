// A translation's zip against 2.0's TS (packages/core/src/bible-import.ts at 238d481b): `bibleImportView` against
// `importBibleZip`, on zips made here (DBL with metadata and USX_1/ or USX_2/, loose USX, USFM and SFM, eBible's
// copr.htm, front matter, a book twice, none), their books written with what USX and USFM have (chapters, verses and
// ranges, milestones, headings, notes, character styles, tables, entities, CDATA, comments, attributes after a bar,
// stray backslashes, upper-case markers, white space of every kind, decomposed and astral letters), stored or DEFLATE,
// and the same zips damaged; and a real one in GP_REAL_BIBLE_ZIP when it is set. A refusal is compared by its reason;
// the TS's own error from a damaged DEFLATE stream is the core's `compression`. Where the TS keeps a UTF-16 unit that
// pairs with none, the core has U+FFFD.
import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { importBibleZip } from '../.out/ts-core.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

let seed = 53;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const enc = new TextEncoder();

/** A zip of `files` ({name, text or bytes, deflate}), as the TS's own reader and a real zip tool lay one out. */
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = f.bytes ?? enc.encode(f.text);
    const body = f.deflate ? deflateRawSync(data) : data;
    const name = enc.encode(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(f.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc32(data), 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
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

const WORDS = ['I', 'begynnelsen', 'skapade', 'Gud', 'himmel', 'och', 'jord.', 'Herren', 'är', 'min', 'herde', '“Ljus”', 'Æ', 'Ö', 'å'.normalize('NFD'), '𝄞', ';', ','];
const SPACES = [' ', ' ', ' ', '  ', '\t', '\n', ' ', ' ', '﻿', '\u0085', '\r\n'];
const words = (n = 1 + int(8)) => Array.from({ length: n }, () => pick(WORDS)).join(pick(SPACES));
const ENTITY = ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;', '&#229;', '&#xE4;', '&#X41;', '&#0;', '&#xD800;', '&#1114112;', '&foo;', '&AMP;', '&#x;', '&', '&#12a;', '&#128526;'];
const CODES = ['GEN', 'EXO', 'PSA', 'MAT', 'JHN', 'REV', 'TOB', '1MA', 'FRT', 'BAK', 'gen', 'Ps', 'ABCD', 'ß', ''];
const NUMBER = () => pick(['1', '2', '3', '10', '5-6', ' 7', '+3', '-2', 'x', '', '007', '99999999999999999999999']);

/** A USX book with what real ones have. */
function usx(code) {
  const out = [pick(['<?xml version="1.0" encoding="utf-8"?>\n', '', '<!-- made here -->']), `<usx version="${pick(['2.0', '3.0'])}">`];
  if (rand() < 0.9) out.push(`<book code="${code}" style="id">Bok</book>`);
  out.push(`<para style="${pick(['h', 'mt1', 'toc1'])}">${words(2)}</para>`);
  if (rand() < 0.3) out.push(`<para style="p">Före kapitlen ${words(2)}</para>`);
  for (let c = 0; c < 1 + int(3); c++) {
    out.push(`<chapter number="${pick([String(c + 1), String(c + 1), NUMBER()])}" style="c"${rand() < 0.3 ? ' sid="x"/' : ''}>${rand() < 0.3 ? '' : ''}`.replace('>', rand() < 0.7 ? '/>' : '></chapter>'));
    for (let p = 0; p < 1 + int(4); p++) {
      const tag = pick(['para', 'para', 'para', 'table', 'list', 'note']);
      const style = pick(['p', 'q1', 'q2', 'm', 's1', 'mr', 'd', 'li1', 'b']);
      let inner = '';
      for (let v = 0; v < 1 + int(4); v++) {
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
          () => `<char style="w" lemma="a &amp; b" x='"'>${words(1)}</char>`,
          () => `${words(1)}</stray>${words(1)}`,
          () => `<row><cell>${words(1)}</cell></row>`,
        ])();
      }
      out.push(`<${tag} style="${style}">${inner}</${tag}>`);
    }
  }
  if (rand() < 0.9) out.push('</usx>');
  return out.join(pick(['\n', '', ' ']));
}

/** A USFM book with what real ones have. */
function usfm(code) {
  const out = [rand() < 0.9 ? `\\id ${code} ${words(2)}` : '', pick(['\\usfm 3.0', '', '\\ide UTF-8']), `\\h ${words(1)}`, `\\toc1 ${words(2)}`, `\\mt1 ${words(2)}`];
  if (rand() < 0.3) out.push(`\\ip Inledning ${words(3)}`);
  for (let c = 0; c < 1 + int(3); c++) {
    out.push(`\\${pick(['c', 'c', 'C'])} ${pick([String(c + 1), String(c + 1), NUMBER()])}`);
    if (rand() < 0.4) out.push(`\\s1 ${words(3)}`);
    for (let p = 0; p < 1 + int(3); p++) {
      out.push(pick(['\\p', '\\q1', '\\q2', '\\m', '\\b', '\\li1', '\\P', '\\pi1']));
      for (let v = 0; v < 1 + int(4); v++) {
        out.push(`\\v ${pick([String(v + 1), String(v + 1), NUMBER()])} ` + pick([
          () => words(),
          () => `${words(2)} \\f + \\fr 1:1 \\ft ${words(2)}\\f* ${words(1)}`,
          () => `${words(1)} \\x - \\xo 5:3 \\xt Luk 6:20\\x*${words(1)}`,
          () => `\\w ${pick(WORDS)}|strong="H1"\\w* ${words(1)}`,
          () => `\\nd Herren\\nd*${pick(['.', ' ', ''])}`,
          () => `\\+nd ${words(1)}\\+nd* ${words(1)}`,
          () => `\\qt-s |who="Jesus"\\*${words(2)}\\qt-e\\*`,
          () => `${words(1)} \\\\ ${words(1)} \\1 ${words(1)}`,
          () => `\\ND STORA\\ND* ${words(1)}`,
          () => `\\fig bild|src="a.jpg"\\fig*${words(1)}`,
          () => `${words(1)} \\va 2\\va* ${words(1)}`,
        ])());
      }
    }
  }
  return out.join(pick(['\n', '\r\n', ' ', '\n\n']));
}

/** A translation's zip of one of the layouts real ones have. */
function translation() {
  const codes = Array.from({ length: 1 + int(4) }, () => pick(CODES));
  const deflate = () => rand() < 0.6;
  const layout = pick(['dbl1', 'dbl2', 'dblLoose', 'usx', 'usfm', 'sfm', 'copr', 'none']);
  const files = [];
  const dir = pick(['', 'release/', 'Bibel/']);
  if (layout.startsWith('dbl')) {
    const name = pick(['Svenska Folkbibeln', '  ', '', 'Bibel & <x>'.replace('&', '&amp;').replace('<x>', '')]);
    const meta = `<DBLMetadata><identification><name>${name}</name>${rand() < 0.5 ? `<nameLocal>${pick(['', 'Folkbibeln'])}</nameLocal>` : ''}<abbreviation>${pick(['SFB', '', 'x'.repeat(60)])}</abbreviation></identification>${rand() < 0.7 ? `<language><iso>${pick(['swe', ' ', 'sv'.repeat(15)])}</iso></language>` : ''}</DBLMetadata>`;
    files.push({ name: `${dir}${pick(['metadata.xml', 'METADATA.XML'])}`, text: meta, deflate: deflate() });
    const sub = layout === 'dbl1' ? 'USX_1/' : layout === 'dbl2' ? 'USX_2/' : 'loose/';
    codes.forEach((code, i) => files.push({ name: `${dir}${sub}${String(i).padStart(2, '0')}${code}.usx`, text: usx(code), deflate: deflate() }));
  } else if (layout === 'usx' || layout === 'copr') {
    if (layout === 'copr') files.push({ name: 'copr.htm', text: `<html><head><TITLE lang="sv">${pick(['World English Bible', 'svenska folk bibeln', '  Ett  Två\tTre ', '𝐀lpha 𝐁eta'])}</TITLE></head></html>`, deflate: deflate() });
    codes.forEach((code, i) => files.push({ name: `${String(i).padStart(2, '0')}${code}.${pick(['usx', 'USX'])}`, text: usx(code), deflate: deflate() }));
  } else if (layout === 'usfm' || layout === 'sfm') {
    codes.forEach((code, i) => files.push({ name: `${String(i).padStart(2, '0')}-${code}.${layout === 'sfm' ? 'SFM' : 'usfm'}`, text: usfm(code), deflate: deflate() }));
  } else files.push({ name: 'readme.txt', text: 'hej', deflate: false });
  if (rand() < 0.2) files.push({ name: `${dir}tom/`, text: '', deflate: false });
  return zip(files);
}

/** The zip with some bytes changed, cut or added, as a damaged download would be. */
function damaged(bytes) {
  const b = [...bytes];
  for (let k = 0; k < 1 + int(3); k++) {
    const at = int(b.length + 1);
    pick([() => (b[at] = int(256)), () => b.splice(at), () => b.splice(at, 0, int(256)), () => b.splice(at, 1)])();
  }
  return new Uint8Array(b);
}

const lone = (s) => s.replace(/\\ud[89a-f][0-9a-f]{2}/g, '�');
const where = (a, b) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: TS …${JSON.stringify(a.slice(Math.max(0, i - 50), i + 70))} Rust …${JSON.stringify(b.slice(Math.max(0, i - 50), i + 70))}`;
};

export default async function check(db) {
  const differ = [];
  let compared = 0;
  let bibles = 0;
  const one = async (bytes, what) => {
    compared++;
    let want;
    try {
      want = canon(await importBibleZip(bytes));
      bibles++;
    } catch (e) {
      want = canon({ refused: e.constructor?.name === 'BibleImportError' ? e.message : 'compression' });
    }
    const got = canon(await viewRust(db, 'bibleImportView', { data: Buffer.from(bytes).toString('base64') }));
    if (lone(want) !== got) differ.push(`bibleImportView ${what} ${where(lone(want), got)}`);
  };
  for (let i = 0; i < 1500; i++) {
    const bytes = translation();
    await one(bytes, `zip ${i}`);
    if (i % 3 === 0) await one(damaged(bytes), `damaged ${i}`);
  }
  for (const what of ['', 'not a zip', 'PK\u0005\u0006']) await one(enc.encode(what), JSON.stringify(what));
  const real = process.env.GP_REAL_BIBLE_ZIP;
  if (real) await one(new Uint8Array(readFileSync(real)), 'GP_REAL_BIBLE_ZIP');
  return { compared, differ, notes: [`1 500 zips made, 500 damaged, 3 not zips${real ? ', a real one' : ''}, ${bibles} of them a translation`] };
}
