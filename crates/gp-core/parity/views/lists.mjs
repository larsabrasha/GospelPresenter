// The presentations page, the templates, the trash and the lists other pages read against 2.0's reads
// (listPresentations, listTemplates, itemCounts, itemsOf, listLabels, songPartsOf, pinnedIds and listTrash at
// 238d481b). Lists the page orders by its language are compared in the order the page puts them in.
import { itemCounts, itemsOf, listLabels, listPresentations, listTemplates, listTrash, pinnedIds, songPartsOf } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

const collator = new Intl.Collator('sv-SE', { sensitivity: 'base' });
const byLastChanged = (a, b) => (b.updatedAt ?? -1) - (a.updatedAt ?? -1);
/** listTemplates's and listTrash's own orders, as the page puts the core's rows in them. */
const templateOrder = (xs) => xs.toSorted((a, b) => byLastChanged(a, b) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
const trashOrder = (xs) => xs.toSorted((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));

export default async function check(_, file) {
  const db = fixture(file);
  const d = readDb(db);
  const differ = [];
  let compared = 0;
  const same = async (view, args, want, order = (x) => x) => {
    compared++;
    const got = order(await viewRust(db, view, args));
    if (canon(want) !== canon(got)) differ.push(`${view} ${JSON.stringify(args)}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  };
  await same('presentationListView', {}, await listPresentations(d));
  // Ordered by the core since 2026-11-18 (collation.rs): its order is compared, not put in the page's first.
  await same('templatesView', {}, templateOrder(await listTemplates(d, 'sv')));
  await same('itemCountsView', {}, [...(await itemCounts(d)).entries()], (xs) => xs.map(([id, n]) => [id, Number(n)]));
  await same('labelsView', {}, [...(await listLabels(d)).values()]);
  await same('pinnedView', {}, [...(await pinnedIds(d))]);
  await same('trashEntriesView', {}, await listTrash(d), trashOrder);
  for (const { id } of [...db.prepare('SELECT id FROM presentations').all(), { id: 'no-such' }]) await same('itemsView', { presentationId: id }, await itemsOf(d, id));
  for (const songIds of [[], ['song-0'], ['song-1', 'song-0', 'no-such']]) await same('songPartsView', { songIds }, await songPartsOf(d, songIds));
  return { compared, differ, notes: ['presentations, templates, item counts, labels, kept offline, the trash, every running order, parts'] };
}
