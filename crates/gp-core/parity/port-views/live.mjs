// The live state's reducers and a page's menus and dialog (views/live.ts): liveChangeView, followItemOverlayView,
// addPositionView, presentationActionsView, itemActionsView, detailsDialogView; random and malformed arguments.
export function cases(db, { random }) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const maybe = (p, f) => (random() < p ? f() : undefined);
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const ids = ['i1', 'i2', 'i3', '', null, 7];
  const out = [];
  const pointer = () => strip({ presentationId: maybe(0.9, () => pick(['p1', 'p2', '', null])), itemId: maybe(0.9, () => pick(ids)), partIndex: maybe(0.8, () => pick([0, 1, 2, null])),
    black: maybe(0.8, () => pick([true, false, null, 'yes'])), overlayId: maybe(0.8, () => pick(['o1', 'o2', '', null])), rev: maybe(0.8, () => pick([0, 3, 2.5, '4', null])) });
  const overlays = () => maybe(0.9, () => Object.fromEntries(['i1', 'i2', 'i3'].filter(() => random() < 0.7).map((i) => [i, pick(['o1', 'o2', null, ''])])));
  for (let n = 0; n < 4000; n++) {
    out.push({ name: 'liveChangeView', pure: true, args: random() < 0.02 ? pick([{}, { pointer: 1, change: {} }, { pointer: {} }]) : strip({ pointer: pointer(), change: pointer(), overlays: overlays() }) });
    out.push({ name: 'followItemOverlayView', pure: true, args: random() < 0.02 ? {} : strip({ pointer: pointer(), before: maybe(0.8, () => pick(['o1', 'o2', null, ''])), after: maybe(0.8, () => pick(['o1', 'o2', null, ''])) }) });
  }
  const order = () => ['a', 'b', 'c', 'd'].filter(() => random() < 0.8);
  for (let n = 0; n < 2000; n++) {
    const args = strip({ order: random() < 0.03 ? pick([['a', 1], 'a', null]) : order(), shownId: maybe(0.6, () => pick(['a', 'b', 'c', 'd', 'x', ''])), lastAddedId: maybe(0.6, () => pick(['a', 'b', 'c', 'x', ''])),
      chosenId: maybe(0.3, () => pick(['a', 'c', 'x', ''])), selectedId: maybe(0.6, () => pick(['a', 'b', 'd', 'x', ''])) });
    out.push({ name: 'addPositionView', pure: true, args });
  }
  for (const isTemplate of [true, false, 'x', undefined]) for (const presenting of [true, false, undefined]) for (const role of ['user', 'admin', 'superAdmin', 'guest', undefined, 3])
    out.push({ name: 'presentationActionsView', pure: true, args: strip({ isTemplate, presenting, role }) });
  for (let n = 0; n < 3000; n++) {
    const item = random() < 0.02 ? pick([null, 'x', {}]) : strip({ id: maybe(0.97, () => pick(['i1', 'i2'])), type: maybe(0.9, () => pick(['song', 'bible', 'header', 'custom', 'image', 'audio', 'video', 'x'])),
      arrangementId: maybe(0.5, () => pick(['a1', 'a2', 'original', null, 3])), overlayId: maybe(0.5, () => pick(['o1', null, 3, ''])) });
    out.push({ name: 'itemActionsView', pure: true, args: strip({ item, song: maybe(0.8, () => pick([{ id: 's', deletedAt: null }, { id: 's', deletedAt: 5 }, { id: 's' }, null, 'x'])),
      arrangements: maybe(0.8, () => pick([[], [{ id: 'a1', name: 'Kort' }, { id: 'a2', name: null }], [{ id: 'a1' }], ['x'], 'x'])),
      overlays: maybe(0.8, () => pick([[], [{ id: 'o1', title: 'Kollekt' }, { id: 'o2' }], [3], null])), shownId: maybe(0.5, () => pick(['i1', 'i2', '', null])) }) });
  }
  for (const isNew of [true, false, 'x', undefined]) out.push({ name: 'detailsDialogView', pure: true, args: strip({ isNew }) });
  return out;
}
