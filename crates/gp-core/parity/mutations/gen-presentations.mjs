// Random inputs for presentations.ts's 16 mutators, the edges among them.
import { TEXTS } from './seed.mjs';

export function presentations({ random, pick, maybe, idsOf, opt, fresh }) {
  const pres = () => [...idsOf('SELECT id FROM presentations'), 'px'];
  const items = () => [...idsOf('SELECT id FROM presentation_items'), 'ix'];
  const newId = (p) => pick([fresh(p), fresh(p), fresh(p), 'x'.repeat(100), 'x'.repeat(101), '🎵'.repeat(51), '', ...items().slice(0, 2)]);
  const someItem = () => pick([...items(), null]);
  const event = () => ({
    eventDate: maybe(0.3, () => pick(['2026-12-24', '2026-02-30', '2024-02-29', '1900-02-29', '2026-13-01', '２０２６-11-15', null, ''])),
    time: maybe(0.3, () => pick(['18:30', '23:59', '24:00', '9:00', null])),
    location: maybe(0.3, () => pick(['Kapellet', '  ', null, 'x'.repeat(100), 'x'.repeat(101)])),
    description: maybe(0.3, () => pick(['• Välkommen\n• Sång', '', null, 'x'.repeat(5001)])),
  });
  const text = () => pick(['Ty så älskade Gud världen', '', '  dubbla  mellanslag ', 'ord '.repeat(80), '🎵 '.repeat(130), 'x'.repeat(10_000), 'é\u00a0nbsp', 'kort']);
  const bad = () => pick([{ b: 'XYZ' }, { b: 'jhn' }, { b: 'JHNX' }, { b: 7 }, { c: 1000 }, { c: -1 }, { c: 1.5 }, { v: '3' }, { v: 1000 }, { t: 'x'.repeat(10_001) }, { t: null }]);
  const verses = () => {
    const n = pick([1, 1, 2, 3, 8, 30, 120, 500, 0, 501]);
    const book = pick(['JHN', 'ACT', 'GEN', '1CO', 'ABC']);
    let c = pick([3, 21, 0, 999]), v = pick([1, 16, 24, 999]);
    const list = Array.from({ length: n }, () => {
      if (v > 30) { c++; v = 1; }
      return { b: random() < 0.97 ? book : pick(['ACT', 'REV']), c, v: v++, t: text() };
    });
    if (list.length && random() < 0.15) Object.assign(list[Math.floor(random() * list.length)], bad());
    return list;
  };
  const q = random();
  if (q < 0.08) return { name: 'createPresentation', args: opt({ id: newId('np'), name: pick(TEXTS), ...event() }) };
  if (q < 0.15) return { name: 'renamePresentation', args: opt({ id: pick(pres()), name: maybe(0.95, () => pick(TEXTS)) }) };
  if (q < 0.22) {
    return { name: 'updatePresentation', args: opt({ id: pick(pres()), name: maybe(0.4, () => pick(TEXTS)), ...event(), themeId: maybe(0.25, () => pick(['classic', 'light', 'th1', 'tx', null, ''])) }) };
  }
  if (q < 0.32) {
    return { name: 'addSongToPresentation', args: opt({ itemId: newId('i'), presentationId: pick(pres()), songId: pick(['s1', 's2', 's3', 's4', 'sx']), arrangementId: maybe(0.5, () => pick(['a1', 'a2', 'a3', 'ax', null])), afterItemId: maybe(0.5, someItem) }) };
  }
  if (q < 0.42) {
    return {
      name: 'addBibleToPresentation',
      args: opt({ itemId: random() < 0.7 ? fresh('b') : newId('b'), presentationId: pick(pres()), bibleId: pick(['bible:sfb', 'bible:sfb', 'bible:x', '']), translation: maybe(0.97, () => pick(['SFB', 'SFB', '  B2000 ', 'x'.repeat(50), 'é🎵'.repeat(25), '', 'x'.repeat(51)])), verses: maybe(0.97, verses), afterItemId: maybe(0.4, someItem) }),
    };
  }
  if (q < 0.48) return { name: 'addHeaderToPresentation', args: opt({ itemId: newId('h'), presentationId: pick(pres()), title: pick(TEXTS), afterItemId: maybe(0.4, someItem), beforeItemId: maybe(0.4, someItem) }) };
  if (q < 0.53) return { name: 'renameItem', args: opt({ itemId: pick(items()), title: maybe(0.95, () => pick(TEXTS)) }) };
  if (q < 0.58) return { name: 'setItemNote', args: opt({ itemId: pick(items()), note: maybe(0.9, () => pick(['Ta det lugnt', '  ', '', null, 'x'.repeat(201), 'x'.repeat(200)])) }) };
  if (q < 0.63) return { name: 'setItemArrangement', args: opt({ itemId: pick(items()), arrangementId: maybe(0.95, () => pick(['a1', 'a2', 'a3', 'ax', null])) }) };
  if (q < 0.7) return { name: 'setItemOverlay', args: opt({ itemId: pick(items()), overlayId: maybe(0.95, () => pick(['o1', 'o2', 'ox', null, ''])) }) };
  if (q < 0.77) return { name: 'moveItem', args: { itemId: pick(items()), by: pick([-1, 1, -3, 5, 0, 1000, 1001, -1000, 1.5, '2', null]) } };
  if (q < 0.81) {
    const its = items().toSorted(() => random() - 0.5).slice(0, Math.floor(random() * 8));
    return { name: 'reorderItems', args: { presentationId: pick(pres()), itemIds: random() < 0.05 ? Array(1001).fill('i1') : [...its, ...(random() < 0.3 ? [its[0] ?? 'ix', 'ix'] : [])] } };
  }
  if (q < 0.86) return { name: 'removeItem', args: { itemId: pick(items()) } };
  if (q < 0.97) {
    const name = pick(['trashPresentation', 'trashPresentation', 'restorePresentation', 'purgePresentation', 'purgePresentation']);
    return { name, args: opt({ id: pick(pres()), at: name === 'trashPresentation' ? pick([1000, 2000, 1.5, 2 ** 53, -5, undefined]) : undefined }) };
  }
  return { name: pick(['renamePresentation', 'addBibleToPresentation', 'setItemOverlay']), args: pick([null, [], 'x', 7, {}, { itemId: 7 }]) };
}
