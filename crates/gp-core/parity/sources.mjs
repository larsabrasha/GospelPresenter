// The TS core's slides of a SQLite file, read as the web reads them (`SlideSources`): the reference the Rust views
// are compared with.
import { parseCustomPages, readItemSlides } from './.out/ts-core.mjs';

const camel = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_(\w)/g, (_, c) => c.toUpperCase()), v]));

/** The library as `readItemSlides` reads it, from `db` (node:sqlite). */
function sourcesOf(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p).map(camel);
  const marks = (ids) => ids.map(() => '?').join(',');
  return {
    songData: async (ids) => ({
      songs: new Map(all(`SELECT * FROM songs WHERE id IN (${marks(ids)})`, ...ids).map((s) => [s.id, s])),
      parts: all(`SELECT * FROM song_parts WHERE song_id IN (${marks(ids)})`, ...ids),
      labels: new Map(all('SELECT * FROM labels').map((l) => [l.id, l])),
      arrangements: all(`SELECT * FROM song_arrangements WHERE song_id IN (${marks(ids)})`, ...ids),
    }),
    audio: async (id) => all('SELECT * FROM audios WHERE id = ?', id)[0] ?? null,
    video: async (id) => all('SELECT * FROM videos WHERE id = ?', id)[0] ?? null,
    customSlide: async (id) => {
      const [r] = all('SELECT * FROM custom_slides WHERE id = ?', id);
      return r ? { pages: parseCustomPages(r.pages) } : null;
    },
    image: async (id) => all('SELECT * FROM images WHERE id = ?', id)[0] ?? null,
  };
}

/** A presentation's items in order, and the TS core's slides of each. */
export async function tsSlides(db, presentationId) {
  const items = db.prepare('SELECT * FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id').all(presentationId).map(camel);
  return { items, slides: await readItemSlides(sourcesOf(db), items) };
}

/** JSON with every object's keys in order, so two answers compare by content. */
export const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted()) : x));
