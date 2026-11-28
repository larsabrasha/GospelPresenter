// A spreadsheet as rows of text (docs/planning.md, "Import"): the first sheet of an .xlsx (Excel, Google Sheets'
// export), or a CSV. Read without a DOM, so it runs on every end; dates Excel keeps as numbers become `YYYY-MM-DD`.
import { MutationError } from './mutation.ts';
import { utf8Decode } from './platform.ts';
import { readZip, zipEntryBytes } from './zip.ts';

/** XML's five entities and numeric references. */
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (e[0] !== '#') return named[e.toLowerCase()] ?? '';
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

/** The text of every `<t>` inside `xml`, joined: a cell's or a shared string's runs. */
const runs = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('');

/** A column's letters as a 0-based index: A is 0, Z 25, AA 26. */
const columnIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Excel's serial day (the 1900 system) as `YYYY-MM-DD`, its fraction as ` HH:MM`. */
function serialDate(n: number): string {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const minutes = Math.round((n % 1) * 1440);
  return minutes ? `${date} kl ${String(Math.floor(minutes / 60)).padStart(2, '0')}.${String(minutes % 60).padStart(2, '0')}` : date;
}

/** The styles whose number format is a date, by index (`cellXfs`), from the built-in ids and the workbook's own formats. */
function dateStyles(styles: string): Set<number> {
  const own = new Map([...styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unescape(m[2]!)]));
  const isDate = (id: number) => (id >= 14 && id <= 22) || (own.has(id) && /[dmy]/i.test(own.get(id)!.replace(/"[^"]*"|\[[^\]]*\]/g, '')));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const out = new Set<number>();
  [...xfs.matchAll(/<xf\s([^>]*)/g)].forEach((m, i) => {
    if (isDate(Number(/numFmtId="(\d+)"/.exec(m[1]!)?.[1] ?? -1))) out.add(i);
  });
  return out;
}

/** The first sheet of an .xlsx as rows of text, a cell left out as "". */
function readXlsx(data: Uint8Array): string[][] {
  const entries = readZip(data);
  const file = (name: string) => {
    const e = entries.find((x) => x.name === name);
    if (!e) return null;
    return utf8Decode(zipEntryBytes(data, e));
  };
  const shared = [...(file('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]!));
  const dates = dateStyles(file('xl/styles.xml') ?? '');
  // The first sheet in the workbook's order, through its relationship; else sheet1.
  const workbook = file('xl/workbook.xml') ?? '';
  const rid = /<sheet\s[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = file('xl/_rels/workbook.xml.rels') ?? '';
  const target = rid ? new RegExp(`<Relationship\\s[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? /Target="([^"]+)"[^>]*Id="${rid}"/.exec(rels)?.[1] : undefined;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = file(path) ?? file('xl/worksheets/sheet1.xml');
  if (sheet === null) throw new MutationError('not-sheet', 'the file has no sheet');
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const i = ref ? columnIndex(ref) : cells.length;
      const body = c[2] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = runs(body);
      else if (v !== undefined) text = !type && dates.has(style) && Number.isFinite(Number(v)) ? serialDate(Number(v)) : unescape(v);
      while (cells.length < i) cells.push('');
      cells[i] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/** A CSV as rows of text: the delimiter (`;`, `,` or a tab) the first line has most of, quotes as RFC 4180 has them. */
function readCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const first = body.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A spreadsheet file as rows: .xlsx by its zip signature, anything else as CSV text. */
export function readSheet(data: Uint8Array): string[][] {
  return data[0] === 0x50 && data[1] === 0x4b ? readXlsx(data) : readCsv(utf8Decode(data));
}
