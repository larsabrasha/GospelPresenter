// Writes the app's seed database, and the parity fixture: random mutations with the TS core's outcomes and final rows.
import { writeFileSync, rmSync } from 'node:fs';
import { openDb, runTs, generator, rng, dump } from './diff.mjs';

const out = process.argv[2];
const OPS = Number(process.argv[3] ?? 3000), SEEDS = Number(process.argv[4] ?? 5);

rmSync(`${out}/seed.sqlite`, { force: true });
const seed = openDb();
seed.exec(`VACUUM INTO '${out}/seed.sqlite'`);

const lines = [];
const finals = [];
for (let s = 1; s <= SEEDS; s++) {
  const db = openDb();
  const next = generator(rng(s), db);
  for (let step = 0; step < OPS; step++) {
    const input = next(step);
    const outcome = await runTs(db, structuredClone(input));
    lines.push(JSON.stringify({ seed: s, input, outcome }));
  }
  finals.push(dump(db));
}
writeFileSync(`${out}/parity.jsonl`, lines.join('\n') + '\n');
writeFileSync(`${out}/parity-final.json`, JSON.stringify(finals));
console.log(`seed.sqlite, and ${lines.length} mutations over ${SEEDS} seeds`);
