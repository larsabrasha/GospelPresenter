// Random inputs for displays.ts's 3 mutators: outputs made, given a new code, deleted; codes taken and free.
import { TEXTS } from './seed.mjs';

/** Seven letters of the codes' alphabet, at random: almost always free. */
const freeCode = (random) => Array.from({ length: 7 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(random() * 31)]).join('');

export function generator({ random, pick, mostly, idsOf, opt, fresh }) {
  const displays = () => [...idsOf('SELECT id FROM displays'), 'dx'];
  const code = () => (random() < 0.5 ? freeCode(random) : mostly(['abcdefg', 'hjkmnpq', 'zzzzzzz', ...idsOf('SELECT code FROM displays')], ['abcdefi', 'abcdef0', 'ABCDEFG', 'abcdef', 'abcdefgh', '']));
  const q = random();
  if (q < 0.45) return { name: 'createDisplay', args: opt({ id: random() < 0.9 ? fresh('d') : pick(displays()), name: mostly(['Kyrksal', ' Foajé '], TEXTS), code: code(), kind: mostly(['public', 'screen'], ['tv', null]) }) };
  if (q < 0.85) return { name: 'newDisplayCode', args: { id: pick(displays()), code: code() } };
  return { name: 'deleteDisplay', args: { id: pick(displays()) } };
}

/** The tenth seed starts at the edge of the outputs' limit: 49. */
export const seedFor = (s) => (s === 10 ? [`INSERT INTO displays (id, name, code, kind, created_at) SELECT 'bulk' || x, 'Utgång ' || x, printf('k%06d', x), 'screen', 0 FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 47) SELECT x FROM c)`] : []);
