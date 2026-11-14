// Random inputs for trash.ts's 2 mutators, between trashings of every kind, at times on both sides of the retention.
import { generator as presentations } from './gen-presentations.mjs';

const DAY = 24 * 3600 * 1000;
const RETENTION = 30 * DAY;

export function generator(t, step) {
  const { random, pick, mostly, idsOf } = t;
  const now = 100 * DAY;
  if (random() < 0.15) return presentations(t, step);
  const q = random();
  if (q < 0.55) {
    // Something to the trash, deleted just before, at, or after the cutoff of `now`.
    const [table, name] = pick([['songs', 'trashSong'], ['presentations WHERE is_template = 0', 'trashPresentation'], ['presentations WHERE is_template = 1', 'trashTemplate'],
      ['images', 'trashImage'], ['audios', 'trashAudio'], ['videos', 'trashVideo'], ['custom_slides', 'trashCustomSlide'], ['songs', 'restoreSong']]);
    const id = pick([...idsOf(`SELECT id FROM ${table}`), 'zx']);
    return { name, args: { id, at: now - RETENTION + pick([-1, 0, 1, -DAY, DAY, -RETENTION]) } };
  }
  // The server's clock (ctx.now) behind the client's, the same, or ahead: the earlier counts.
  if (q < 0.9) return { name: 'purgeExpiredTrash', args: { now: mostly([now, now, now + DAY, now - DAY, 2 ** 53 - 1], [1.5, null, '1']) }, now: pick([now - DAY, now, now + DAY]) };
  return { name: 'emptyTrash', args: mostly([{}, { extra: 1 }], [[], null]) };
}

/** Each seed's songs, pictures, sounds, videos and slideshows trashed long ago, and some more of each to trash. */
export const seedFor = () => [
  `INSERT INTO songs (id, name, deleted_at) VALUES ('old1', 'Gammal', 5), ('new1', 'Ny', NULL)`,
  `INSERT INTO song_parts (id, song_id, sort, content) VALUES ('oldp', 'old1', 0, 'x')`,
  `INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES ('img4', 'd.jpg', 'image/jpeg', 'a', 'b', 1, 1, 0)`,
];
