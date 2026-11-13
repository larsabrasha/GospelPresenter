// The native run's final rows against the TS core's, seed by seed.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [fixtures, outDir] = process.argv.slice(2);
const want = JSON.parse(readFileSync(`${fixtures}/parity-final.json`, 'utf8'));
const dump = (db) => JSON.stringify([
  db.prepare('SELECT * FROM presentations ORDER BY id').all(),
  db.prepare('SELECT * FROM presentation_items ORDER BY id').all(),
]);
want.forEach((w, i) => {
  const got = dump(new DatabaseSync(`${outDir}/swift-${i + 1}.sqlite`, { readOnly: true }));
  const rows = JSON.parse(w).reduce((n, t) => n + t.length, 0);
  console.log(`seed ${i + 1}: ${got === w ? 'same rows' : 'DIFFERENT rows'} (${rows} rows)`);
});
