// The Rust core's views against what the web works out today, page by page (docs/rust-core.md, 2.5 step 3): on the
// demo data (demo.sqlite), the same input through both, the JSON compared. One module a page in views/.
//   node parity/views-check.mjs <demo.sqlite>
import { DatabaseSync } from 'node:sqlite';
import presentation from './views/presentation.mjs';
import presentationPage from './views/presentation-page.mjs';
import live from './views/live.mjs';
import songs from './views/songs.mjs';

const db = new DatabaseSync(process.argv[2]);
let failed = 0;
for (const [page, check] of Object.entries({ presentation, presentationPage, live, songs })) {
  // Each check is given the database, and its file for a check that adds rows to a copy of it.
  const { compared, differ, notes } = await check(db, process.argv[2]);
  failed += differ.length;
  console.log(`views ${page}: ${notes.join(', ')}; ${compared} compared, ${differ.length} different`);
  for (const d of differ.slice(0, 3)) console.log(`  DIFF ${d}`);
}
process.exitCode = failed ? 1 : 0;
