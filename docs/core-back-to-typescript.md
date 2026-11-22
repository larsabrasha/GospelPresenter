# The core back in TypeScript: the plan

The decision and why: `adr/0008-one-gui-core-back-in-typescript.md` (Lars, 2026-11-22). This is how: the Rust core
(`crates/gp-core`, as WASM through `packages/rust-core`) ported back to TypeScript in `packages/core`, 1:1, with
Rust as the reference, and then removed. The same loop that took the TS core to Rust (`docs/rust-core.md`), run the
other way.

Each step below is done when its checks say 0 different; this file says where each stands, as `docs/rust-core.md`
did.

## Where it stands

| Step | State |
|---|---|
| 1, one interface, two cores | done (2026-11-22): `packages/core/src/commands.ts` behind `RustCore` |
| Wave 1, the data's rules | done and switched (2026-11-22): 0 different |
| Wave 2, sync's client | done and switched (2026-11-22): 0 different |
| Waves 3 to 5 | not started |

The checks of the way back run with `crates/gp-core/parity/port.sh` (`build`, `mutations`, `sync`): the Rust core is the
reference, the working tree's TS core the candidate (`GP_TS=tree`). In the sync checks' output the reference is
labelled Rust and the TS core TS.

e2e in a container without a display (Xvfb): three specs fail there whichever core runs, at the commit before the
port (`4dfb205`) as after it: `milestone2.spec.ts:260` and `:398`, `offline.spec.ts:40` (a click waits for an element
to be stable). `milestone2.spec.ts:181` is flaky both ways. `apps/web/test/ItemMenus.test.tsx` does not load in vitest
there (`node:sqlite` from `@gp/rust-core/scenarios`), before the port too.

## Forward from today, not back to `238d481b`

The port starts from the branch as it is, not from the commit before Rust. Since `238d481b` the app gained behaviour
and fixes that are not about Rust: PowerPoint decks (`gp-pptx`), Original beside a song's arrangements (SONG-R58), a
passage broken where reading pauses (BIBLE-R12), items renamed with what they show, the newest field wins for custom
slides, overlays and own themes (SYNC-R23), ordering by name in the page's language (before: SQLite's byte order),
"Appen startar långsamt", a library file that cannot be fetched said so, and the fixes of the reviews (a reload that
signed the device out, one unreadable slideshow stopping the whole media fetch, the database opened in one
transaction, the settings' fixes). And the web reads what it shows from the core now, not from logic spread through
React: a better shape than before, whatever the core's language.

So the TS core is ported **from Rust**, keeping the shape the core got there; the TS at `238d481b` is raw material
where it still matches (the mutators and the schema above all), not the starting point of the app.

## What the TS core keeps from the experiment

- **The core decides, the shell carries out.** No network, clock or window in the core; the caller passes the time
  and the user. It keeps the core testable, and MCP, a CLI and the server cheap later.
- **Rules as reducers.** Presenting (`presentingKey`, the live state), a page's own state and the sync driver are
  pure functions: state and event in, new state and what to do out. Before Rust that logic sat in React and in
  `SyncClient`.
- **Random comparison checks.** 30 000 random mutations a file, sync over a network that loses answers. Kept as a
  habit after the port too (fast-check or the existing generators).
- **Boundaries that are tested.** `packages/architecture`'s API files and boundaries tests.
- **Stable ids on actions**, as `data-testid` for e2e.

## What it leaves behind

- **The effect protocol** (`bridge.rs`: one statement asked for at a time): the TS core awaits the database.
- **JSON text at the boundary**: a view's answer is a TypeScript type all the way, which the Rust core never managed
  (`docs/native-apps.md`, "typed views would need each view's answer as a Rust type").
- **The views only native shells read**, glyph layout and ICU4X collation (below, *Not ported*).
- **View models of a page's buttons** (`pageButtonsView` and kin): they existed so several GUIs would show the same.

## Rules for the port

- **1:1 first.** The same command and view names, the same arguments, the same JSON answers, the same SQL where SQL
  is run. A shell switching from Rust to TS changes no line but the one that picks the core.
- **Rust is the reference.** Nothing switches before its parity check passes. The checks in
  `crates/gp-core/parity` already drive two cores side by side; their roles swap.
- **No new behaviour during the port** (ADR 0008 (7)). A fix found on the way goes in both cores, so the comparison
  stays meaningful.
- **No simplifying during the port** (ADR 0008 (6)). That comes after, with the Rust core gone and the e2e suite as the
  check.
- **Start from what existed.** Most modules were ports *of* TypeScript, and that TypeScript is in git: begin from it
  and bring it up to what Rust does now, rather than translating Rust from nothing.

## Step 0: before anything moves

- Tag `bd90b93` as `native-experiment-end` (Lars), so the experiment stays readable without its branches.
- Freeze `crates/gp-core` (ADR 0008 (7)): a line at the top of `AGENTS.md`.
- Record the reference: the Rust core at the commit the port starts from (`R` below).

## Step 1: one interface, two cores

Today the shells reach the core through `packages/rust-core` (`RustCore`, `runMutation`, `ReadDb.view`, the sync
commands; its public surface is `packages/architecture/api/rust-core.api.md`). Add a TS core behind that same surface,
and one switch that picks which core a shell runs (an environment variable for the checks and e2e, a constant in the
build). Both cores must be loadable at once, so the parity checks can run them on the same database.

The effect protocol (`bridge.rs`: the core asks for each statement and waits for the rows) is not ported: the TS core
takes the database as the TS mutators did (`MutationDb`, `RunSql`), and the interface hides the difference.

Done (2026-11-22): `packages/core/src/commands.ts` (`@gp/core/commands`) has the TS core's commands and views by name
(`tsRuns`, `runCommand`, `runCommandSync`, `tsHasView`, `runView`, `runPureView`); `RustCore` in `packages/rust-core`
sends each name the TS core has there, and the rest to the WASM. `GP_CORE=rust` (Node) or `rustOnly(true)` sends
everything to Rust again; `new RustCore(module, true)` is one instance that does, for the checks to run both side by
side. A statement the shell's SQLite refuses is thrown as the shell threw it, as from the Rust core (Drizzle's
wrapper taken off).

