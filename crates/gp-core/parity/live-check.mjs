// The Rust core's presenting reducer against the TS core's: `presentingKey` for the keys and `slideMarks` for VISAS
// and NÄSTA (packages/core/src/presenting.ts), over the TS core's own slides. Start, stop and a clicked slide are the
// Mac app's own and only checked against this file's reading of them.
import { DatabaseSync } from 'node:sqlite';
import { presentingKey, slideMarks, slideOrder } from './.out/ts-core.mjs';
import { viewRust } from './diff.mjs';
import { canon, tsSlides } from './sources.mjs';

const db = new DatabaseSync(process.argv[2]);
let seed = 3;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const same = (a, b) => !!a && !!b && a.itemId === b.itemId && a.partIndex === b.partIndex;
const KEYS = new Set(['step', 'pick', 'enter', 'black', 'escape']);

/** The Rust reducer's state after `action`, as the TS core works it out; its `pointer` is null for nothing shown. */
function reference(order, s, action) {
  let { presenting, pointer, picked } = structuredClone(s);
  if (KEYS.has(action.type)) {
    const next = presentingKey(order, { presenting, shown: pointer ?? { itemId: null, partIndex: 0, black: false }, picked }, action);
    pointer = next.shown.itemId === null ? null : next.shown;
    picked = next.picked;
  } else if (action.type === 'show') {
    const t = order.find((x) => same(x, action)) ?? null;
    if (presenting) { if (t) { pointer = { ...t, black: false }; picked = null; } } else picked = t;
  } else if (action.type === 'start') {
    presenting = true;
    pointer = picked ?? order[0] ?? null;
    pointer = pointer && { ...pointer, black: false };
    picked = null;
  } else if (action.type === 'stop') {
    presenting = false;
    pointer = null;
    picked = null;
  }
  const mark = slideMarks(order, pointer ?? { itemId: null, partIndex: 0, black: false });
  const shown = order.find((t) => mark(t.itemId, t.partIndex) === 'shown');
  const next = order.find((t) => mark(t.itemId, t.partIndex) === 'next');
  return { presenting, pointer, picked, shown: shown ? `${shown.itemId}/${shown.partIndex}` : null, next: next ? `${next.itemId}/${next.partIndex}` : null };
}

let checked = 0, differ = 0;
for (const { id } of db.prepare('SELECT id FROM presentations WHERE deleted_at IS NULL').all()) {
  const ts = await tsSlides(db, id);
  const steps = slideOrder(ts.items.map((i) => ({ itemId: i.id, parts: ts.slides.get(i.id).slides.length })));
  let state = { presenting: false, pointer: null, picked: null };
  for (let n = 0; n < 300; n++) {
    const someSlide = pick([...steps, { itemId: 'gone', partIndex: 0 }]) ?? { itemId: 'gone', partIndex: 0 };
    const action = pick([
      { type: 'step', delta: 1 }, { type: 'step', delta: 1 }, { type: 'step', delta: -1 }, { type: 'pick', delta: 1 }, { type: 'pick', delta: -1 },
      { type: 'enter' }, { type: 'black' }, { type: 'escape' }, { type: 'show', ...someSlide }, { type: 'start' }, { type: 'stop' },
    ]);
    const want = reference(steps, state, action);
    const order = n % 2 ? ts.items.map((i) => [i.id, ts.slides.get(i.id).slides.length]) : undefined; // half from the shell, half worked out
    const got = await viewRust(db, 'liveView', { presentationId: id, order, ...state, action });
    checked++;
    if (canon(want) !== canon(got)) {
      differ++;
      if (differ < 4) console.log(`DIFF ${JSON.stringify(action)} from ${JSON.stringify(state)}\n  TS   ${JSON.stringify(want)}\n  Rust ${JSON.stringify(got)}`);
    }
    state = { presenting: want.presenting, pointer: want.pointer, picked: want.picked };
  }
}
console.log(`live: ${checked} key presses compared, ${differ} different`);
