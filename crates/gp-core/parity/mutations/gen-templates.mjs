// Random inputs for templates.ts's 7 mutators, with some of presentations.ts's between them so the items change.
import { generator as presentations } from './gen-presentations.mjs';
import { TEXTS } from './seed.mjs';

export function generator(t, step) {
  const { random, pick, maybe, mostly, idsOf, opt, fresh } = t;
  if (random() < 0.2) return presentations(t, step);
  const templates = () => [...idsOf('SELECT id FROM presentations WHERE is_template = 1'), 'tx'];
  const any = () => [...idsOf('SELECT id FROM presentations'), 'px'];
  const newId = () => (random() < 0.9 ? fresh('t') : pick([...any(), '', 'x'.repeat(101)]));
  const slot = () => ({
    weekday: maybe(0.4, () => mostly([0, 3, 6, null], [7, -1, 1.5, '0'])),
    time: maybe(0.4, () => mostly(['10:00', '18:30', null], ['24:00', '9:00', ''])),
    location: maybe(0.4, () => mostly(['Kyrkan', '  ', null, 'x'.repeat(100)], ['x'.repeat(101)])),
  });
  /** The items of `from` to copy, each with its copy's id: some left out, a repeat, a stranger, a taken id now and then. */
  const items = (from) => {
    const ids = idsOf(`SELECT id FROM presentation_items WHERE presentation_id = '${from}'`).filter(() => random() < 0.8);
    const list = ids.map((x) => ({ from: x, id: random() < 0.97 ? fresh('c') : pick(idsOf('SELECT id FROM presentation_items')) }));
    if (random() < 0.1) list.push({ from: 'ix', id: fresh('c') });
    if (random() < 0.05 && list.length) list.push({ from: list[0].from, id: fresh('c') });
    return random() < 0.02 ? Array.from({ length: 101 }, (_, i) => ({ from: `f${i}`, id: `c${i}` })) : list;
  };
  const q = random();
  if (q < 0.15) return { name: 'createTemplate', args: opt({ id: newId(), name: mostly(['Söndag', ' Mall '], TEXTS), ...slot() }) };
  if (q < 0.3) return { name: 'updateTemplate', args: opt({ id: pick([...templates(), 'p1']), name: maybe(0.4, () => mostly(['Ny', 'Mall'], TEXTS)), ...slot() }) };
  if (q < 0.45) {
    const from = pick(any());
    return { name: 'saveAsTemplate', args: opt({ id: newId(), presentationId: from, name: mostly(['Mall av söndag'], TEXTS), items: maybe(0.97, () => items(from)) }) };
  }
  if (q < 0.7) {
    const from = random() < 0.85 ? pick(templates()) : pick(any());
    return {
      name: 'createFromTemplate',
      args: opt({
        id: newId(), templateId: from, name: mostly(['Söndag 24/11'], TEXTS),
        eventDate: maybe(0.4, () => mostly(['2026-11-24', null], ['2026-02-30', ''])), time: maybe(0.3, () => mostly(['11:00'], ['25:00'])),
        location: maybe(0.3, () => mostly(['Kapellet', null], ['x'.repeat(101)])), description: maybe(0.3, () => mostly(['Fika', '', null], ['x'.repeat(5001)])),
        items: items(from), at: mostly([1000, 2000 + step], [1.5, undefined]),
      }),
    };
  }
  const name = pick(['trashTemplate', 'trashTemplate', 'restoreTemplate', 'purgeTemplate', 'purgeTemplate']);
  return { name, args: opt({ id: pick([...templates(), 'p1', 'p4']), at: name === 'trashTemplate' ? mostly([1000, 3000], [1.5, -5, undefined]) : undefined }) };
}