## Step 2: the modules, in waves

Each wave ends with its parity checks at 0 different and the shells switched to the TS core for it; the next wave
starts after. The size is the Rust file's lines, for a rough order of work.

### Wave 1: the data's rules (TS existed at `238d481b`)

The schema, its migrations and the label seed; every mutator; their argument checks.

| Rust | TS to start from |
|---|---|
| `schema.rs` (260), `rows.rs`, `json.rs`, `args.rs` (140) | `packages/core/src/schema.ts`, `org-schema.ts`, `mutators/base.ts` and `mutators/registry.ts` at `238d481b` |
| `mutators.rs` and `mutators/*` (arrangements, bibles_and_themes, ccli, custom_slides, displays, history, labels, media, media_items, org_settings, overlays, presentations, song_import, song_materials, songs, templates, themes, trash) | `packages/core/src/mutators/*` at `238d481b` |
| `ordered.rs` (194) | where the mutators kept order at `238d481b` |

Check: `parity/mutations/schema-check.mjs` (every version migrated through both) and `run.mjs` (random mutations
through both, every table compared after every step), 30 000 per file, as when they went to Rust. Then
`pnpm test` and the e2e specs that write (songs, presentations, trash, arrangements).

Done (2026-11-22). The mutators, `org-schema.ts` and `labels.ts` restored from `238d481b`, and brought to what the
Rust core does beyond them: schema 27's field times and `updateFields` (SYNC-R23), `renameItems` (a renamed
slideshow, picture, sound or video renames its items), `keepOriginal` and Original taken by `addSongToPresentation`
and `setItemArrangement` (SONG-R58), and a passage's slides broken where reading pauses (`splitBibleSlides`,
BIBLE-R12). The migrations refuse with the core's codes (`schema-too-old`, `schema-too-new`). Proved: the schema
check (every version, the label seed) and 30 000 random mutations of each of the 16 files, 0 different. The
generators now also give `original` as an arrangement, which the first run had missed and the tests found.
Switched: every mutator, `migrateOrgSchema` and `seedLabels`, on the clients and the server.

