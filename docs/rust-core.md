# The Rust core

2.0 runs on it (Lars, 2026-11-17: 2.0 was not released yet, so the Rust core became 2.0's rather than waiting for a
2.5). Lars, 2026-11-13: the app is made again on one core in Rust, under the web (the React UI kept, the core as
WASM), the server (WASM in the Worker and in Node) and later native apps; MCP and a CLI come later on the same core.
It was done in a loop, function by function and view by view, each proved against the TypeScript app as it was
before (the reference). How the core is built and checked: `crates/gp-core/README.md`. What 2.0 gains from here is
written in the core first.

## The core swapped, nothing else

Lars, 2026-11-14, planned as a 2.5 after a 2.0 on the TypeScript core: the same app, the same React UI on the web, in
Electron and in Capacitor, with the Rust core as WASM under all of it instead of the TS core; no new features in the
swap, behaviour as before, proved by the differential checks and the whole e2e suite. Made on `claude/rust-core` and
taken into 2.0's branch on 2026-11-17. Done:

1. every mutator switched on the client and the server (`runMutation` in `packages/rust-core`): done;
2. sync's client logic in the core: done;
3. the views in the core, the React pages reading slides and lists from it: done;
4. the TS core out of the app; the reference kept at 238d481b for the checks; and a Bible's text read through a view
   of the core, a chapter at a time (Lars, 2026-11-17). The export waits for the imports: it is a format, the core's,
   while the zip and the files' bytes stay the shell's. Done, 2026-11-17: what `packages/core` keeps is what the shells
   still need (the tables' types and `tableInfo`, the server's sync SQL, `MUTATOR_VERSIONS` and the arguments' types,
   `MutationError`, limits and settings keys, song search's `highlight`, and `slides.ts` for the song and Bible tabs'
   previews); the checks unpack the reference's `packages/core` and `packages/sync` from 238d481b with `git archive`
   and stop if it lacks the TS mutators.

### Step 2: sync's client logic

Today `SyncClient` (`packages/sync/src/client/client.ts`): a change runs at once on the device and is queued in
`_mutation`, in one transaction; `push` sends the queue; `pull` fetches the server's changes page by page from a
cookie; `rebase`, in one transaction, undoes every change of the device's the server has not confirmed (the undo log
of `packages/core/src/sync-sql.ts`'s triggers), applies the server's, drops what the server has taken and replays the
rest on top.

Into the core: what decides what the database holds — the queue, the rebase, the triggers — as commands such as "run
and queue a change", "the queue to send" and "here are the server's pages: rebase". In the shell: the network, the
socket that says something is new, when and how often to sync, retries, and sign-in and the server's refusals
("update required", credentials gone). The server's sync engine (`packages/sync/src/server/engine.ts`) stays
TypeScript: it already runs the mutators through the core, and the rest of it is the server's own.

Small, and the riskiest step: a wrong rebase loses or doubles a church's changes. Proved by a differential check of
its own: the same random mix of local changes, server pages and refusals through both clients on two databases,
the tables and the queue compared after every step; then the server's tests, which run two devices against a server
on every adapter, and the e2e specs of sync and offline. After it a native app syncs by the web's rules exactly.

### Step 3: the views

What a page shows, worked out: today the web's own SQL (`apps/web/src/db/queries.ts`, 34 queries) and reckonings in
React components; the slides (`readItemSlides`) are in Rust and proved already. Page by page: the presentation and
presenting first, then the songs list and the song editor (parts, arrangements, labels, history), then the Bibles,
pictures, sounds, videos, custom slides, templates, themes, overlays, outputs, the CCLI report, the trash and the
settings. Each view is a call to the core in the database worker; React gets finished JSON instead of running SQL.
A page is read again when a table it reads changes, as now: each view names the tables it reads.

Proved view by view: the old TS query and the new Rust view on the same database give identical JSON (as the slides
are checked), and every e2e spec that reaches the page passes unchanged. Large and harmless: a view cannot spoil data,
only show it wrongly, which the comparison catches. Long lists (3 000 songs) are measured, so that copying JSON over
the bridge does not make them slower; search is in the core already. After it the native apps, MCP and the CLI read
the web's lists, and React holds no SQL. It can run beside step 2: they touch different files.

