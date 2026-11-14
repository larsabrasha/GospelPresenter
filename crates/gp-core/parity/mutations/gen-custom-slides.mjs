// Random inputs for custom-slides.ts's 7 mutators: slideshows made, edited, trashed and purged, a PDF's added.
import { pageMaker } from './pages.mjs';
import { TEXTS } from './seed.mjs';

export function generator(t, step) {
  const { random, pick, maybe, mostly, idsOf, opt, fresh } = t;
  const { pages, picture } = pageMaker(t);
  const slides = () => [...idsOf('SELECT id FROM custom_slides'), 'cx'];
  const pres = () => [...idsOf('SELECT id FROM presentations'), 'px'];
  const items = () => [...idsOf('SELECT id FROM presentation_items'), 'ix'];
  const newId = (p) => (random() < 0.9 ? fresh(p) : pick([...slides(), ...items().slice(0, 2), '', 'x'.repeat(101)]));
  const at = () => mostly([1000 + step, 5], [1.5, undefined, 2 ** 53]);
  const q = random();
  if (q < 0.2) return { name: 'createCustomSlide', args: opt({ id: newId('c'), name: mostly(['Välkommen', ' Bildspel '], TEXTS), pages: pages(), at: at() }) };
  if (q < 0.4) return { name: 'updateCustomSlide', args: opt({ id: pick(slides()), name: maybe(0.4, () => mostly(['Nytt namn'], TEXTS)), pages: maybe(0.6, pages), at: at() }) };
  if (q < 0.55) {
    const name = pick(['trashCustomSlide', 'trashCustomSlide', 'restoreCustomSlide', 'purgeCustomSlide', 'purgeCustomSlide']);
    return { name, args: opt({ id: pick(slides()), at: name === 'trashCustomSlide' ? at() : undefined }) };
  }
  if (q < 0.75) return { name: 'addCustomSlideToPresentation', args: opt({ itemId: newId('i'), presentationId: pick(pres()), slideId: pick(slides()), afterItemId: maybe(0.4, () => pick([...items(), null])) }) };
  return {
    name: 'addSlides',
    args: opt({
      itemId: newId('i'), presentationId: pick(pres()), deckId: maybe(0.5, () => mostly([fresh('d'), ...slides()], [null, ''])),
      fileName: mostly(['Predikan.pdf', '  Psalm.pdf '], ['', '   ', 'x'.repeat(201)]), pages: Array.from({ length: random() < 0.01 ? 100 : mostly([1, 2, 5], [0, 101]) }, picture),
      afterItemId: maybe(0.4, () => pick([...items(), null])), at: maybe(0.7, at),
    }),
  };
}

/** The tenth seed starts at the edge of the slideshows' limit: 998 in the library. */
export const seedFor = (s) => (s === 10 ? [`INSERT INTO custom_slides (id, name, pages, created_at, updated_at) SELECT 'bulk' || x, 'Bildspel ' || x, '[]', 0, 0 FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 998) SELECT x FROM c)`] : []);