### Wave 2: sync's client

| Rust | TS to start from |
|---|---|
| `sync.rs`, `sync_sql.rs` | `packages/sync/src/client/client.ts` and `packages/core/src/sync-sql.ts` at `238d481b` |
| `sync_driver.rs` (362), `sync_wire.rs`, `sync_status.rs` | `client.ts` at `75e7f234` (the SyncClient the driver was proved against), then the driver's later fixes (six reviews, 2026-11-20) |

Check: `parity/sync/check.mjs` with the roles swapped (the Rust client as the reference against a real server engine,
the TS client given the same answers), the network losing and refusing answers; `sync_driver_random.rs`'s cases as a
TS test; the e2e specs `journeys` and sync's.

Done (2026-11-22): `packages/core/src/sync-commands.ts` (`syncOpen`, `syncMutate`, `syncPending`, `syncRebase`, with
the client half of `sync-sql.ts` restored from `238d481b`), `sync-driver.ts` (`syncStepView`, with the wire) and
`sync-status.ts` (`syncStatusView`). Proved: `sync/check.mjs` in the port's mode, the app's SyncClient on a core all
Rust against the same client on the TS core, 1 500 steps of each of 10 seeds, 0 different; `sync/driver-check.mjs`,
the driver and the status given the same random events (also malformed ones) by both cores, 30 000 events, 0
different. Switched: the clients' sync and the bar's status. e2e: `milestone1`, `offline` (but the one that fails
before the port too) and `song-clash` pass.

### Wave 3: slides, presenting and live

| Rust | TS to start from |
|---|---|
| `slides.rs`, `live.rs`, `presenting.rs` | `slides.ts`, `item-slides.ts`, `live.ts`, `presenting.ts` at `238d481b` |
| `live_state.rs`, `live_views.rs`, `page_state.rs` (254), `page_models.rs` (262) | the web's `apps/web/src/live/` (`liveList.ts`, `pageState.ts`) before they were switched (2026-11-17/18) |
| `bible.rs`, `bible_books.rs`, `bible_view.rs` | `bible.ts`, `bible-books.ts` at `238d481b` |

Check: `parity/demo-seed.mjs` (slides), `parity/live-check.mjs` (presenting), `packages/rust-core`'s tests run against
the TS core (`page-state`, `page-models`, `live-state`, `song-slides`, `scenarios` with `sunday.json`); the e2e specs for
presenting and the outputs.

### Wave 4: the pages' views

`views.rs`, `pages.rs`, `lists.rs`, `library_pages.rs`, `song_page.rs`, `song_views.rs`, `item_views.rs`,
`presentation_page.rs`, `media_views.rs`, `settings_views.rs`, `settings_pages.rs`, `settings_models.rs`, `search.rs`,
`themes.rs`, `theme_def.rs`, `look.rs`.

Most began as SQL and code in `apps/web` (`queries.ts`, the pages) before 2026-11-17; `git log -S` on a view's name
finds the commit that moved it, and its parent has the TS. Ordering by name goes back to `Intl.Collator` with
`sensitivity: 'base'`, which `collation.rs` was proved equal to (`parity/views/collation.mjs`).

Check: `parity/views/*.mjs` with the roles swapped; `packages/rust-core`'s `views`, `rules`, `user-rules`,
`settings-pages` tests against TS; the whole e2e suite once at the end of the wave (every page reads these).

### Wave 5: imports, exports and files

| Rust | TS to start from |
|---|---|
| `propresenter.rs` (378), `song_import.rs` | `propresenter.ts` at `238d481b`; the web's `apps/web/src/pages/songImport.ts` at `fb03e798` |
| `bible_import.rs` (457) | `bible-import.ts` (`importBibleZip` and its readers) and `zip.ts` at `238d481b` |
| `legacy.rs` (353), `org_transfer.rs` | `legacy.ts` at `238d481b`; the web's `media/legacyImport.ts` and `media/orgExport.ts` before 2026-11-18 |
| `bible_texts.rs` | the web's syncBibleTexts, fetchBibleText and BibleTextUploads at `3d061fc9` |
| `media_wanted.rs`, `media_plan.rs`, `files.rs` | `packages/sync/src/client/media.ts` (`wantedBlobs`, `wantedVideos`, `blobsOf`, `keptPresentations`) at `3d061fc9^`, the commit before they moved |

