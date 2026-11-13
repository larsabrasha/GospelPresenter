// The Rust core's presenting reducer against the web's: `step` and `pickStep` (PresentationEditor.tsx), ↵, b and Escape
// (useEditorKeys.ts), transcribed below, and the marks from the web's own `slideMarks` (liveList.ts). Start, stop and a
// clicked slide are the Mac app's own and only checked against this file's reading of them.
import { DatabaseSync } from 'node:sqlite';
import { slideMarks } from './.out/ts-core.mjs';
import { viewRust } from './diff.mjs';

const db = new DatabaseSync(process.argv[2]);
let seed = 3;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted()) : x));
const same = (a, b) => !!a && !!b && a.itemId === b.itemId && a.partIndex === b.partIndex;

function reference(steps, s, action) {
  let { presenting, pointer, picked } = structuredClone(s);
  const find = (x) => (x ? steps.findIndex((t) => same(t, x)) : -1);
  const from = (x, delta) => { const at = find(x); return steps[at === -1 ? (delta > 0 ? 0 : steps.length - 1) : at + delta] ?? null; };
  const step = (delta) => { const n = from(pointer, delta); if (n) pointer = { ...n, black: false }; };
  const pickStep = (delta) => { const n = from(picked ?? (presenting && pointer ? pointer : null), delta); if (n) picked = n; };
  switch (action.type) {
    case 'step': if (presenting) step(action.delta); else pickStep(action.delta); break;
    case 'pick': pickStep(action.delta); break;
    case 'enter': if (presenting) { if (picked) { pointer = { ...picked, black: false }; picked = null; } else step(1); } break;
    case 'black': if (presenting && pointer) pointer = { ...pointer, black: true }; break;
    case 'escape': picked = null; break;
    case 'show': { const t = steps.find((x) => same(x, action)) ?? null; if (presenting) { if (t) { pointer = { ...t, black: false }; picked = null; } } else picked = t; break; }
    case 'start': presenting = true; pointer = picked ?? steps[0] ?? null; pointer = pointer && { ...pointer, black: false }; picked = null; break;
    case 'stop': presenting = false; pointer = null; picked = null; break;
  }
  const order = [...new Map(steps.map((t) => [t.itemId, steps.filter((x) => x.itemId === t.itemId).length]))].map(([itemId, parts]) => ({ itemId, parts }));
  const mark = slideMarks(order, { itemId: pointer?.itemId ?? null, partIndex: pointer?.partIndex ?? 0, black: pointer?.black ?? false });
  const shown = steps.find((t) => mark(t.itemId, t.partIndex) === 'shown');
  const next = steps.find((t) => mark(t.itemId, t.partIndex) === 'next');
  return { presenting, pointer, picked, shown: shown ? `${shown.itemId}/${shown.partIndex}` : null, next: next ? `${next.itemId}/${next.partIndex}` : null };
}

let checked = 0, differ = 0;
for (const { id } of db.prepare('SELECT id FROM presentations WHERE deleted_at IS NULL').all()) {
  const view = await viewRust(db, 'presentationView', { id });
  const steps = view.items.flatMap((i) => i.slides.map((_, partIndex) => ({ itemId: i.id, partIndex })));
  let state = { presenting: false, pointer: null, picked: null };
  for (let n = 0; n < 300; n++) {
    const someSlide = pick([...steps, { itemId: 'gone', partIndex: 0 }]) ?? { itemId: 'gone', partIndex: 0 };
    const action = pick([
      { type: 'step', delta: 1 }, { type: 'step', delta: 1 }, { type: 'step', delta: -1 }, { type: 'pick', delta: 1 }, { type: 'pick', delta: -1 },
      { type: 'enter' }, { type: 'black' }, { type: 'escape' }, { type: 'show', ...someSlide }, { type: 'start' }, { type: 'stop' },
    ]);
    const want = reference(steps, state, action);
    const order = n % 2 ? view.items.map((i) => [i.id, i.slides.length]) : undefined; // half from the shell, half worked out
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
