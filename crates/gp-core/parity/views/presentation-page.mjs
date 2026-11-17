// The presentation page's reads (presentationPageView) against the page's own (PresentationEditor.tsx's useData):
// the presentation, its theme, its items, the songs and arrangements they use and the overlays; the slides are
// readItemSlides's (sources.mjs). On a copy of the demo data with own themes, a default theme and overlays added.
import { copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { arrangementsOf, BUILT_IN_THEMES, getPresentation, itemsOf, listOverlays, songsById, themeOf } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon, tsSlides } from '../sources.mjs';
import { readDb } from './web-db.mjs';

/** The demo data with what it lacks for a theme and an overlay to be read: each way a presentation gets its theme. */
function withThemes(file) {
  const copy = file.replace(/\.sqlite$/, '-page.sqlite');
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  const own = JSON.stringify({ ...BUILT_IN_THEMES[1].definition, extra: 1 });
  db.prepare('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, 0)').run('own-1', 'Vår', own, 0);
  db.prepare('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, 0)').run('own-bad', 'Trasig', '{"song": 1}', 1);
  db.prepare("INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'own-1')").run();
  db.prepare("INSERT INTO overlays (id, title, content, sort, updated_at) VALUES ('ov-2', 'Logga', NULL, 2, 5), ('ov-1', 'Text', '{}', 1, NULL)").run();
  const ids = db.prepare('SELECT id FROM presentations ORDER BY id').all().map((r) => r.id);
  ['light', 'own-bad', 'gone', 'own-1', 'classic'].forEach((theme, k) => ids[k] && db.prepare('UPDATE presentations SET theme_id = ? WHERE id = ?').run(theme, ids[k]));
  return db;
}

export default async function check(_, file) {
  const db = withThemes(file);
  const d = readDb(db);
  const differ = [];
  let compared = 0;
  const ids = [...db.prepare('SELECT id FROM presentations').all().map((r) => r.id), 'no-such'];
  for (const id of ids) {
    const items = await itemsOf(d, id);
    const songIds = [...new Set(items.filter((i) => i.type === 'song').map((i) => i.sourceId))];
    const presentation = await getPresentation(d, id);
    const want = {
      presentation,
      theme: await themeOf(d, presentation),
      items,
      slides: Object.fromEntries((await tsSlides(db, id)).slides),
      songs: [...(await songsById(d, songIds)).values()].toSorted((a, b) => a.id.localeCompare(b.id)),
      arrangements: await arrangementsOf(d, songIds),
      overlays: await listOverlays(d),
    };
    const got = await viewRust(db, 'presentationPageView', { id });
    got.songs = got.songs?.toSorted((a, b) => a.id.localeCompare(b.id));
    for (const k of Object.keys(want)) {
      compared++;
      const [w, g] = [canon(want[k]), canon(got[k])];
      if (w !== g) differ.push(`${id} ${k}: TS ${w.slice(0, 300)} Rust ${g.slice(0, 300)}`);
    }
  }
  return { compared, differ, notes: [`${ids.length} presentations' pages, own and missing themes, overlays`] };
}
