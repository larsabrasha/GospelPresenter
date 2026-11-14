// node parity/mutations/run.mjs [file …] [--ops N] [--seeds N]: the differential check of each named file of
// packages/core/src/mutators (all of them when none is named), N seeds of ops mutations each.
import { prove, report } from './harness.mjs';
import { SEED } from './seed.mjs';
import { presentations } from './gen-presentations.mjs';

const generators = { presentations };

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : Number(argv.splice(i, 2)[1]); };
const ops = flag('--ops', 3000), seeds = flag('--seeds', 10);
const files = argv.length ? argv : Object.keys(generators);

let ok = true;
for (const file of files) {
  if (!generators[file]) throw new Error(`no generator for ${file}`);
  const t = performance.now();
  ok = report(file, await prove(file, { seed: SEED, generator: generators[file], ops, seeds })) && ok;
  console.log(`  ${((performance.now() - t) / 1000).toFixed(1)} s`);
}
process.exitCode = ok ? 0 : 1;
