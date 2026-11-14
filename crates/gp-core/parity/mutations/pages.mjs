// Random slideshow pages for the checks of custom-slides.ts and overlays.ts: every kind of element, the edges of each
// field, keys in any order and keys the schema does not know (zod drops them), numbers JSON writes oddly.
import { H, KNOWN, UNKNOWN } from './seed.mjs';

const NUMBERS = [0, 1, 0.1, 0.30000000000000004, 1e-7, 123.456, -3840, 5760, -2160, 3240, 1920.5, -0.5, 1 / 3];
const BAD_NUMBERS = [-3841, 5761, '1', null, 1e21];

export function pageMaker({ random, pick, mostly: sometimes }) {
  /** Each field is wrong rarely, so that a page of many fields is still right now and then. */
  const mostly = (good, bad, p = 0.985) => sometimes(good, bad, p);
  const hash = () => mostly([...KNOWN, ...KNOWN, ...UNKNOWN], ['A'.repeat(64), 'a'.repeat(63), H('g')]);
  const picture = () => (random() < 0.97 ? { full: hash(), thumb: hash() } : pick([null, { full: hash() }, 'x']));
  const color = () => mostly(['#ffffff', '#ABCDEF', '#000000', null], ['#fff', 'red', '#abcdeg', '#abcdef\n']);
  const shuffle = (o) => Object.fromEntries(Object.entries(o).toSorted(() => random() - 0.5));
  const element = () => {
    const box = { id: mostly(['e1', 'e2', 'x'.repeat(40), 'é🎵'.repeat(20)], ['', 'x'.repeat(41), 7]), x: mostly(NUMBERS, BAD_NUMBERS), y: mostly(NUMBERS, [3241, -2161]), w: mostly(NUMBERS, BAD_NUMBERS), h: mostly(NUMBERS, [3241]) };
    const kind = mostly(['text', 'text', 'image', 'rect', 'ellipse', 'line'], ['circle', undefined, 'TEXT']);
    const extra = random() < 0.1 ? { unknown: 1, fill: '#123456' } : {};
    if (kind === 'text') {
      return shuffle({ ...extra, ...box, kind, text: mostly(['Välkommen', '', ' rad\nrad ', '🎵'.repeat(2000)], ['x'.repeat(2001), 7]), size: mostly([10, 75, 400], [9, 401, 75.5]),
        bold: mostly([true, false], ['true']), italic: mostly([true, false], [0]), align: mostly(['left', 'center', 'right'], ['justify']), color: color() });
    }
    if (kind === 'image') return shuffle({ ...extra, ...box, kind, picture: picture(), fit: mostly(['contain', 'cover'], ['fill']) });
    if (kind === 'line') return shuffle({ ...extra, ...box, kind, stroke: color(), strokeWidth: mostly([1, 2.5, 100], [0, 101]) });
    return shuffle({ ...extra, ...box, kind, fill: color(), stroke: color(), strokeWidth: mostly([0, 1, 100], [-1, 101]), radius: mostly([0, 12.5, 540], [541, -1]) });
  };
  const page = () => {
    const p = { background: color(), backgroundPicture: random() < 0.6 ? null : picture(), backgroundPage: random() < 0.7 ? null : picture(), elements: Array.from({ length: mostly([0, 1, 2, 3, 5], [101], 0.99) }, element) };
    if (random() < 0.03) delete p[pick(Object.keys(p))];
    if (random() < 0.05) p.backgroundImageId = 'img1';
    return shuffle(p);
  };
  const pages = () => Array.from({ length: random() < 0.01 ? 100 : mostly([1, 1, 2, 3], [0, 101], 0.98) }, page);
  return { page, pages, picture, hash };
}
