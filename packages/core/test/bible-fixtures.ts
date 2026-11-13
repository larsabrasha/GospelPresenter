// A tiny sample translation for tests and development: a few verses of the
// World English Bible, which is in the public domain. No copyrighted
// translation is ever committed (docs/bibles-and-themes.md, "Bibles").
import { makeZip, utf8Encode } from '../src/index.ts';

/** [book, chapter, verse, text] */
export const WEB_SAMPLE: [string, number, number, string][] = [
  ['GEN', 1, 1, 'In the beginning, God created the heavens and the earth.'],
  ['GEN', 1, 2, 'The earth was formless and empty. Darkness was on the surface of the deep and God’s Spirit was hovering over the surface of the waters.'],
  ['GEN', 1, 3, 'God said, “Let there be light,” and there was light.'],
  ['PSA', 23, 1, 'Yahweh is my shepherd; I shall lack nothing.'],
  ['PSA', 23, 2, 'He makes me lie down in green pastures. He leads me beside still waters.'],
  ['PSA', 23, 3, 'He restores my soul. He guides me in the paths of righteousness for his name’s sake.'],
  ['PSA', 23, 4, 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.'],
  ['PSA', 23, 5, 'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.'],
  ['PSA', 23, 6, 'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh’s house forever.'],
  ['JHN', 3, 16, 'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.'],
  ['JHN', 3, 17, 'For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.'],
  ['JHN', 3, 18, 'He who believes in him is not judged. He who doesn’t believe has been judged already, because he has not believed in the name of the one and only Son of God.'],
  ['ROM', 8, 28, 'We know that all things work together for good for those who love God, for those who are called according to his purpose.'],
  ['ROM', 8, 29, 'For whom he foreknew, he also predestined to be conformed to the image of his Son, that he might be the firstborn among many brothers.'],
  ['ROM', 8, 30, 'Whom he predestined, those he also called. Whom he called, those he also justified. Whom he justified, those he also glorified.'],
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** One book of the sample as USX 3, with a heading, a footnote and a poetry line break thrown in. */
export function sampleUsx(code: string): string {
  const verses = WEB_SAMPLE.filter(([b]) => b === code);
  let chapter = -1;
  const body = verses
    .map(([, c, v, t]) => {
      const head = c === chapter ? '' : `<chapter number="${c}" style="c" sid="${code} ${c}"/>\n<para style="s1">A heading that is not verse text</para>\n`;
      chapter = c;
      return `${head}<para style="p"><verse number="${v}" style="v" sid="${code} ${c}:${v}"/>${esc(t)}<note caller="+" style="f"><char style="ft">A footnote.</char></note><verse eid="${code} ${c}:${v}"/></para>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<usx version="3.0">\n<book code="${code}" style="id">World English Bible</book>\n<para style="h">${code}</para>\n${body}\n</usx>\n`;
}

/** One book of the sample as USFM, as eBible publishes it. */
export function sampleUsfm(code: string): string {
  const verses = WEB_SAMPLE.filter(([b]) => b === code);
  let chapter = -1;
  const body = verses
    .map(([, c, v, t]) => {
      const head = c === chapter ? '' : `\\c ${c}\n\\s1 A heading that is not verse text\n\\p\n`;
      chapter = c;
      return `${head}\\v ${v} ${t}\\f + \\fr ${c}:${v} \\ft A footnote.\\f*`;
    })
    .join('\n');
  return `\\id ${code} World English Bible\n\\ide UTF-8\n\\h ${code}\n\\toc1 ${code}\n\\mt1 ${code}\n${body}\n`;
}

const BOOKS = [...new Set(WEB_SAMPLE.map(([b]) => b))];

/** A DBL zip (metadata.xml and USX_1/) of the sample, named as given. */
export function sampleDblZip(name = 'World English Bible (exempel)', abbreviation = 'WEB'): Uint8Array {
  const metadata = `<?xml version="1.0" encoding="utf-8"?>
<DBLMetadata version="2.0"><identification><name>World English Bible</name><nameLocal>${esc(name)}</nameLocal>
<abbreviation>WEB</abbreviation><abbreviationLocal>${esc(abbreviation)}</abbreviationLocal></identification>
<language><iso>eng</iso><name>English</name></language></DBLMetadata>`;
  return makeZip([
    { name: 'release/metadata.xml', data: utf8Encode(metadata) },
    ...BOOKS.map((b) => ({ name: `release/USX_1/${b}.usx`, data: utf8Encode(sampleUsx(b)) })),
  ]);
}

/** An eBible-style USFM zip of the sample, with copr.htm. */
export function sampleUsfmZip(): Uint8Array {
  return makeZip([
    { name: 'eng-web/copr.htm', data: utf8Encode('<html><head><title>World English Bible</title></head><body>Public domain.</body></html>') },
    ...BOOKS.map((b, i) => ({ name: `eng-web/${String(i + 2).padStart(2, '0')}-${b}eng-web.usfm`, data: utf8Encode(sampleUsfm(b)) })),
  ]);
}
