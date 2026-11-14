// Random inputs for labels.ts's 4 mutators, with songs' parts made between them, which make labels from their text.
import { generator as songs, LABEL_TEXTS } from './gen-songs.mjs';

export function generator(t, step) {
  const { random, pick, maybe, idsOf, opt } = t;
  if (random() < 0.15) return songs(t, step);
  const labelIds = () => [...idsOf('SELECT id FROM labels'), 'label:x', 'label:kör:2'];
  const text = () => pick([...LABEL_TEXTS, 'Brygga', 'Ny', ' ny ', 'NY', 'Tag', 'Outro', 'x'.repeat(50)]);
  const color = () => (random() < 0.8 ? pick(['#3478C7', '#abcdef', '#000000', '#Ff00aA']) : pick(['#12345', '#1234567', 'red', '#GGGGGG', '#abcdef\n', null]));
  const q = random();
  if (q < 0.3) return { name: 'createLabel', args: opt({ text: maybe(0.97, text), color: maybe(0.97, color) }) };
  if (q < 0.6) return { name: 'updateLabel', args: opt({ id: pick(labelIds()), text: maybe(0.5, text), color: maybe(0.5, color) }) };
  if (q < 0.75) return { name: 'deleteLabel', args: { id: pick(labelIds()) } };
  return { name: 'moveLabel', args: { id: pick(labelIds()), toIndex: pick([0, 1, 2, 5, 300, -1, 1.5, null]) } };
}

/** The tenth seed starts at the edge of the label limit: 197 labels. */
export const seedFor = (s) => (s === 10 ? [`INSERT INTO labels (id, text, color, sort) SELECT 'bulk' || x, 'Etikett ' || x, '#000000', x + 2 FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 194) SELECT x FROM c)`] : []);
