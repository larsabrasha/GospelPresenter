// Random inputs for themes.ts's 4 mutators: definitions of every field at its edges, keys in any order.
import { H, KNOWN, UNKNOWN } from './seed.mjs';

export function generator(t, step) {
  const { random, pick, maybe, mostly: sometimes, idsOf, opt, fresh } = t;
  const mostly = (good, bad) => sometimes(good, bad, 0.995);
  const shuffle = (o) => Object.fromEntries(Object.entries(o).toSorted(() => random() - 0.5));
  const css = () => mostly(['#ffffff', 'rgba(255, 255, 255, 0.4)', 'RED', 'hsl(0,0%,10%)', 'x'.repeat(60)], ['', 'x'.repeat(61), 'url(x)', '#fff;', 'é']);
  const text = () => shuffle({
    fontSize: mostly([10, 75, 300], [9, 301, 75.5]), fontFamily: mostly(["'Tahoma', 'Geneva', Verdana, sans-serif", 'Inter', 'a_b-c', 'x'.repeat(200)], ['', 'x'.repeat(201), 'Inter;', 'Åland']),
    fontWeight: mostly([100, 400, 900], [99, 901]), lineHeight: mostly([0.8, 1.4, 3, 1.2000000000000002], [0.79, 3.01]), color: css(), align: mostly(['left', 'center', 'right'], ['justify']),
    shadow: mostly([true, false], [1]), uppercase: mostly([true, false], ['false']), outline: mostly([0, 20], [21, 0.5]), outlineColor: css(),
    area: shuffle({ x: mostly([0, 80, 1880], [1881, -1]), y: mostly([0, 1040], [1041]), w: mostly([40, 1760, 1920], [39, 1921]), h: mostly([40, 1080], [1081]) }),
    valign: mostly(['top', 'middle', 'bottom'], ['center']), ...(random() < 0.05 ? { extra: 1 } : {}),
  });
  const hash = () => mostly([...KNOWN, ...UNKNOWN], [H('g'), 'a'.repeat(63)]);
  const image = () => mostly([null, null, { kind: 'builtIn', asset: 'nature/forest-1' }, { kind: 'picture', full: hash(), thumb: hash() }],
    [{ kind: 'builtIn', asset: 'Nature/x' }, { kind: 'builtIn', asset: 'a/b/c' }, { kind: 'url', full: H('a') }, { kind: 'picture', full: H('a') }]);
  const background = () => shuffle({ color: css(), image: image(), fit: mostly(['cover', 'contain'], ['fill']), scrim: mostly([0, 40, 100], [101, 1.5]) });
  const style = () => shuffle({ background: background(), main: text(), credits: text() });
  const definition = () => (random() < 0.99 ? shuffle({ song: style(), bible: style(), media: background() }) : pick([null, {}, { song: style() }]));
  const themes = () => [...idsOf('SELECT id FROM themes'), 'classic', 'light', 'thx'];
  const at = () => sometimes([1000 + step], [1.5, undefined]);
  const q = random();
  if (q < 0.3) return { name: 'createTheme', args: opt({ id: random() < 0.85 ? fresh('th') : pick(themes()), name: sometimes(['Ljust', ' Mitt tema ', 'x'.repeat(100)], ['', 'x'.repeat(101)]), definition: definition(), at: at() }) };
  if (q < 0.6) return { name: 'updateTheme', args: opt({ id: pick(themes()), name: maybe(0.4, () => sometimes(['Nytt'], ['', null])), definition: maybe(0.6, definition), at: at() }) };
  if (q < 0.75) return { name: 'deleteTheme', args: { id: pick(themes()) } };
  if (q < 0.9) return { name: 'setDefaultTheme', args: { themeId: pick([...themes(), '']) } };
  return { name: 'updatePresentation', args: { id: pick(['p1', 'p2', 't1']), themeId: pick([...themes(), null]) } };
}

/** The tenth seed starts at the edge of the themes' limit: 49 of the organisation's own. */
export const seedFor = (s) => (s === 10 ? [`INSERT INTO themes (id, name, definition, sort, updated_at) SELECT 'bulk' || x, 'Tema ' || x, '{}', x, 0 FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 47) SELECT x FROM c)`] : []);