What comes next is written in Rust first, planning among it (`docs/planning.md`). Native UIs on the same core come
later: the Mac and iOS app (`claude/rust-core-ios-ab7733`, a working prototype over the core) waits until then, not
merged.

### Before 2.0 goes out, and after

Weighed with Lars, 2026-11-16, in order of risk:

1. **Where churches run it.** The e2e specs in WebKit as well as Chromium, real Safari, iOS through Capacitor and a
   packaged app; then one or two churches on a beta for a few Sundays before 2.0 goes out widely. The rebase is proved
   against the TS client, not yet against real networks and real people: the largest risk left.
2. **The web's storage.** The web is held back by OPFS, not by the core. WAL with `locking_mode=EXCLUSIVE` measured 8
   times faster in Chromium (98 against 801 µs a mutation) and almost 3 in WebKit (59 against 165); TRUNCATE and
   PERSIST give disk I/O errors with the VFS. It needs one connection to write, which fits, as the output window reads
   through the operator window's database; check first that nothing else opens it. The views are measured with 3 000
   songs before step 3 counts as done.
3. **Checks once the reference is gone.** When the TS core leaves the app (step 4), a new feature has nothing to be
   compared with. The random checks stay, but check properties instead of sameness: no change lost or doubled by a
   rebase, client and server ending on the same rows, every refused change undone.
4. **UniFFI for the native shells.** When the native apps come, the core's interface is generated by UniFFI (Mozilla's,
   below) instead of the hand-written C interface with JSON: Swift and Kotlin types made from the Rust ones, so no
   shell parses JSON by hand. The web keeps JSON over WASM.

## What else was weighed

Lars, 2026-11-14 to 16. What we need at once: offline, and through the church's own computer without the internet; a
server on Cloudflare; permissions decided by the server; the same rules on the web and in native apps. Nothing found
does all of it better; each below does a part.

- **Mozilla** does what we do: the shared parts of Firefox for Android and iOS (sync, logins, history) are Rust
  components (application-services), bound to Kotlin and Swift by UniFFI, under native UIs; desktop Firefox is web
  technology over its engine. Windows and Linux follow that here: the web's UI in Electron to begin with.
- **1Password** has one Rust core under native apps and its web; **Figma** runs its core as WASM in the browser.
- **Crux** (Red Badger) is a framework for this very pattern: a Rust core, effects done by Swift, Kotlin and web
  shells. The core follows it without using it; its type generation is worth a look with UniFFI.
- **Sync engines** (Zero, ElectricSQL, PowerSync) do sync for you, but want a server of their own, most with Postgres,
  and fit badly with Durable Objects and the church's own computer. PowerSync's core is also Rust in SQLite on every
  platform: the same idea as ours.
- **CRDTs** (Automerge, Loro, Yjs) merge concurrent changes without a server: better when many write the same text at
  once, which a church seldom does, and they make permissions harder. The server deciding and the client replaying
  its changes on top (Replicache's and Linear's model) is simpler and fits.
- **The TS core kept, under native UIs**: in JavaScriptCore under SwiftUI on the Mac and iOS, in Hermes or QuickJS on
  Android. Nothing to prove, being the same code, and cheaper; but slower, harder to debug from native, and the core
  stays in a language the native platforms do not speak. The one real alternative to the rewrite, not a better one.

Not searched again for news: what is above is as known by mid-2026.

## The reference

The TypeScript app at commit 238d481b on `claude/replace-csharp-with-rewrite` (Lars, 2026-11-13). It is 50f53f37,
the app before this work, with presenting's keys and the running order's slides moved into `packages/core`
(`presentingKey`, `slideMarks`, `readItemSlides`), behaviour kept and proved by the e2e specs that reach them: a
contract the Rust core is checked against call for call, not a reading of React code. It is not changed while the
core is made. The checks bundle its `packages/core` from a checkout of that commit, so a TS function removed from the
app on this branch is still there to compare with:

```sh
git worktree add ../gp-reference 238d481b
GP_REPO=$PWD/../gp-reference crates/gp-core/build.sh test
```

## Where the core runs

- **The web**: the React UI as it is; the client's database worker (`apps/web/src/db/worker.ts`) loads the core's
  WASM and answers its SQL from wa-sqlite.
