// Random inputs for arrangements.ts's 6 mutators, with some of songs.ts's between them so parts come and go.
import { generator as songs } from './gen-songs.mjs';

export function generator(t, step) {
  const { random, pick, maybe, idsOf, opt, fresh } = t;
  if (random() < 0.15) return songs(t, step);
  const arrangementIds = () => [...idsOf('SELECT id FROM song_arrangements'), 'ax'];
  const partIds = () => [...idsOf('SELECT id FROM song_parts'), 'spx'];
  /** Part ids of one song mostly, a stranger's and a repeat now and then. */
  const list = () => {
    const song = pick(['s1', 's1', 's2', 's3']);
    const own = idsOf(`SELECT id FROM song_parts WHERE song_id = '${song}'`);
    const n = pick([0, 1, 3, 6, 12, 500, 501]);
    return Array.from({ length: n }, () => ((n === 500 || random() < 0.85) && own.length ? pick(own) : pick(partIds())));
  };
  const chip = () => {
    const full = idsOf('SELECT id FROM song_arrangements WHERE json_array_length(part_ids) >= 500');
    const x = random() < 0.1 && full.length ? pick(full) : pick(arrangementIds());
    const ids = JSON.parse(idsOf(`SELECT part_ids FROM song_arrangements WHERE id = '${x}'`)[0] ?? '[]');
    const at = ids.length ? Math.floor(random() * ids.length) : 0;
    return { id: x, index: pick([at, at, at + 1, at - 1, 0, 600, -1, 1.5]), partId: random() < 0.8 && ids.length ? ids[at] : pick(partIds()) };
  };
  const q = random();
  if (q < 0.15) {
    return { name: 'createArrangement', args: opt({ id: random() < 0.9 ? fresh('a') : pick([...arrangementIds(), '', 'x'.repeat(101)]), songId: pick(['s1', 's1', 's2', 's3', 's4', 'sx']), name: maybe(0.7, () => pick(['Kort', '  ', '', null, 'x'.repeat(100), 'x'.repeat(101)])), partIds: maybe(0.97, list) }) };
  }
  if (q < 0.3) return { name: 'updateArrangement', args: opt({ id: pick(arrangementIds()), name: maybe(0.5, () => pick(['Lång', ' ', null, 'x'.repeat(101)])), partIds: maybe(0.5, list) }) };
  if (q < 0.5) return { name: 'appendArrangementPart', args: opt({ id: chip().id, partId: maybe(0.97, () => pick(partIds())) }) };
  if (q < 0.7) return { name: 'removeArrangementPart', args: chip() };
  if (q < 0.9) return { name: 'moveArrangementPart', args: { ...chip(), by: pick([-1, 1, -1, 1, -3, 4, 0, 500, 501, -500, 1.5]) } };
  return { name: 'removeArrangement', args: { id: pick(arrangementIds()) } };
}
