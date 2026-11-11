import { utf8Encode } from '../src/index.ts';

// A small protobuf writer, enough to build `.pro` files of rv.data.Presentation (as in
// GospelPresenter.Shared/Proto/propresenter.proto) for the core's tests and the e2e's. A field is
// [number, value]: a string or bytes (length-delimited), a number (varint), or a nested message.
type Value = string | number | Uint8Array | Field[];
type Field = [number, Value];

const enc = { encode: utf8Encode };

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

function message(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [no, v] of fields) {
    if (typeof v === 'number') out.push(...varint((no << 3) | 0), ...varint(v));
    else {
      const bytes = typeof v === 'string' ? enc.encode(v) : v instanceof Uint8Array ? v : message(v);
      out.push(...varint((no << 3) | 2), ...varint(bytes.length), ...bytes);
    }
  }
  return new Uint8Array(out);
}

const uuid = (id: string): Field[] => [[1, id]];

/** Cocoa's RTF around a slide's lines, each ending in a backslash as ProPresenter writes them. */
export function rtf(lines: string[]): string {
  return [
    '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2511',
    '\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}',
    '{\\colortbl;\\red255\\green255\\blue255;}',
    '{\\*\\expandedcolortbl;;}',
    '\\pard\\pardirnatural\\qc\\partightenfactor0',
    '',
    '\\f0\\fs48 \\cf1 ' + lines.join('\\\n'),
    '}',
  ].join('\n');
}

/** A cue (slide) whose one text element holds `text`, or no text element when `text` is null. */
function cue(id: string, text: string | null): Field[] {
  const element: Field[] = text === null ? [] : [[1, [[13, [[5, enc.encode(text)]]]]]];
  return [
    [1, uuid(id)],
    [10, [[23, [[2, [[1, [[1, element]]]]]]]]],
  ];
}

export interface Spec {
  name?: string;
  ccli?: { author?: string; title?: string; publisher?: string; number?: number };
  groups: { id: string; name: string; slides: (string | null)[] }[];
  arrangements?: { name: string; groups: string[] }[];
}

export function pro(spec: Spec): Uint8Array {
  const fields: Field[] = [];
  if (spec.name !== undefined) fields.push([3, spec.name]);
  for (const a of spec.arrangements ?? []) fields.push([11, [[1, uuid(`arr-${a.name}`)], [2, a.name], ...a.groups.map((g): Field => [3, uuid(g)])]]);
  let n = 0;
  const cues: Field[] = [];
  for (const g of spec.groups) {
    const ids = g.slides.map((text) => {
      const id = `cue-${n++}`;
      cues.push([13, cue(id, text === null ? null : rtf(text.split('\n')))]);
      return id;
    });
    fields.push([12, [[1, [[1, uuid(g.id)], [2, g.name]]], ...ids.map((id): Field => [2, uuid(id)])]]);
  }
  fields.push(...cues);
  if (spec.ccli) {
    const c = spec.ccli;
    const block: Field[] = [];
    if (c.author) block.push([1, c.author]);
    if (c.title) block.push([3, c.title]);
    if (c.publisher) block.push([4, c.publisher]);
    if (c.number) block.push([6, c.number]);
    fields.push([14, block]);
  }
  return message(fields);
}
