// Random inputs for bibles-and-themes.ts's 3 mutators: translations imported (a new one, the same abbreviation
// again, a text not stored), renamed and deleted, their stored texts dropped when no translation names them; now and
// then a text stored again, as an upload does.
import { H } from './seed.mjs';

export function generator({ random, pick, maybe, mostly, idsOf, opt }) {
  const bibles = () => [...idsOf('SELECT id FROM bibles'), 'bible:x'];
  if (random() < 0.15) {
    const h = H(pick(['1', '2', '3', '4']));
    return { setup: [`INSERT OR REPLACE INTO bible_blobs (hash, verse_count) VALUES ('${h}', ${pick([10, 31102])})`, `INSERT OR REPLACE INTO bible_texts (hash, book, sort, chunk) VALUES ('${h}', 'GEN', 0, '[]')`] };
  }
  const q = random();
  if (q < 0.5) {
    return {
      name: 'importBible',
      args: opt({
        name: mostly(['Svenska Folkbibeln', ' Bibel 2000 ', 'x'.repeat(200)], ['', '  ', 'x'.repeat(201)]),
        abbreviation: mostly(['SFB', 'sfb', ' SFB ', 'B2000', 'KJV', 'Å1917', 'Å1917', 'ΙΣΟΣ', 'x'.repeat(50), `N${Math.floor(random() * 12)}`], ['', 'x'.repeat(51)]),
        language: maybe(0.97, () => mostly(['sv', ' en ', null, '', 'x'.repeat(20)], ['x'.repeat(21), 7])),
        contentHash: mostly([H('1'), H('2'), H('3'), H('4'), H('9')], ['A'.repeat(64), H('1').slice(1)]),
      }),
    };
  }
  if (q < 0.85) return { name: 'renameBible', args: opt({ id: pick(bibles()), name: mostly(['Ny', ' Namn '], ['', null]) }) };
  return { name: 'deleteBible', args: { id: pick(bibles()) } };
}

/** The tenth seed starts at the edge of the limit: 10 translations, each its own text. */
export const seedFor = (s) => (s === 10 ? [
  `INSERT INTO bible_blobs (hash, verse_count) SELECT printf('%064d', x), x FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 8) SELECT x FROM c)`,
  `INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) SELECT 'bible:b' || x, 'Bibel ' || x, 'B' || x, NULL, x, printf('%064d', x) FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 8) SELECT x FROM c)`,
] : []);
