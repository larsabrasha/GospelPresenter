# The Rust core

On the branch `claude/rust-core` only. Lars, 2026-11-13: the app is made again on one core in Rust, under the web
(the React UI kept, the core as WASM), the server (WASM in the Worker and in Node) and a native Mac app; MCP and a
CLI come later on the same core. It is done in a loop, function by function and view by view, each proved against
the TypeScript app as it was before (the reference). How the core is built and checked: `crates/gp-core/README.md`.

## 2.5: the core swapped, nothing else

Lars, 2026-11-14: 2.0 is released on the TypeScript core first, its core frozen from then; 2.5 is the same app, the
same React UI on the web, in Electron and in Capacitor, with the Rust core as WASM under all of it instead of the TS
core. No new features in 2.5: behaviour as 2.0's, proved by the differential checks and the whole e2e suite. Done:

1. every mutator switched on the client and the server (`RUST_MUTATORS` in `packages/rust-core`);
2. sync's client logic in the core;
3. the views in the core, the React pages reading slides and lists from it;
4. the TS core out of the app; the reference kept at 238d481b for the checks.

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

What comes after 2.5 is written in Rust first. Native UIs on the same core come later: the Mac and iOS app
(`claude/rust-core-ios-ab7733`, a working prototype over the core) waits until then, not merged.

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
| Schema and migrations, and the default labels (`crates/gp-core/src/schema.rs`; the commands `migrateOrgSchema` and `seedLabels`, each in the shell's one transaction) | proved (`crates/gp-core/parity/mutations/schema-check.mjs`): a new database, one of every version 11 to 26 with rows the data migrations change, and the three the migration refuses; the same `sqlite_master` and rows. A refused database is left as it was, where the TS migration leaves an empty `_schema` table on it | not yet |
| The mutators, every file but probe (`crates/gp-core/src/mutators/`, one module a file, each with its own dispatcher; arguments as zod checks them, permissions as `permissions.ts`'s, JSON stored as `JSON.stringify` writes it) | proved, each file alone: 30 000 random mutations through both cores, every table compared after each step, no differences (`node crates/gp-core/parity/mutations/run.mjs <file> --ops 3000 --seeds 10`; `build.sh test` runs 3 000 a file). Invalid arguments, every role and an unknown one, rows gone or in the trash, Unicode at the limits, and every limit reached: presentations (16), songs (10, the 5 000 songs), arrangements (6), labels (4), song-materials (4), history (1), templates (7), custom-slides (7), themes (4), bibles-and-themes (3), overlays (3), displays (3), ccli (3), org-settings (1), trash (2), media (23) | 13 of presentations' on the client and the server (`RUST_MUTATORS` in `packages/rust-core`, one adapter under `packages/sync`'s client and server engine); the rest still the TS core's |
| probe (1) | a test helper of the TS core: not ported | — |
| Views: a presentation's slides, against `readItemSlides` (every kind of item, every problem) | proved | not yet |
| Views: the presentations, the trash, song search | ported, not proved against a TS view | not yet |
| Presenting's keys and marks, against `presentingKey` and `slideMarks` | proved | not yet |
| Sync's client logic, the imports | not yet | not yet |
| The Mac app: the presentations, the running order, presenting | built on the core | — |

Where the core does otherwise than the TS core, on purpose or not yet checked: a database the migration refuses is
left as it was (the TS one leaves an empty `_schema` table); a song version whose text does not read is refused with
`invalid-snapshot` (the TS core throws zod's error; versions are only made by the mutators, so the check never makes
one); and a string with a lone UTF-16 surrogate cannot reach the core, as JSON between the shell and the core is UTF-8
(the checks send none).
