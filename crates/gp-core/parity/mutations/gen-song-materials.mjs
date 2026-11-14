// Random inputs for song-materials.ts's 4 mutators.
import { KNOWN, TEXTS, UNKNOWN } from './seed.mjs';

const URLS = ['https://open.spotify.com/track/1', 'http://youtube.com', '  HTTPS://Example.se/å?q=1#x  ', 'https://', 'https:///path', 'https://?q', 'ftp://x.se',
  'javascript:alert(1)', 'https://a b.se', 'https://ab.se/\n', 'https://é.se', 'https:// x.se', 'https://x.se/﻿', `https://x.se/${'a'.repeat(1983)}`, `https://x.se/${'a'.repeat(1984)}`, null];

export function generator({ random, pick, maybe, mostly, idsOf, opt, fresh }) {
  const materials = () => [...idsOf('SELECT id FROM song_materials'), 'mx'];
  const song = () => pick(['s1', 's1', 's2', 's3', 's4', 'sx']);
  const newId = () => (random() < 0.9 ? fresh('m') : pick([...materials(), '', 'x'.repeat(101)]));
  const q = random();
  if (q < 0.35) {
    return {
      name: 'addSongFile',
      args: opt({
        id: newId(), songId: song(), title: mostly(['Noter', ' Inspelning ', 'é🎵'.repeat(100)], TEXTS), hash: mostly([...KNOWN, ...UNKNOWN], ['A'.repeat(64), 'a'.repeat(63)]),
        contentType: mostly(['application/pdf', 'audio/mpeg', 'audio/x-m4a', 'audio/webm'], ['image/jpeg', 'application/PDF']),
        size: mostly([1, 1000, 20 * 1024 * 1024], [20 * 1024 * 1024 + 1, 0, 1.5]), createdAt: mostly([1, 1000, 2 ** 53 - 1], [1.5, 2 ** 53, undefined]),
      }),
    };
  }
  if (q < 0.7) return { name: 'addSongLink', args: opt({ id: newId(), songId: song(), title: mostly(['Spotify', 'YouTube'], TEXTS), url: maybe(0.97, () => pick(URLS)), createdAt: pick([1, 2000]) }) };
  if (q < 0.85) return { name: 'renameSongMaterial', args: opt({ id: pick(materials()), title: maybe(0.97, () => pick(TEXTS)) }) };
  return { name: 'removeSongMaterial', args: { id: pick(materials()) } };
}
