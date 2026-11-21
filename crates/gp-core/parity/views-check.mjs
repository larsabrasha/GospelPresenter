// The Rust core's views against what the web works out today, page by page (docs/rust-core.md, 2.5 step 3): on the
// demo data (demo.sqlite), the same input through both, the JSON compared. One module a page in views/.
//   node parity/views-check.mjs <demo.sqlite>
import { DatabaseSync } from 'node:sqlite';
import presentation from './views/presentation.mjs';
import presentationPage from './views/presentation-page.mjs';
import live from './views/live.mjs';
import songs from './views/songs.mjs';
import songPage from './views/song-page.mjs';
import media from './views/media.mjs';
import lists from './views/lists.mjs';
import settings from './views/settings.mjs';
import bible from './views/bible.mjs';
import bibleRefs from './views/bible-refs.mjs';
import highlight from './views/highlight.mjs';
import pageModels from './views/page-models.mjs';
import liveState from './views/live-state.mjs';
import proPresenter from './views/propresenter.mjs';
import bibleImport from './views/bible-import.mjs';
import legacy from './views/legacy.mjs';
import songImport from './views/song-import.mjs';
import collation from './views/collation.mjs';
import wantedMedia from './views/wanted-media.mjs';
import mediaPlan from './views/media-plan.mjs';
import bibleTexts from './views/bible-texts.mjs';

const db = new DatabaseSync(process.argv[2]);
let failed = 0;
// GP_VIEWS=bibleImport,proPresenter runs only those checks, while one is being written.
const only = process.env.GP_VIEWS?.split(',');
const checks = { presentation, presentationPage, live, songs, songPage, media, lists, settings, bible, bibleRefs, highlight, pageModels, liveState, proPresenter, bibleImport, legacy, songImport, collation, wantedMedia, mediaPlan, bibleTexts };
for (const [page, check] of Object.entries(checks).filter(([name]) => !only || only.includes(name))) {
  // Each check is given the database, and its file for a check that adds rows to a copy of it.
  const { compared, differ, notes } = await check(db, process.argv[2]);
  failed += differ.length;
  console.log(`views ${page}: ${notes.join(', ')}; ${compared} compared, ${differ.length} different`);
  for (const d of differ.slice(0, 3)) console.log(`  DIFF ${d}`);
}
process.exitCode = failed ? 1 : 0;
