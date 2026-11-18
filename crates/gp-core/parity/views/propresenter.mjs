// ProPresenter files against 2.0's TS (packages/core/src/propresenter.ts at 238d481b): `proPresenterSongView` against
// `parseProPresenter`, on files made here as ProPresenter writes them (titles real and placeholder, the CCLI block,
// groups and arrangements, slides' RTF with Windows-1252 and \u escapes, header groups, line breaks, decomposed and
// astral letters, lengths past every limit), the same files with bytes changed, cut or added (unreadable ones too),
// and the real files in GP_REAL_PRO_DIR when it is set. Where the TS keeps a UTF-16 unit that pairs with none, the core
// has U+FFFD (JSON from the core cannot carry it): the TS answer is compared with those units replaced.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProPresenter } from '../.out/ts-core.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

let seed = 41;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);
const utf8 = (s) => new TextEncoder().encode(s);

// A small protobuf writer: a field is [number, value], a string or bytes, a number (varint) or a nested message.
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
const word = () => pick(WORDS);
const line = () => Array.from({ length: 1 + int(6) }, word).join(pick([' ', '  ', ' ', '\t']));

/** A line of a slide as RTF writes it: letters as they are, or escaped. */
function rtfLine() {
  return Array.from({ length: 1 + int(5) }, () =>
    pick([
      () => line(),
      () => `\\'${pick(['e5', 'E4', 'f6', '96', '93', '94', '80', '9f', 'a0', 'ff', '41', 'zz', '7'])}`,
      () => `\\u${pick(['252', '8232', '8233', '-3', '-0', '65', '55357', '56478', '73768', '999999999999999999999', ''])}${pick(['', ' ', '?', '??'])}`,
      () => `\\uc${pick(['0', '1', '2', '', '99'])} `,
      () => pick(['\\b ', '\\i0 ', '\\fs48 ', '\\cf1', '\\par ', '\\pard', '\\\\', '\\{', '{', '}', '\\-', '\\ul-12x']),
      () => line().normalize('NFD'),
      () => pick([' ', ' ', '﻿', '\u0085', '\r', '   ']),
    ])(),
  ).join('');
}

/** Cocoa's RTF around a slide's lines, as ProPresenter writes them, at times with more or less around it. */
function rtf(lines) {
  return [
    pick(['{\\rtf1\\ansi\\ansicpg1252\\cocoartf2511', '{\\rtf1', '{\\rtf']),
    '\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}',
    pick(['{\\colortbl;\\red255\\green255\\blue255;}', '{\\colortbl;\\red255\\green255\\blue255;', '']),
    pick(['{\\*\\expandedcolortbl;;}', '{\\info{\\title x}}', '{\\stylesheet{\\s0 Normal;}}', '']),
    pick(['\\pard\\pardirnatural\\qc\\partightenfactor0', '', '\\pard']),
    '',
    pick(['\\f0\\fs48 \\cf1 ', '']) + lines.join(pick(['\\\n', '\\\r\n', '\n', '\\\n\\\n\\\n'])),
    '}',
  ].join('\n');
}

function cue(id, text) {
  const element = text === null ? [] : [[1, [[13, [[5, text === '' ? new Uint8Array() : utf8(text)]]]]]];
  return [[1, uuid(id)], [10, [[23, [[2, [[1, [[1, element]]]]]]]]]];
}

const TITLES = [undefined, '', 'Untitled', 'untitled 2', 'Untitled-12', 'UNTITLED_3', 'Untitled 1 2', 'Härlig är jorden', 'Äran och makten'.normalize('NFD'), '  Hos Dig  ', 'x'.repeat(250), '𝄞'.repeat(150)];

