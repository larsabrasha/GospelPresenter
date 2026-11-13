# The Rust core

On the branch `claude/rust-core` only. Lars, 2026-11-13: the app is made again on one core in Rust, under the web
(the React UI kept, the core as WASM), the server (WASM in the Worker and in Node) and a native Mac app; MCP and a
CLI come later on the same core. It is done in a loop, function by function and view by view, each proved against
the TypeScript app as it was before (the reference). How the core is built and checked: `crates/gp-core/README.md`.

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
| Schema and migrations | not yet | not yet |
| presentations (16) | 13: all but renamePresentation, addBibleToPresentation, setItemOverlay | not yet |
| media (23), songs (10), custom-slides (7), templates (7), arrangements (6) | not yet | not yet |
| labels (4), song-materials (4), themes (4), ccli (3), bibles-and-themes (3), overlays (3), displays (3) | not yet | not yet |
| trash (2), history (1), org-settings (1), probe (1) | not yet | not yet |
| Views: a presentation's slides, against `readItemSlides` (every kind of item, every problem) | proved | not yet |
| Views: the presentations, the trash, song search | ported, not proved against a TS view | not yet |
| Presenting's keys and marks, against `presentingKey` and `slideMarks` | proved | not yet |
| Sync's client logic, the imports | not yet | not yet |
| The Mac app: the presentations, the running order, presenting | built on the core | — |
