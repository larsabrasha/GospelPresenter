// The presentation page's reads (presentationPageView) against the page's own (PresentationEditor.tsx's useData):
// the presentation, its theme, its items, the songs and arrangements they use and the overlays; the slides are
// readItemSlides's (sources.mjs). On the demo data with themes and overlays added (fixture.mjs).
import { arrangementsOf, getPresentation, itemsOf, listOverlays, songsById, themeOf } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon, tsSlides } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

export default async function check(_, file) {
  const db = fixture(file);
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