/** A file as ProPresenter writes one, with what varies in real files. */
function file() {
  const fields = [];
  const title = pick(TITLES);
  if (title !== undefined) fields.push([3, title]);
  const groups = Array.from({ length: int(5) }, (_, g) => ({ id: pick([`g${g}`, `g${g}`, '', `g${int(3)}`]), name: pick(['Verse 1', 'Chorus', '', '  Bridge ', 'x'.repeat(60), 'Vers'.normalize('NFD')]), slides: int(14) }));
  for (let a = 0; a < int(4); a++) fields.push([11, [[1, uuid(`a${a}`)], [2, pick(['Kort', '', 'Lång'.repeat(30)])], ...Array.from({ length: int(6) }, () => [3, uuid(pick(groups)?.id ?? 'none')])]]);
  let n = 0;
  const cues = [];
  for (const g of groups) {
    const ids = Array.from({ length: g.slides }, () => {
      const id = pick([`c${n++}`, `c${n++}`, '', `c${int(n + 1)}`]);
      const text = pick([null, '', 'plain', () => rtf(Array.from({ length: 1 + int(4) }, rtfLine)), () => rtf(Array.from({ length: 1 + int(4) }, rtfLine))]);
      cues.push([13, cue(id, typeof text === 'function' ? text() : text === 'plain' ? line() : text)]);
      return id;
    });
    fields.push([12, [[1, [[1, uuid(g.id)], [2, g.name]]], ...ids.map((id) => [2, uuid(id)])]]);
  }
  fields.push(...cues);
  if (rand() < 0.6) {
    const block = [];
    if (rand() < 0.7) block.push([1, pick(['R. Gunnargard', 'Björn'.normalize('NFD'), '', 'y'.repeat(220)])]);
    if (rand() < 0.5) block.push([3, pick(['Pappa', 'Untitled', ''])]);
    if (rand() < 0.5) block.push([4, pick(['Förlaget', ' '])]);
    if (rand() < 0.8) block.push([6, pick([0, 1234567, 2 ** 53 + 1, 10n ** 21n, 2n ** 69n, 7])]);
    fields.push([14, block]);
  }
  return message(fields);
}

/** The file with some bytes changed, cut or added, as a damaged file would be. */
function damaged(bytes) {
  const b = [...bytes];
  for (let k = 0; k < 1 + int(3); k++) {
    const at = int(b.length + 1);
    pick([() => (b[at] = int(256)), () => b.splice(at), () => b.splice(at, 0, int(256), int(256)), () => b.splice(at, 1)])();
  }
  return new Uint8Array(b);
}

// JSON.stringify writes a unit that pairs with none as an escape, and a pair as its character.
const lone = (s) => s.replace(/\\ud[89a-f][0-9a-f]{2}/g, '�');
/** Where two answers part, with a little before it. */
const where = (a, b) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: TS …${JSON.stringify(a.slice(Math.max(0, i - 40), i + 60))} Rust …${JSON.stringify(b.slice(Math.max(0, i - 40), i + 60))}`;
};
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

export default async function check(db) {
  const differ = [];
  let compared = 0;
  let songs = 0;
  const one = async (bytes, fileName, what) => {
    compared++;
    const song = parseProPresenter(bytes, fileName);
    if (song) songs++;
    const want = canon(song);
    const got = canon(await viewRust(db, 'proPresenterSongView', { data: toBase64(bytes), fileName }));
    if (lone(want) !== got) differ.push(`proPresenterSongView ${what} ${where(lone(want), got)}`);
  };
  for (let i = 0; i < 2000; i++) {
    const bytes = file();
    const fileName = pick([null, undefined, 'Hos Dig', 'Untitled 3', '', ' Äran ']);
    await one(bytes, fileName, `file ${i}`);
    await one(damaged(bytes), fileName, `damaged ${i}`);
  }
  for (let i = 0; i < 300; i++) await one(new Uint8Array(Array.from({ length: int(64) }, () => int(256))), 'x', `noise ${i}`);
  const dir = process.env.GP_REAL_PRO_DIR;
  const real = dir ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pro')) : [];
  for (const f of real) await one(readFileSync(join(dir, f)), f.replace(/\.pro$/i, ''), `real ${f}`);
  const realNote = dir ? `, ${real.length} real files` : ', no real files (GP_REAL_PRO_DIR not set)';
  return { compared, differ, notes: [`2 000 files made and 2 000 damaged, 300 of noise${realNote}, ${songs} of them a song`] };
}