- **The server**: the Worker loads the same WASM and answers from the organisation's Durable Object SQLite, whose
  `sql.exec` is synchronous; the Node host answers from node:sqlite or better-sqlite3. Client and server run the
  same mutators, so the server moves with the client, group by group, never after it.
- **Windows and Linux**: the desktop app as it is (Electron), its React UI over the core as WASM in the database
  worker, as the web; a native UI there may come later (Lars, 2026-11-13: web technology there to begin with, as
  Mozilla's desktop Firefox; Tauri, the core native under the system's web view, not before the core is done).
- **The Mac and iOS**: the core as a static library under SwiftUI, one UI for both where it can be (`apps/mac`).
- **Android**: the core under Jetpack Compose, through the same C interface.
- **MCP and a CLI**: later, through the same interface.

## The core's interface

What every shell calls, and later MCP and the CLI; kept stable, and versioned when it changes:

- a **command** (a mutator): name, arguments and the caller's role in; `ok` or a refusal's code out;
- a **view**: name and arguments in; what a page shows out, as JSON (the slides, a list, a search's hits);
- **presenting**: a reducer, what is shown and the key pressed in, what is shown next out;
- **SQL as effects**: the core never opens a database; it asks its shell for each query and waits for the rows.

In the core: the schema and its migrations, the mutators and their argument checks, permissions, the views, song
search, presenting, sync's own logic (the pending changes and their rebase), and the import and export formats.
In the shells: drawing, the network, sign-in and sessions, the bytes of pictures, sound and video, and the desktop
host.

## The loop

For each function or view, in the order below:

1. **Port** it to the core.
2. **Prove** it against the reference. A function: the same inputs through both, random ones with the edges among
   them (invalid arguments, other roles, rows gone, Unicode), the outcomes and the database rows compared after
   every step (`crates/gp-core/parity/diff.mjs` is the pattern). A view: the web's e2e specs that reach it, run on
   the core; on the Mac, a picture beside the web's, the same content in about the same place.
3. **Switch** the web and the server to the core for it, and remove the TypeScript one from the app;
   `pnpm typecheck && pnpm lint && pnpm test`, the e2e specs it reaches, and `crates/gp-core/build.sh test` pass.
4. **Commit**, and mark it in the table below.

A difference the check finds is the core's to fix, unless the reference is wrong; then Lars decides.

## In order

0. The core in workerd and in the web's worker, proved there before anything is switched.
1. The schema and its migrations, which both ends need alike.
2. The mutators, a file at a time, client and server together.
3. Sync's client logic.
4. The views, page by page (`apps/web/src/pages`), the presentation and presenting first.
5. The imports: the 1.x zip, ProPresenter, Bibles.
6. The Mac app's pages, after the web's, and iOS beside them in the same SwiftUI.

The platforms in order (Lars, 2026-11-13): the web, the Mac and iOS first. Windows and Linux follow the web in the
desktop app without work of their own; Android comes after them.

## Where it stands

The mutators by file of `packages/core/src/mutators`; ported and proved means in the core and through the checks,
switched means the app runs the core's.

| Part | Ported and proved | Switched |
| --- | --- | --- |
| The core in workerd (a SQLite Durable Object, `parity/workerd-check.mjs`) | proved: 15 000 mutations, the same outcomes and rows | — |
| The core in a browser: a Web Worker over wa-sqlite, in memory and on OPFS (`parity/browser-check.mjs`), in Chromium and WebKit (Safari's engine, not Safari or iOS themselves) | proved: 15 000 mutations, the same outcomes and rows; as fast as the TS core, OPFS the cost of both | — |
| Schema and migrations, and the default labels (`crates/gp-core/src/schema.rs`; the commands `migrateOrgSchema` and `seedLabels`, each in the shell's one transaction) | proved (`crates/gp-core/parity/mutations/schema-check.mjs`): a new database, one of every version 11 to 26 with rows the data migrations change, and the three the migration refuses; the same `sqlite_master` and rows. A refused database is left as it was, where the TS migration leaves an empty `_schema` table on it | switched: the client's start, the Node host and the Durable Object open a database through the core |
| The mutators, every file but probe (`crates/gp-core/src/mutators/`, one module a file, each with its own dispatcher; arguments as zod checks them, permissions as `permissions.ts`'s, JSON stored as `JSON.stringify` writes it) | proved, each file alone: 30 000 random mutations through both cores, every table compared after each step, no differences (`node crates/gp-core/parity/mutations/run.mjs <file> --ops 3000 --seeds 10`; `build.sh test` runs 3 000 a file). Invalid arguments, every role and an unknown one, rows gone or in the trash, Unicode at the limits, and every limit reached: presentations (16), songs (10, the 5 000 songs), arrangements (6), labels (4), song-materials (4), history (1), templates (7), custom-slides (7), themes (4), bibles-and-themes (3), overlays (3), displays (3), ccli (3), org-settings (1), trash (2), media (23) | every one, on the client and the server (`runMutation` in `packages/rust-core`, under `packages/sync`'s client and server engine): 2.5's step 1, 2026-11-16; a refusal carries the core's code, not the TS core's English message |
| probe (1) | a test helper: ported, so every mutator, the sync tests' included, runs on the core | switched |
| The TS core out of the app (the swap's step 4) | the checks take the reference from git (238d481b), not from the app | done: the mutators, the schema's DDL and migrations, the label seed, the client's sync SQL, `readItemSlides`, presenting's reducer and the verse lookups gone from `packages/core`; Drizzle gone from the server and sync |
| A Bible's text (`bibleView`) | proved: 230 compared against 2.0's reads (books, chapters, verses, every page turned, 14 searches, a text missing) | switched: a book and a chapter read through the core, only what is needed; a translation the device does not keep is fetched into a database of its own in the worker (the last three). The first open is faster (13–16 against 23–25 ms), a book and a chapter slower (9–10 against 5–6, 7 against 5 ms: a round trip to the worker each) |
| Views: every page's (37 views: the presentation and presenting, the songs and their editor, history and materials, the libraries, the presentations, templates and trash, labels, Bibles, themes, displays, the CCLI report), against the web's own reads at 238d481b | proved: identical JSON on the demo data (`parity/views-check.mjs`, `parity/views/*.mjs`); presenting's keys and marks 314 054 compared; song search against the TS search; 3 000 songs measured, no slower but opening Lägg till by a few ms (the JSON over the bridge) | switched: the pages read through `ReadDb.view`, from the database's worker under the client's lock; the output window asks its owner. Left as SQL in the shell: the files' bytes, the video cache, the export (with the imports), and ordering by name in the page's language |
| Sync's client logic: the queue, the rebase, the triggers (`crates/gp-core/src/sync.rs`) | proved: 15 000 steps over 10 seeds against the TS client and the server's real engine, a second device changing the same library, lost answers, offline, refusals, a role change, a first pull of two pages, an SQL error; every table, the queue and the undo log compared after each step (`parity/sync/check.mjs`); since the switch, the app's own `SyncClient` against the TS client as it was at 75e7f234, taken from git when the check is built | switched: `SyncClient` runs `syncOpen`, `syncMutate`, `syncPending` and `syncRebase` through the core; the network, pokes, sign-in, the server's refusals, `beforePush` and `localWrite` stay in the shell. A COMMIT refused by a foreign key after a rebase is rolled back as before, but never happened in the checks |
| The imports | not yet | not yet |
| The Mac app: the presentations, the running order, presenting | built on the core | — |

Where the core does otherwise than the TS core, on purpose or not yet checked: a database the migration refuses is
left as it was (the TS one leaves an empty `_schema` table); a song version whose text does not read is refused with
`invalid-snapshot` (the TS core throws zod's error; versions are only made by the mutators, so the check never makes
one); and a string with a lone UTF-16 surrogate cannot reach the core, as JSON between the shell and the core is UTF-8
(the checks send none).

Written in the core after the reference (Lars, 2026-11-17): schema 27, a time per field of custom slides, overlays and
own themes, and the newest change of each field winning (SYNC-R23, docs/assumptions.md); and a renamed slideshow,
picture, sound or video renaming its items, as a song does (docs/assumptions.md). The reference stops at 26, so the checks bring its
databases to 27 as the core's migration does and add these rules to the reference's mutators as triggers
(`parity/beyond-reference.mjs`); the sync check's reference client takes today's tables and schema version. A
feature written in the core first is proved so: its rule beside the reference, the rest unchanged.
