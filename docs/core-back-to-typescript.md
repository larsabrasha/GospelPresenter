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
| Wave 3, slides, presenting and live | done and switched (2026-11-22): 0 different |
| Wave 4, the pages' views | done and switched (2026-11-22): 0 different |
| Wave 5, imports, exports and files | done and switched (2026-11-22): 0 different |
| Step 3, the switch | done: the app sends nothing to the WASM (`GP_CORE_TRACE=1`) |
| Step 4, removal | done (2026-11-23), asked by Lars before a real Sunday: the Rust core, the native shells and the TUI are at the tag `native-experiment-end` |

The checks of the way back ran with crates/gp-core/parity/port.sh (`build`, `mutations`, `sync`, `views`): the Rust core
the reference, the working tree's TS core the candidate (`GP_TS=tree`). They went with the Rust core in step 4; to run
them again, check out the tag `native-experiment-end` and port this tree's `packages/core` onto it.

e2e in a container without a display (Xvfb), the whole suite on the TS core (2026-11-23): 104 passed, 3 skipped.
Of the rest, the specs that launch a second browser had no headless shell for Playwright's version in that container
(an environment fault, linked in by hand); rerun with one worker, 22 tests still fail, and every one of them fails the
same way at the commit before the port (`4dfb205`), run with one worker too: `audio:76`, `custom-slides:67`,
`drag:29`, `https:43`, `:103`, `:155` (connection reset on the LAN address), `journeys:56`, `letter-index:17`,
`live-order:14`, `menu:17`, `milestone2:181`, `:260`, `:398`, `milestone4:141`, `new-build:54`, `offline:40`,
`overlays:13`, `phone:32`, `remote:28`, `:136`, `sync-status:13`, `video:202` (mostly a click that waits for an element
to be stable, or touch and the LAN). None is the port's; they are to be run on a machine with a display.
`performance.spec.ts` fails its limits in that container whichever core runs; its numbers beside the Rust core's are under
step 4.
`apps/web`'s ItemMenus.test.tsx did not load in vitest there (`node:sqlite` from the scenarios), before the port too;
step 5 replaced it with `apps/web/test/itemMenu.test.ts`.

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
commands; its public surface is packages/architecture/api/rust-core.api.md (at the tag native-experiment-end)). Add a TS core behind that same surface,
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

### The views, waves 3 to 5 (done, 2026-11-22)

Ported into `packages/core/src/views/`, one group a file or a few, gathered in `views/index.ts`, and proved by
`port.sh views`: each group's `port-views/<group>.mjs` sends its cases through an all-Rust core and the core as the app
has it, on the demo data (`views/fixture.mjs`) and on databases made for the case, and compares the answers as JSON.
Each group was checked once with a fault planted.

| Group | Views | Cases, 0 different |
|---|---|---|
| `live` | liveChangeView, followItemOverlayView, addPositionView, presentationActionsView, itemActionsView, detailsDialogView | 13 076 |
| `slides` | itemSlidesView, bibleView, themeView, bibleSlidesView, verseSearchPlanView, bibleBookNamesView, presentingKeyView, slideMarksView, highlightView | 13 373 |
| `page` | pageEventView, pageModelView, liveSlideView, overlayView, itemOverlaysView, liveTargetsView, livePlaybackView, itemAudioView, ccliUseView, displaysView, remoteControlView, presentationPageView | 32 427 |
| `start-page` | startPageView | 326 |
| `lists` | presentationListView, templatesView, itemsView, labelsView, songPartsView, pinnedView, trashEntriesView, imagesView, audiosView, videosView, customSlidesView, customSlideView, overlaysView, overlayRowView, songsView, songSearchPrepare, songSearchView, songView, songPageView, songPresentationsView, songHistoryView, songMaterialsView, biblesView, ownThemesView, ownThemeView, defaultThemeIdView, ccliReportView, themesPageView, settingsListView, settingsSearchView, freshNameView, libraryPageView, rulesView, coreInfoView | 15 921 |
| `files` | proPresenterSongView, songNamesakesView, songImportDuplicatesView, bibleImportView, legacyUpgradeView, legacyBlobsView, legacyRowsProblemView, legacyOverlayPageView, exportRowsView, bibleTextPlanView, bibleTextStoreView, bibleTextJsonView, bibleUploadsView, wantedMediaView, mediaPlanView, mediaUploadsView, mediaStorageView | 13 525 |
| `sync-status` | syncStatusView | 649 |

