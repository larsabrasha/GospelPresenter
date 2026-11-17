// A search hit's marking against 2.0's (238d481b): `highlightView` against search.ts's `highlight` (SONG-A20), for the
// demo's song names and lines and made-up texts (accents, case, decomposed letters, a letter past the BMP, digits and
// punctuation), each with random queries: words' starts, middles, accents dropped or added, several terms, spaces.
import { highlight } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

const MADE_UP = ['Härlig är jorden', 'HÄRLIG ÄR JORDEN', 'Härlig är jorden'.normalize('NFD'), 'Café crème – O store Gud', 'Ps 23:1–4, v. 2', 'Jesus 𝄞 älskar', 'ÅÄÖ åäö éè', 'ab-cd_ef (gh) "ij"', '', '1:a Mosebok 3:15'];

export default async function check(db) {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const texts = [...MADE_UP, ...db.prepare('SELECT name FROM songs').all().map((r) => r.name), ...db.prepare('SELECT content FROM song_parts LIMIT 40').all().flatMap((r) => String(r.content).split('\n'))];
  const differ = [];
  let compared = 0;
  for (let i = 0; i < 3000; i++) {
    const text = pick(texts);
    const words = text.split(/\s+/).filter(Boolean);
    const word = pick(words.length ? words : ['x']);
    const part = () => word.slice(Math.floor(rand() * 2), 1 + Math.floor(rand() * word.length));
    const query = pick([
      () => part(),
      () => part().toUpperCase(),
      () => part().normalize('NFD').replace(/\p{M}/gu, ''),
      () => `${part()} ${pick(words.length ? words : ['y']).slice(0, 2)}`,
      () => `  ${part()}  `,
      () => pick(['a', 'ä', 'e', 'é', '𝄞', 'jo', 'ÖR', '1', ':', '']),
    ])();
    compared++;
    const want = highlight(text, query);
    const got = await viewRust(db, 'highlightView', { text, query });
    if (canon(want) !== canon(got)) differ.push(`highlightView ${JSON.stringify(text).slice(0, 60)} ${JSON.stringify(query)}: TS ${canon(want).slice(0, 200)} Rust ${canon(got).slice(0, 200)}`);
  }
  return { compared, differ, notes: ['3 000 texts and queries marked'] };
}
