// The app's live state against 2.0's TS (packages/core/src/live.ts at 238d481b): `liveChangeView` against
// `applyLiveChange` with its `rev` one on, and `followItemOverlayView` against `followItemOverlay`, on random pointers,
// changes and items' overlays. Where Lars added a rule (2026-11-18: one presentation presented at a time) the TS is no
// yardstick: a start while another is presented must be refused, and the pointer left as it was.
import { applyLiveChange, followItemOverlay } from '../.out/ts-core.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

let seed = 31;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const PRESENTATIONS = [null, 'p1', 'p2'];
const ITEMS = [null, 'a', 'b', 'c'];
const OVERLAYS = [null, 'o1', 'o2'];

const pointer = () => ({ presentationId: pick(PRESENTATIONS), itemId: pick(ITEMS), partIndex: pick([0, 1, 2]), black: rand() < 0.3, overlayId: pick(OVERLAYS), rev: pick([0, 1, 7]) });

/** A change as the pages send them: any of the fields, each sometimes. */
function change() {
  const c = {};
  if (rand() < 0.3) c.presentationId = pick(PRESENTATIONS);
  if (rand() < 0.6) c.itemId = pick(ITEMS);
  if (rand() < 0.5) c.partIndex = pick([0, 1, 2]);
  if (rand() < 0.4) c.black = rand() < 0.5;
  if (rand() < 0.25) c.overlayId = pick(OVERLAYS);
  return c;
}

export default async function check(db) {
  const differ = [];
  let changes = 0, refusals = 0, follows = 0;
  for (let n = 0; n < 6000; n++) {
    const p = pointer(), c = change();
    const overlays = Object.fromEntries(['a', 'b', 'c'].filter(() => rand() < 0.6).map((i) => [i, pick(['o1', 'o2'])]));
    const got = await viewRust(db, 'liveChangeView', { pointer: p, change: c, overlays });
    if (c.presentationId && p.presentationId && c.presentationId !== p.presentationId) {
      refusals++;
      if (got.refused !== 'another-presented') differ.push(`start over ${JSON.stringify(p)} with ${JSON.stringify(c)}: not refused: ${canon(got)}`);
      continue;
    }
    changes++;
    const want = { pointer: { ...applyLiveChange(p, c, (itemId) => overlays[itemId] ?? null), rev: p.rev + 1 } };
    if (canon(want) !== canon(got)) differ.push(`change ${JSON.stringify(c)} of ${JSON.stringify(p)} (${JSON.stringify(overlays)}): TS ${canon(want)} Rust ${canon(got)}`);
  }
  for (let n = 0; n < 3000; n++) {
    const p = pointer();
    const args = { pointer: p };
    // `before` and `after` left out stand for undefined, as the owner passes an item's overlay it did not know.
    if (rand() < 0.8) args.before = pick(OVERLAYS);
    if (rand() < 0.8) args.after = pick(OVERLAYS);
    const t = followItemOverlay(p, args.before, args.after);
    const want = t === undefined ? { change: false } : { change: true, overlayId: t };
    const got = await viewRust(db, 'followItemOverlayView', args);
    follows++;
    if (canon(want) !== canon(got)) differ.push(`follow ${JSON.stringify(args)}: TS ${canon(want)} Rust ${canon(got)}`);
  }
  return { compared: changes + refusals + follows, differ, notes: [`${changes} changes`, `${refusals} starts while another is presented`, `${follows} items' overlays changed`] };
}
