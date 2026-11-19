# The terminal shell (`crates/gp-tui`, binary `gp`)

Proposed by Lars on 2026-11-18: a TUI over the Rust core, for presenting over SSH or from a headless Raspberry Pi by
the stage, on old machines, scriptable and testable in CI, and readable with a terminal's screen reader. First
milestone built on 2026-11-19, on `claude/tui-7ae6fd` from `claude/native-ios-058c37`.

## What it is

One Rust binary with the core linked in (no WASM, no UniFFI): `crates/gp-tui/src/shell.rs` opens the organisation's
SQLite with rusqlite (SQLite built in) and answers each statement the core asks for, as the Mac app's
`apps/mac/Sources/Shell/Shell.swift` does: `gp_core::start`, then `resume` with each statement's rows until the core is
done or refuses; a command in its own transaction, rolled back on a refusal; values as the web's worker hands them over
(a whole REAL as an integer, a blob as null; the same as `crates/gp-core-ffi`). Opening runs `migrateOrgSchema`, as the
Mac app does on its demo data.

What a screen shows and what a key does is the core's, read as the Mac app reads it (`apps/mac/Sources/GPMac/`
`AppState.swift`, `Model.swift`, `Live.swift`):

| Screen | From the core | Shell's own |
| --- | --- | --- |
| Start page | `startPageView` {today}: the lists, their order, which show a date and its year, each row's number of items | the cursor; a row's second line as the Mac's `subtitle` (dates in Swedish through chrono's sv_SE) |
| A presentation | `presentationPageView`: the running order and each item's slides; `pageEventView` for every key (the page's state: selected, made ready, typed); `pageModelView`'s cue ("Bild 2 i Tusen skäl – Enter visar") | three columns: the order, the selected item's slides (first line, label in its colour, VISAS, NÄSTA, made ready in blue), and a preview |
| Presenting | `liveChangeView` for every change of the live state (one presentation at a time); `slideMarksView` for VISAS and NÄSTA | the preview shows VISAS and NÄSTA; Avsluta asks first, as the Mac app does |
| Output view (`o`) | the slide shown, from the same live state | its text centred, nothing before the first slide or after Släck, one quiet status line |

The texts are the app's own: `crates/gp-tui/build.rs` has Node read `apps/web/src/i18n.ts` (as `apps/mac/texts.mjs`
does for Swift) into the build, and `texts.rs` picks Swedish, or English with `GP_LANG=en`. No text is written anew;
the footer uses the web's `shortcuts.*` texts.

### Keys

Which key is which event is the shell's (`docs/view-models.md`, "What stays a shell's"); the page's are the Mac app's
(`WideLayout.swift`), the output view's its output window's (`Slides.swift`). A terminal has no ⌘: ⇧↑ ⇧↓ take ⌘↑ ⌘↓'s
place, and `e` sends `end` as ⌘. does.

| Where | Keys |
| --- | --- |
| Start page | ↑ ↓ (or j k) move, ↵ opens, q quits |
| A presentation | F5 `start`; → ↓ ← ↑ `pick`; Space `step`; ↵ `enter`; b B . `black`; Esc `escape` (and back to the start page when the page does not take it, never from the page presented); digits `digit`; PageUp PageDown `clicker`; ⇧↑ ⇧↓ `item`; ⌥↑ ⌥↓ `move` (moveItem); `e` `end`, asked first; o or Tab the output view; Backspace back; q quits |
| Output view | → Space ↵ `step` +1, ← `step` −1, b `black`; o, Tab or Esc back to the page |

⌃C quits anywhere. The page's → makes the next slide ready (the web's and the Mac page's rule); in the output view → shows
it at once, as the Mac's output window does.

## Running it

```sh
crates/gp-core/build.sh                 # makes crates/gp-core/parity/.out/fixtures/demo.sqlite, among the rest
cp crates/gp-core/parity/.out/fixtures/demo.sqlite /tmp/demo.sqlite   # never the fixture itself: gp writes to it
cargo run -p gp-tui --release -- /tmp/demo.sqlite
```

Building needs Node 22.6 or later (for `i18n.ts`). The release binary is 4.4 MB on a Mac (arm64); the first release
build takes about five minutes (the core with LTO).

## Checked

`cargo test -p gp-tui`, 42 tests, under a second once built:

- Pure logic, 25 unit tests: each key to its event on the page, in the output view and in the question to end; the
  texts from `i18n.ts` and their placeholders; a start row's second line and dates; a value from SQLite to the core
  and back.
- Through the core on a copy of the demo data, 17 tests (`crates/gp-tui/tests/demo.rs`): the start page's lists and
  counts drawn; ↵ opens; F5 starts with nothing shown; Space shows the first slide (past a heading); the marks; → → ↵
  shows the slide made ready; b blacks the screen and Space shows again; the output view's arrows; stepping past an
  item's last slide selects the next; Avsluta asked, then confirmed; another presentation refused while one is
  presented; ⌥↑ moves an item in the copy; and what the page and the output view draw (VISAS, NÄSTA, the slide's text,
  Släck), from ratatui's TestBackend. The fixture's hash is the same after a run.
- Run by hand in the app's terminal panel on a copy: the start page drew the demo's 16 presentations with Swedish dates
  and counts. The keys were not pressed by hand (the panel takes no keys from the agent); they are pressed by the tests.
- `cargo clippy -p gp-tui --all-targets`: no warnings in gp-tui.

Not in `pnpm test` or CI: the demo fixture is made by `build.sh`, which CI does not run.

## Left

- **Sync with the desktop host**: the shell opens a database file only; the native app's `Sync.swift` (pull, push,
  pokes over the core's `sync*` commands) has no Rust counterpart here yet. Until then the TUI and another shell on the
  same file do not see each other's live state, which is per device.
- **The CLI**: one program, `gp present next` for scripts and `gp` with no arguments opening the TUI. The live state
  is in memory now; a command from another process needs a running `gp` to talk to (a socket) or the desktop host's
  remote control.
- **SSH and the Raspberry Pi**: not tried. ratatui and the bundled SQLite build for aarch64 Linux; not built.
- **The caller** is the demo's (`demo`, admin), as the Mac app's demo runs; a signed-in member's role needs sign-in
  and pairing (`docs/sign-in-and-pairing.md`).
- **The page's other commands**: Lägg till (`a`), Radera (Delete), an item's menu (`itemActionsView`), overlays, songs
  and the library are not drawn or sent. The `changed` event is sent after a move, with the selected item as the one
  on the screen.
- **Slides**: a slide's text only; a picture or a video shows its item's title. Bible verse numbers are in the text as
  the core gives it. No theme, no colours but the labels'.
- **A screen reader**: the screens are plain text, but nothing was tried with one.
