// The Rust core in workerd, as the Worker would run it: the TS core's random mutations (export.mjs's fixture) sent
// through a SQLite Durable Object, each seed its own organisation; every outcome and the final rows compared.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { SEED_SQL } from './seed-sql.mjs';

const here = new URL('.', import.meta.url).pathname;
const [root, fixtures] = process.argv.slice(2);
const server = createRequire(join(root, 'apps/server/package.json'));
const { build } = server('esbuild');
const { Miniflare } = server('miniflare');

const out = join(here, '.out/worker.js');
await build({
  entryPoints: [join(here, 'workerd/worker.js')],
  bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile: out, logLevel: 'warning',
  external: ['cloudflare:workers', './gp_core.wasm'],
  alias: { 'gp-org-schema': join(root, 'packages/core/src/org-schema.ts') },
});
const mf = new Miniflare({
  modules: [
    { type: 'ESModule', path: out, contents: readFileSync(out, 'utf8') },
    { type: 'CompiledWasm', path: join(here, '.out/gp_core.wasm'), contents: readFileSync(join(here, '.out/gp_core.wasm')) },
  ],
  compatibilityDate: '2026-08-01',
  durableObjects: { ORG: { className: 'Org', useSQLite: true } },
});
const call = async (org, path, body) =>
  (await mf.dispatchFetch(`http://x${path}?org=${org}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();

const lines = readFileSync(join(fixtures, 'parity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const finals = JSON.parse(readFileSync(join(fixtures, 'parity-final.json'), 'utf8'));
let differ = 0, ms = 0;
for (const seed of new Set(lines.map((l) => l.seed))) {
  const run = lines.filter((l) => l.seed === seed);
  await call(seed, '/setup', SEED_SQL);
  for (let i = 0; i < run.length; i += 500) {
    const chunk = run.slice(i, i + 500);
    const answer = await call(seed, '/run', chunk.map((l) => l.input));
    ms += answer.ms;
    answer.outcomes.forEach((got, k) => {
      if (got !== chunk[k].outcome && ++differ < 4) console.log(`DIFF seed ${seed}: TS ${chunk[k].outcome}, workerd ${got}: ${JSON.stringify(chunk[k].input).slice(0, 160)}`);
    });
  }
  const rows = JSON.stringify(await call(seed, '/dump'));
  console.log(`seed ${seed}: ${rows === finals[seed - 1] ? 'same rows' : 'DIFFERENT rows'}`);
}
console.log(`workerd: ${lines.length} mutations, ${differ} different outcomes, ${(ms * 1000 / lines.length).toFixed(0)} µs each inside the Durable Object`);
await mf.dispose();