Check: `packages/rust-core`'s `propresenter`, `real-propresenter`, `bible-import`, `real-bible`, `legacy` tests against
TS; `parity/views/bible-texts.mjs`, `wanted-media.mjs`; the e2e specs for import, export, media and video.

## Not ported (ADR 0008 (5))

These views are read by no code in `apps/web`, `apps/server`, `apps/desktop`, `apps/legacy`, `packages/sync` or
`packages/core` (checked by name on 2026-11-22); they exist for the native shells and leave with them:

`autoOutputsView` `bibleImportTextView` `ccliPageView` `deckImportView` `deckPagesView` `displayCodeView`
`displayStatusView` `editorSlideView` `exportPlanView` `imageDrawView` `imageEditView` `importManifestView`
`importPlanView` `itemCountsView` `labelColoursView` `libraryOrderView` `liveView` `lookView` `mediaImportView`
`mySettingsView` `pageButtonsView` `playbackStepView` `presentationColumnsView` `presentationView` `presentationsView`
`searchSongsView` `settingsSearchKeysView` `slideEditView` `slideEditorView` `slideHitView` `slideLayoutView`
`songHistoryPageView` `songListView` `storageLimitsView` `themeEditView` `themeEditorView` `trashPageView`
`trashView` `userRulesView` `videoImportView`

With them, likely whole modules: `slide_layout.rs` and `slide_items.rs` (glyph layout; the browser lays out),
`collation.rs` and `crates/gp-core-collation` (`Intl.Collator`), `playback.rs` (the web has its own),
`slide_editor.rs`, `theme_editor.rs`, `image_edit.rs`. Each is checked again when its wave comes: a module some
ported view calls into is ported as far as that view needs.

## Step 3: the switch

All shells on the TS core: the web's worker and page core, the Node host, the Durable Object, the desktop host, the
legacy export. Then the whole check: `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`, and
`performance.spec.ts` with numbers beside the Rust core's (startup without the WASM; long lists; sync).

## Step 4: removal

After the switch has run for real (at least one Sunday on a desktop host):

- `packages/rust-core`, `crates/gp-core` (its `parity/` with it), `crates/gp-core-ffi`, `crates/gp-core-collation`,
  `crates/gp-tui`, `apps/mac`, `apps/windows`; the root `Cargo.toml` and `Cargo.lock`. `crates/gp-pptx` stays, in its
  own workspace (ADR 0008 (8)), with `rust-toolchain.toml` beside it.
- turbo's `wasm` task; the WASM from `apps/web`'s and `apps/server`'s builds.
- `packages/architecture`: `api/rust-core.api.md`, the boundaries naming `@gp/rust-core`, `action-ids.test.ts`'s Swift
  checks.
- The docs: `docs/rust-core.md`, `native-apps.md`, `windows-app.md`, `tui.md` and `native-slide-rendering.md` get a
  line at the top pointing to ADR 0008 and the tag, and leave `README.md`'s table; `AGENTS.md` and `README.md` say the
  core is `packages/core` again.

## Step 5: simplifying, later

With one shell, some of the core's page views only pass decisions from the core to React
(`presentationActionsView`, `itemActionsView`, `pageModelView` and kin). Each may move into the web where that is
simpler, one at a time, each with its e2e specs. Not part of the port, and not needed for it.

## How long

The swap the other way, from the first mutator to the TS core out of the app, took 2026-11-13 to 2026-11-17, with the
checks being written along the way. They exist now. A rough guess for the way back is about a week of the same loop:
waves 1 and 3 mostly restore code from `238d481b`; waves 2, 4 and 5 hold the 55 commits written in Rust only.
