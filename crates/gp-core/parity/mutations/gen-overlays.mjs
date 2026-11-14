// Random inputs for overlays.ts's 3 mutators, and items that carry an overlay.
import { pageMaker } from './pages.mjs';
import { TEXTS } from './seed.mjs';

export function generator(t, step) {
  const { random, pick, maybe, mostly, idsOf, opt, fresh } = t;
  const { page } = pageMaker(t);
  const overlays = () => [...idsOf('SELECT id FROM overlays'), 'ox'];
  const at = () => mostly([1000 + step], [1.5, undefined]);
  const q = random();
  if (q < 0.35) return { name: 'createOverlay', args: opt({ id: random() < 0.9 ? fresh('o') : pick([...overlays(), '']), title: mostly(['Kollekt', ' Välkommen '], TEXTS), page: maybe(0.7, () => mostly([page()], [null])), at: at() }) };
  if (q < 0.7) return { name: 'updateOverlay', args: opt({ id: pick(overlays()), title: maybe(0.4, () => mostly(['Nytt'], TEXTS)), page: maybe(0.6, page), at: at() }) };
  if (q < 0.85) return { name: 'setItemOverlay', args: { itemId: pick([...idsOf('SELECT id FROM presentation_items'), 'ix']), overlayId: pick([...overlays(), null]) }, role: 'user' };
  return { name: 'deleteOverlay', args: { id: pick(overlays()) } };
}

/** The tenth seed starts at the edge of the overlays' limit: 198. */
export const seedFor = (s) => (s === 10 ? [`INSERT INTO overlays (id, title, content, sort) SELECT 'bulk' || x, 'Overlay ' || x, NULL, x + 1 FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 196) SELECT x FROM c)`] : []);
