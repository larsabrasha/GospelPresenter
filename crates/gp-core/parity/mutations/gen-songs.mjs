// Random inputs for songs.ts's 10 mutators (and through them history.ts's versions and labels.ts's ensureLabel).
import { TEXTS } from './seed.mjs';

/** Label texts at the edges: the same text cased and spaced otherwise, a renamed label's id, blank, at the limit. */
export const LABEL_TEXTS = ['Verse', ' verse ', 'VERSE  1', 'Chorus', 'Refräng', 'Kör', 'kör', 'Ny etikett', 'ΟΔΟΣ', 'οδος', 'İstanbul', '', '  ', null, 'x'.repeat(50), 'x'.repeat(51), 'Bridge  2'];
export const CONTENTS = ['Härlig är jorden', '', 'Rad ett\nRad två', '  mellanslag  ', 'Skön är himlen', 'é🎵'];
/** Contents at the limit: rare, as every version keeps the whole song. */
const LONG = ['x'.repeat(5000), 'x'.repeat(5001), '🎵'.repeat(5000)];
const content = (pick, random) => (random() < 0.03 ? pick(LONG) : pick(CONTENTS));

export function generator({ random, pick, maybe, idsOf, opt, fresh }) {
  const songIds = () => [...idsOf('SELECT id FROM songs'), 'sx'];
  const partIds = () => [...idsOf('SELECT id FROM song_parts'), 'spx'];
  const newId = (p) => pick([fresh(p), fresh(p), fresh(p), fresh(p), 'x'.repeat(101), '', ...songIds().slice(0, 1), ...partIds().slice(0, 1)]);
  const someSong = () => (random() < 0.6 ? pick(['s1', 's2', 's3']) : pick(songIds()));
  const credit = (max) => maybe(0.7, () => pick(['Ingemann', '  ', '', null, 'x'.repeat(max), 'x'.repeat(max + 1), 'é🎵'.repeat(max / 2)]));
  const q = random();
  if (q < 0.08) return { name: 'createSong', args: opt({ id: newId('s'), name: pick(TEXTS), author: credit(200) }) };
  if (q < 0.2) {
    return {
      name: 'updateSong',
      args: opt({ id: someSong(), name: maybe(0.4, () => pick(TEXTS)), author: credit(200), publisher: credit(200), year: maybe(0.3, () => pick([1850, 0, 9999, 10000, -1, 1.5, null, '1850'])), ccli: credit(20) }),
    };
  }
  if (q < 0.25) {
    const name = pick(['trashSong', 'trashSong', 'restoreSong', 'purgeSong', 'purgeSong']);
    return { name, args: opt({ id: someSong(), at: name === 'trashSong' ? pick([1000, 2000, 1.5, -5, 2 ** 53, undefined]) : undefined }) };
  }
  if (q < 0.45) return { name: 'addSongPart', args: opt({ id: newId('sp'), songId: someSong(), labelText: maybe(0.95, () => pick(LABEL_TEXTS)), content: maybe(0.97, () => content(pick, random)) }) };
  if (q < 0.6) return { name: 'updateSongPart', args: opt({ id: pick(partIds()), content: maybe(0.5, () => content(pick, random)), labelText: maybe(0.5, () => pick(LABEL_TEXTS)) }) };
  if (q < 0.68) return { name: 'removeSongPart', args: { id: pick(partIds()) } };
  if (q < 0.8) return { name: 'moveSongPart', args: { id: pick(partIds()), toIndex: pick([0, 1, 2, 5, 100, -1, 1.5, 2 ** 53, null]) } };
  if (q < 0.97) return { name: 'importSongs', args: { songs: imported({ random, pick, maybe, idsOf, opt, fresh }, songIds, partIds) } };
  return { name: pick(['createSong', 'addSongPart', 'importSongs']), args: pick([null, [], 'x', {}, { songs: [] }, { id: 7 }]) };
}

function imported({ random, pick, opt, fresh }, songIds, partIds) {
  /** Mostly `good`, now and then one of `bad`. */
  const mostly = (good, bad) => (random() < 0.97 ? pick(good) : pick(bad));
  const n = mostly([1, 1, 2, 3, 1, 2, 30], [0, 501]);
  return Array.from({ length: n }, () => {
    const parts = Array.from({ length: mostly([1, 2, 3, 4, 1, 2, 3, 50], [0, 51]) }, () => ({
      id: random() < 0.9 ? fresh('ip') : pick(partIds()), labelText: mostly(LABEL_TEXTS.slice(0, -2), LABEL_TEXTS.slice(-2)), content: mostly(CONTENTS, LONG),
    }));
    const own = parts.map((p) => p.id);
    const arrangements = Array.from({ length: mostly([0, 1, 2, 10], [11]) }, () => ({
      id: random() < 0.9 ? fresh('ia') : pick(['a1', 'a2']),
      name: mostly(['Kort', '  ', null, 'x'.repeat(100)], ['x'.repeat(101), 7]),
      partIds: Array.from({ length: pick([0, 2, 5]) }, () => pick([...own, ...own, 'sp1', 'x'])),
    }));
    const song = opt({
      id: random() < 0.85 ? fresh('is') : pick(songIds()),
      name: mostly(['Ny sång', '  Importerad ', 'x'.repeat(200), 'Härlig är jorden'], ['', 'x'.repeat(201)]),
      author: mostly(['Författare', null, ''], [7]), publisher: mostly(['Förlag', null], ['x'.repeat(201)]), ccli: mostly(['12345', null], ['x'.repeat(21)]),
      parts, arrangements,
      replaces: mostly([null, null, 's1', 's2', 's3', 's4', 'sx', 'bulk7'], [undefined, '']),
    });
    return song;
  });
}

/** A seed's own rows: the tenth starts at the song limit's edge, 4 995 songs in the library. */
export const seedFor = (s) => (s === 10 ? [`INSERT INTO songs (id, name) SELECT 'bulk' || x, 'Sång ' || x FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 4995) SELECT x FROM c)`] : []);