Where Rust is matched rather than simplified, for now (step 5 may simplify): lengths and strings by code point where
Rust counted them so (slideshow pages, theme definitions, highlights); JSON text read as serde_json read it
(`stored-json.ts` since round 6: half a surrogate pair, numbers past a double, 128 levels deep refused); a
`partIndex` wrapped to 32 bits as `usize` on WASM did; Rust's insertion sort for a Bible book of 20 verses or fewer;
a DEFLATE decoder of its own (`inflate.ts`, beside `zip.ts` since step 5) that takes and refuses what miniz_oxide did.

Not matched, each where the Rust core trapped (panicked), so there was no answer: `legacyOverlayPageView` with a
picture lacking `full` or `thumb`, a Bible book of more than 20 verses whose chapter is not a number, a typed number
of non-ASCII text in a page's state, an argument holding half a UTF-16 pair. The TS core answers or refuses there.
Until round 6 `files-json.ts` kept a number's text as written (`JSON.parse`'s `context.source`); a queued change's
arguments are read by `stored-json.ts` now, as plain numbers.

Found on the way: the mutators check text lengths with zod, which (zod 4) counts code points as the Rust mutators did,
so a text of emoji at its limit is taken by both (checked again in round 6). `coreInfoView` answered `gp-core 0.1.0`, which "Om Gospel
Presenter" showed as the core it ran on; the row and the view went in step 5, round 4 (Lars, 2026-11-23).

## Step 3: the switch

All shells on the TS core: the web's worker and page core, the Node host, the Durable Object, the desktop host, the
legacy export. Then the whole check: `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`, and
`performance.spec.ts` with numbers beside the Rust core's (startup without the WASM; long lists; sync).

## Step 4: removal

Done on 2026-11-23, asked by Lars ("Kör") before the switch had run a real Sunday; a fault the e2e suite does not see
is fixed in `packages/core`, with the tag `native-experiment-end` to compare against. What went:

- `packages/rust-core`, `crates/gp-core` (its `parity/` with it), `crates/gp-core-ffi`, `crates/gp-core-collation`,
  `crates/gp-tui`, `apps/mac`, `apps/windows`; the root `Cargo.toml` and `Cargo.lock`. `crates/gp-pptx` stays, in its
  own workspace (ADR 0008 (8)), with `rust-toolchain.toml` beside it.
- turbo's `wasm` task; the WASM from `apps/web`'s and `apps/server`'s builds.
- `packages/architecture`: `api/rust-core.api.md`, the boundaries naming `@gp/rust-core`, `action-ids.test.ts`'s Swift
  checks.
- The docs: `docs/rust-core.md`, `native-apps.md`, `windows-app.md`, `tui.md` and `native-slide-rendering.md` say
  at the top that the code is at the tag, and left `README.md`'s table; `AGENTS.md` and `README.md` say the core is
  `packages/core` again.
- With them: the native apps' slide renderer (`apps/web`'s `slides.html`), the web's tests that compared the web with views
  only the native shells read (`autoOutputsView`, `imageEditView`, `settingsSearchKeysView`), and the tests in
  `packages/core/test/node` of those views (the list under "Not ported").

The shells reach the core through `Core` (`packages/core/src/core.ts`), the shape `RustCore` had: `run`, `view`,
`pure` and `runSync`. The tests that were `packages/rust-core`'s are `packages/core/test/node`'s, the scenarios
`packages/core/scenarios`. `scripts/check-mutator-sql.mjs` reads the TS mutators again.

Checked after the removal (2026-11-23, the same container): typecheck, lint, every package's unit tests (core 288,
server 1196 on every adapter, web 360, architecture 39, legacy 21, desktop 10), and the whole e2e suite: 115 passed,
3 skipped, and 25 failed, the 22 that fail at `4dfb205` as well (above) and `performance.spec.ts`'s three, which
fail its limits there whichever core runs. Its numbers beside the Rust core's, one worker each, TS first:
`startReload` 2147 against 2915 ms, 4× slower CPU under its 2500 against 2992; `songsReload` 2428 against 2984, 4×
slower 3639 against 4676; `openPresentation` with 4× slower CPU 250 against 332. The page needs no WASM fetched and
compiled before it starts.

