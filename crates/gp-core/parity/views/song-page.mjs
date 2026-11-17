// The song's pages against 2.0's reads (SongEditor.tsx, SongArrangements.tsx, SongHistory.tsx, song-materials at
// 238d481b): every song, one gone and one in the trash; on the demo data with a history and materials added.
import { arrangementsOf, getSong, listLabels, presentationsUsing, songMaterialsOf, songPartsOf, songVersionsOf, themeOf } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

export default async function check(_, file) {
  const db = fixture(file);
  const d = readDb(db);
  const differ = [];
  let compared = 0;
  const same = (what, want, got) => {
    compared++;
    if (canon(want) !== canon(got)) differ.push(`${what}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  };
  const ids = [...db.prepare('SELECT id FROM songs').all().map((r) => r.id), 'no-such'];
  for (const id of ids) {
    const page = { song: await getSong(d, id), parts: await songPartsOf(d, [id]), arrangements: await arrangementsOf(d, [id]), labels: [...(await listLabels(d)).values()] };
    same(`songPageView ${id}`, page, await viewRust(db, 'songPageView', { id }));
    same(`songView ${id}`, await getSong(d, id), await viewRust(db, 'songView', { id }));
    same(`songPresentationsView ${id}`, await presentationsUsing(d, id), await viewRust(db, 'songPresentationsView', { songId: id }));
    const history = { song: await getSong(d, id), versions: await songVersionsOf(d, id), theme: await themeOf(d, null) };
    same(`songHistoryView ${id}`, history, await viewRust(db, 'songHistoryView', { id }));
  }
  for (const songIds of [[], ['song-0'], ['song-1', 'song-0', 'no-such']]) same(`songMaterialsView ${songIds}`, await songMaterialsOf(d, songIds), await viewRust(db, 'songMaterialsView', { songIds }));
  return { compared, differ, notes: [`${ids.length} songs' pages, histories and the presentations showing them, materials`] };
}
