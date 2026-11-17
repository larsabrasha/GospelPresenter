// The presentation page and presenting: each running order's slides (itemSlidesView against readItemSlides), and the
// keys and marks (presentingKeyView and slideMarksView against presentingKey and slideMarks), on random states.
import { presentingKey, slideMarks, slideOrder } from '../.out/ts-core.mjs';
import { viewRust } from '../diff.mjs';
import { canon, tsSlides } from '../sources.mjs';

let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const KEYS = [{ type: 'step', delta: 1 }, { type: 'step', delta: -1 }, { type: 'pick', delta: 1 }, { type: 'pick', delta: -1 },
  { type: 'enter' }, { type: 'black' }, { type: 'escape' }];

export default async function check(db) {
  const differ = [];
  let compared = 0, keys = 0, marks = 0;
  const orders = [];
  for (const { id } of db.prepare('SELECT id FROM presentations').all()) {
    const ts = await tsSlides(db, id);
    const items = ts.items.map((i) => ({ id: i.id, type: i.type, title: i.title, sourceId: i.sourceId, arrangementId: i.arrangementId, content: i.content }));
    const rust = await viewRust(db, 'itemSlidesView', { items });
    for (const item of ts.items) {
      compared++;
      const want = canon(ts.slides.get(item.id)), got = canon(rust[item.id]);
      if (want !== got) differ.push(`slides ${item.type} ${item.title}: TS ${want.slice(0, 200)} Rust ${got.slice(0, 200)}`);
    }
    orders.push(ts.items.map((i) => [i.id, ts.slides.get(i.id).slides.length]));
  }
  // Every running order, empty ones too, from random states: a slide shown or nothing, black or not, one picked or not.
  for (let n = 0; n < 6000; n++) {
    const pairs = pick(orders);
    const order = slideOrder(pairs.map(([itemId, parts]) => ({ itemId, parts })));
    const at = () => (order.length && rand() < 0.85 ? pick(order) : { itemId: rand() < 0.5 ? null : 'gone', partIndex: 0 });
    const state = { presenting: rand() < 0.7, shown: { ...at(), black: rand() < 0.2 }, picked: rand() < 0.5 ? at() : null };
    if (state.picked?.itemId === null) state.picked = null;
    const key = pick(KEYS);
    const want = canon(presentingKey(order, state, key));
    const got = canon(await viewRust(db, 'presentingKeyView', { order: pairs, state, key }));
    compared++;
    keys++;
    if (want !== got) differ.push(`key ${JSON.stringify(key)} on ${JSON.stringify(state)}: TS ${want} Rust ${got}`);
    const mark = slideMarks(order, state.shown);
    const r = await viewRust(db, 'slideMarksView', { order: pairs, shown: state.shown });
    const rustMark = (s) => (r.shown && r.shown.itemId === s.itemId && r.shown.partIndex === s.partIndex ? 'shown' : r.next && r.next.itemId === s.itemId && r.next.partIndex === s.partIndex ? 'next' : null);
    for (const s of [...order, state.shown]) {
      compared++;
      marks++;
      if (mark(s.itemId, s.partIndex) !== rustMark(s)) differ.push(`marks of ${JSON.stringify(s)} with ${JSON.stringify(state.shown)}: TS ${mark(s.itemId, s.partIndex)} Rust ${rustMark(s)}`);
    }
  }
  return { compared, differ, notes: [`${orders.length} running orders' slides`, `${keys} keys`, `${marks} marks`] };
}
