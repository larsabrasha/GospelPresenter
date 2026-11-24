# 8. One GUI, and the core back in TypeScript

- **Status:** Accepted
- **Date:** 2026-11-22
- **Scope:** `crates/gp-core`, `crates/gp-core-ffi`, `crates/gp-core-collation`, `crates/gp-tui`,
  `packages/rust-core`, `packages/core`, `apps/mac`, `apps/windows`, and every shell that calls the core
- **Restores:** ADR 0007's single-language stack (Stack (1), and its fourth reason: "It is not the
  author's stack")
- **Ends:** the direction of `docs/rust-core.md` ("the app is made again on one core in Rust"),
  `docs/native-apps.md`, `docs/windows-app.md`, `docs/tui.md` and `docs/native-slide-rendering.md`.
  None of it is deleted from history; see *What is kept*.
- **The plan:** `docs/core-back-to-typescript.md`

## Context

From 2026-11-13 to 2026-11-22 the rewrite ran an experiment on top of ADR 0007: one core in Rust
under every shell, and native GUIs over it. Its question was Lars's: is this a way that can be
walked, and what does it cost?

What was built, on the branch this ADR lands on:

| Part | Size | Where it got to |
|---|---|---|
| `crates/gp-core`, the core | about 11 700 lines of Rust, 120 views and every mutator | under the web, Electron, Capacitor and the server as WASM since 2026-11-17; proved against the TS core it replaced (`238d481b`) |
| `apps/web`, the React GUI | about 40 600 lines | the whole app |
| `apps/mac`, SwiftUI for the Mac and iOS | about 12 900 lines | presentations, the running order, presenting, settings, slides painted from the core's layout; not built: editing a song, Markera, Utgångar and Fjärrstyrning in a presentation, cloud sign-in |
| `apps/windows`, WinUI 3 in C# | 13 files | the start page's lists, seen on Windows 10; paused 2026-11-22 |
| `crates/gp-tui`, a terminal shell | ratatui over the core | the start page, a presentation and presenting |
| Android in Kotlin, GTK on Linux | — | planned, not begun |

What it showed:

- **The core works.** One set of rules under every shell did not drift: the parity checks (random
  mutations through both cores, 30 000 per file; slides, presenting, sync, collation, Bible texts)
  ended at 0 different. The architecture — a core that decides, shells that only carry out its
  effects (SQL, the network, drawing) — is sound.
- **The GUI is what costs, and it costs once per platform.** A presentation app is mostly GUI:
  the editor, the library, the settings, presenting, the output. A shared core shares none of the
  layout, focus, keys, text editing, drag and drop or windows. After a week SwiftUI was about a third
  of the React GUI's size with whole pages still missing, WinUI had one page, and two platforms
  had not started. Each GUI also has to be tested on its own, and keeping them in step needs work of
  its own (naming every button by the core's ids on every platform, `f0de37b`).
- **More and more logic moved into the core only so the native shells would not repeat it.** Of the
  core's 120 views about 43 are read by no web, server or desktop code: they exist for SwiftUI,
  WinUI and the TUI (the list is in the plan). Glyph-exact slide layout (parley and three fonts,
  `slide_layout.rs`) and ICU4X collation exist because a native shell has no browser to do it.
- **Rust is there for the native shells.** It is what Swift, Kotlin and C# can call. Without them
  it costs a second language beside the TypeScript every shell is written in, a WASM build before
  anything loads, a JSON bridge and an effect protocol (`bridge.rs`: the core asks for each SQL
  statement and waits), a pinned toolchain, and debugging across that boundary — in a project one
  person maintains, where ADR 0007 already chose one language for that reason.

## Decision

1. **One GUI: the React app**, on the web, in Electron on the desktop and in Capacitor on the
   phone. Features are built once.

2. **The native shells stop:** `apps/mac` (SwiftUI, Mac and iOS), `apps/windows` (WinUI),
   `crates/gp-tui`, and the planned Android and GTK shells. With them goes the reason for
   `crates/gp-core-ffi` and `crates/gp-core-collation`.

3. **The core goes back to TypeScript**, in `packages/core`, behind the interface the shells use
   today, so the web, the server and the sync engine do not notice which core they run on. The port
   is 1:1 first: the same mutator and view names, the same arguments and the same JSON answers.

4. **Rust is the reference during the port**, as the TS core was for Rust: the parity checks in
   `crates/gp-core/parity` run the other way, each module proved at 0 different before the shells
   switch to it. That method is the experiment's best result, and it makes the way back provable
   rather than hoped for.

5. **Only what a shell reads is ported.** The views only the native shells read, glyph layout and
   ICU4X collation (the browser's layout and `Intl.Collator`, which the Rust versions were proved
   equal to) are not ported; they leave with the Rust core.

6. **Simplify after, not during.** Views that exist so several shells could share a decision
   (`presentationActionsView`, `itemActionsView`, `pageModelView` and kin) may move back into React once one shell
   reads them, each as its own change with its own e2e specs, after the port has landed. Doing both
   at once would leave nothing to compare against.

7. **New behaviour waits, or goes in TS.** During the port nothing new is written in `gp-core`. A
   feature waits until the module it touches is ported, and is then written in TypeScript.

8. **`crates/gp-pptx` stays Rust.** It is not the core: it is a program the desktop host runs to
   draw a PowerPoint deck with DeckCraft's libraries, which exist only in Rust
   (`docs/powerpoint-deckcraft.md`). It keeps its own workspace and the toolchain it pins.

9. **Native code where the React app cannot reach, as Capacitor plugins.** Not decided, only where
   it would go: an iPhone's external display or AirPlay as a second screen, App Intents and
   Shortcuts. The SwiftUI app has working code for the first (`ExternalOutput.swift`) to start from.

## What is kept

Nothing of the experiment is thrown away. The whole of it is on the branch this ADR lands on,
`claude/sweet-fermi-mz0n1t`, which joins its two ends:

| What | Commit | Branch it came from |
|---|---|---|
| The TS core before the swap: the port's starting point | `238d481b` | `claude/replace-csharp-with-rewrite` |
| The swap to the Rust core done | `5e153efb` | `claude/rust-core` |
| SwiftUI for the Mac and iOS, the TUI, the iPad 3 spike | `a23accde` | `claude/native-ios-058c37` |
| WinUI, as paused | `408628cd` | `claude/windows-winui-1593b1` |
| All of the above together, the last commit before this ADR | `bd90b93` | `claude/sweet-fermi-mz0n1t` |

To be tagged before anything is removed (`native-experiment-end` at `bd90b93`), so the work can be
read, built and taken from without depending on a branch staying.

## Consequences

- One language in the app again: one build without a WASM step, one debugger, the stack of Lars's
  other apps (ADR 0007).
- A feature is built once and tested once (the e2e suite in Electron), not once per GUI.
- The WASM (about 2 MB, 485 kB with brotli) leaves the web's and the Worker's bundle.
- The port is work: the TS core at `238d481b` covers the schema, the mutators, presenting, slides,
  search and sync's client, but 55 commits since then were written in Rust only (the sync driver,
  media and Bible-text plans, the settings' and the pages' views). The plan estimates and orders it.
- The phone app is the web app in Capacitor, with what that means for feel. That is the price of
  decision 1, chosen knowingly.
- What the experiment taught stays useful: the core/shell split and its effect boundary, parity
  checking against a reference, view models as data, and Rust itself for the one place it is needed
  (`gp-pptx`).
