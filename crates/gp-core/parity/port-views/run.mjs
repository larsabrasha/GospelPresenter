// node port-views/run.mjs demo.sqlite [group …]: every group of port-views/ (each `<group>.mjs` exporting
// `cases(db, tools)`), or those named; the exit code says whether any differed.
import { readdirSync } from 'node:fs';
import { fixture } from '../views/fixture.mjs';
import { compare, rowsOn, rust } from './harness.mjs';
import { rng } from '../mutations/tools.mjs';

const [file, ...named] = process.argv.slice(2);
const db = fixture(file);
// To today's schema (the demo is made by the reference's migration).
rust.runSync('migrateOrgSchema', {}, undefined, rowsOn(db));
const groups = named.length ? named : readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs') && !['harness.mjs', 'run.mjs'].includes(f)).map((f) => f.replace(/\.mjs$/, ''));
let differences = 0;
for (const g of groups) {
  const { cases } = await import(`./${g}.mjs`);
  differences += await compare(g, await cases(db, { random: rng(g.length * 7919) }), db);
}
process.exitCode = differences ? 1 : 0;