## Step 5: simplifying

With one shell, some of the core's page views only pass decisions from the core to React
(`presentationActionsView`, `itemActionsView`, `pageModelView` and kin). Each may move into the web where that is
simpler, one at a time, each with its e2e specs. Not part of the port, and not needed for it.

Round 1 (2026-11-23): the presentation's menu, its details dialog and an item's menu.
- `detailsDialogView` and `presentationActionsView` are gone: `PresentationDetailsDialog.tsx` and
  `PresentationEditor.tsx` decide their title, buttons and entries themselves.
- `itemActionsView` is `apps/web/src/live/itemMenu.ts`, typed (`ItemMenu`), its tests
  `apps/web/test/itemMenu.test.ts`; ItemContextMenu and ItemSheet draw Kommentar, Lägg till efter, Markera and Radera
  always, as the view always offered them.
- The scenario's answers (`packages/core/scenarios/sunday.expected.json`) lost their menus; the web's ItemMenus test,
  which drew the menus against them and did not load in vitest, went, and `happy-dom` with it.
- e2e: editor, keyboard, labels, library, programme-points, song-materials, templates, themes and trash pass; drag,
  live-order, milestone2's three, offline, overlays and phone fail as at `4dfb205`, on the same lines.

Round 2 (2026-11-23): `rulesView`.
- The web asks `can` (`permissions.ts`) and reads `LIMITS`, `MAX_VERSES_PER_ITEM`, `CUSTOM_LIMITS` and `MEDIA_LIMITS`
  itself; the fields' rules are `FIELD_RULES` (`mutation.ts`), which the mutators' schemas take their lengths from.
- `packages/core/test/node/rules.test.ts` runs each field's mutator at its most, one over and blank against
  `FIELD_RULES`.
- e2e: templates, editor, programme-points, users, ccli, trash, library, milestone1, milestone3, settings and
  image-edit pass; custom-slides' one fails as at `4dfb205`.

Round 3 (2026-11-23): Inställningar's list and libraries.
- `settingsListView` and `settingsSearchView` are `apps/web/src/pages/settings/settingsLinks.ts`'s own: the groups,
  rows, icons and colours written out there, the search over the i18n texts.
- `libraryPageView` and `freshNameView` are gone: the web read only whether a role manages a library, now `can`, and
  `freshName` (`ui/justCreated.ts`) names a new one itself.
- e2e: settings, library, users, themes, shortcuts, panels, orgs, labels and image-edit pass.

Round 4 (2026-11-23), by the rule Lars agreed: what is true whatever the page looks like (rules, data, what the
outputs show, presenting's state) is the core's; how it is drawn is the web's.
- The views that read no database are typed functions of `packages/core/src/pure.ts` (through `@gp/core/core`):
  `presentingMarks`, `addPosition`, `liveChange`, `followItemOverlay`, `pageModel` and `pageEvent` with the page's
  types (`PageState`, `PageEvent`, `PageCommand`, `PageCue`), `bibleSlides`, `verseSearchPlan`, `importBibleZip`,
  `proPresenterSong`, `songNamesakes`, `songImportDuplicates`, `searchMarks` and `syncStatus`. The web calls them
  directly: `apps/web`'s pageCore.ts and bibleZip.ts are gone, and with them the names as strings, the casts of each
  answer and the files sent as base64. A book's names are `swedishBookName`, `englishBookName` and `isOldTestament`.
- Presenting's state machine stays in the core: it decides what the outputs show.
- `removableItem` (`presenting.ts`) is the one rule that the item on the outputs is not removed; the page's Radera
  key (`page-state.ts`) and the item's menu (`itemMenu.ts`) both ask it.
- Om Gospel Presenter no longer has the core's row ("Kärna: Rust, gp-core 0.1.0"), and `coreInfoView` is gone.
- e2e, the whole suite: 115 passed, 3 skipped, and the same 25 failing as after step 4 (the 22 of `4dfb205` and
  performance's three), each on the same step as then or a later one.

Round 5 (2026-11-23): no copies (Lars: "inget skräp som dubbla metoder"). An audit of `packages/core/src` found about
45 groups where the older TS modules and the views ported back from Rust did one job twice. Every copy no shipped code
ran is gone (the old zip reader, Bible reference and content readers, `searchSongs` and `highlight`, the old slide
builders and theme readers, four views no shell called), and every pair that behaved alike is one function: the zip
reader and DEFLATE (`zip.ts`, `inflate.ts`), the Bible text's storing and hash, the theme read, the item rows, the
media SQL, the argument and id checks, the trims and comparisons; constants are imported where they are defined.
e2e, the whole suite: the same 25 as round 4. Seven pairs ran both and differed on broken data or rare characters;
Lars chose one behaviour for each (round 6).

Round 6 (2026-11-23): one rule each where both copies ran (Lars chose each).
- Where a word starts (S3): `words.ts`'s `wordChar` (the Rust core's: a BMP letter or digit, not a mark nor a circled
  letter), with `lower`, `fold` and `terms`, for finding (`search.ts`) and marking (`views/slides-highlight.ts`).
  Nothing found or marked changes: the two sets agree on the BMP, and search read the half of a pair before a term.
- A song's arrangements and parts (I3): `songOrder` (`slides.ts`), by `sort` as a whole number (one that is not
  first), then id by code point; `sortedArrangements` (the item's menu) and the slides' default use it (SONG-R19).
- The app's JSON (H6, I1, I2, T1): `stored-json.ts`'s `readStoredJson` refuses a parse error, an infinite number,
  half a surrogate pair in a key or a text, and 128 levels; it replaced `views/serde.ts`'s `parseJson`,
  `views/lists-rows.ts`'s `readJson`, `files-json.ts`'s `serdeParse` (with its numbers kept as written), and the bare
  `JSON.parse` of `parsePartIds`, `imageItemIds`, `parseCustomPage`; the views use those three. An own theme is read
  by `views/lists-settings.ts`'s `ownRow` alone (`themeOf` takes no reader): presenting's `themeView` now saturates
  a sort past an i64 as Teman did. `files-json.ts`'s `parseLegacyJson` (once `parseText`) is the 1.x and 2.0
  files' reader, which mends half a pair.
- Text lengths: zod 4 counts code points already, as the views do (`charsAtMost`, `views/serde.ts`); nothing changed
  but tests of emoji at each field's limit (`packages/core/test/node/rules.test.ts`). The web's inputs' `maxLength`
  counts UTF-16 units, so a field of emoji stops at half its length there.
- A video item's row (I5) is Video's (`videoRow`): an unknown type mp4, an unknown codec h264.
- Pages (C2, C3): `custom-slides.ts`'s `readCustomPages` and `readCustomPage` check every page read (the slides,
  Bildspel, the overlay shown, the blobs to fetch and upload, the export zip's rows): pages that do not read are one
  blank page; `customPageText` is the one page text. The hand-written checks (`lists-media.ts`'s and the export
  zip's) are gone, and the export's Bible check is `readBibleItemContent` (`views/slides-items.ts`).
- A queued change's blobs (T4, C4): `themes.ts`'s `checkedThemeBlobs` and `customPageBlobs` of checked pages; a
  definition or page that does not check names none.
- The running order (P1): `slideCounts` (`views/slides-presenting.ts`) skips a row that is not [text, whole number
  from 0], for presenting's keys and the page's state alike.
- Tests: `packages/core/test/reading-rules.test.ts`, `packages/core/test/node/reading-rules.test.ts`, and one in
  `packages/core/test/node/legacy.test.ts`.
- The legacy import's functions (`upgradeLegacyRows`, `legacyRowsProblem`, `legacyBlobs`, `legacyOverlayPage`) return
  their rows and pages at once instead of as JSON text read back, and a song version and a queued change's arguments
  are read by `readStoredJson` too.
- e2e, the whole suite: the same 25 failing as in round 5, 115 passed.

## How long

The swap the other way, from the first mutator to the TS core out of the app, took 2026-11-13 to 2026-11-17, with the
checks being written along the way. They exist now. A rough guess for the way back is about a week of the same loop:
waves 1 and 3 mostly restore code from `238d481b`; waves 2, 4 and 5 hold the 55 commits written in Rust only.
