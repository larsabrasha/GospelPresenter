# View models in the core, so every shell behaves alike

> Since ADR 0008 one shell, the React app. The views the native shells alone read went with them (the list in
> `docs/core-back-to-typescript.md`, "Not ported"); the rest are `packages/core/src/views/`, and may move into the
> web where that is simpler (step 5 there).

Proposed and asked for by Lars on 2026-11-18, after the native iOS app (`docs/native-apps.md`) copied the web's flow
by hand; built the same day for the pages the native app has. The rest of the app follows as its pages are built
natively.

## The question

The core decides what the data is and what may change: the mutators and their checks, permissions (`can`),
limits, every page's data (the views), presenting's keys (`presentingKeyView`). A differential check proves each shell
gets the same answers. How a page behaves around that data was the shells' own: which entries an item's menu has and
which are disabled, where Lägg till puts a new item, when Spara may be pressed, how the start page is grouped. The web
had that in React; the native app had it again in Swift, read off the web's code and pictures, and they did not agree:
where + adds while presenting, the menu of a song in the trash, the start page's grouping written twice, Spara's rule
written twice. Every new shell (Android, MCP, a CLI) would write them a third time.

## What it is

What a page offers, and in what state, is worked out in the core as a view model; the shells draw it with their own
components and say nothing of their own about it. The same split as Crux's (`docs/rust-core.md`, "What else was
weighed"): the core answers "what is on this screen and what can be done", the shell answers "how it looks and moves".

- **Actions, not only data.** A menu's view returns its groups in order, each a list of actions: an id, its text's key
  (`i18n.ts`'s), whether it is enabled, whether it is destructive, and a submenu's choices with the one chosen. The
  shells map an id to what it does (a sheet, a mutation) and its icon; which ids exist and when is the core's. A shell
  that has not built an action yet leaves that id out, and says so where it draws the menu.
- **Texts by key.** Views never return words, only `i18n.ts`'s keys; `apps/web/src/i18n.ts` stays the one table, which
  the native app reads already (apps/mac/texts.mjs (at the tag native-experiment-end)). The web still writes each key out where it draws an action, as
  `packages/architecture` wants every key written out, and takes from the core which actions there are and their state.
- **State in three places, each changed only by the core** (Lars, 2026-11-18). The data is the database's, changed
  by the mutators. The app's live state, one for every window of a device (which presentation is presented, its
  slide, black, the overlay), is changed only by `liveChangeView` (`crates/gp-core/src/live_state.rs`): one
  presentation presented at a time, and the overlays' rules; the web's windows keep copies alike over their channel
  (`live/live.ts`, the newer by `rev`), the native app has one (`AppState`, under every window's `Model`; each window
  of an iPad or a Mac its own Model, `InWindow`). A page's own state, one per window (the item selected,
  the slide made ready, the last thing added, a number typed), is changed only by `pageEventView`
  (`crates/gp-core/src/page_state.rs`), a reducer: the shell holds the state, sends an event (a key, a tap, a row
  chosen, an addition) and gets back the new state, a change to the live state, and a command to carry out (a scroll,
  a dialog, a mutation). The organisation's live sessions on the server, for remote control, are a fourth thing,
  the server's.
- **A page read again is an event, never a new page** (Lars, 2026-11-19: the iPad's slides jumped to the top at every
  change made on the Mac). When a change made here or one a sync brought reads a page again, the shell keeps the page
  and its state and sends `changed` {itemIds: the items on the screen, the top first}; the core lets go of what the
  state names and the page no longer has, and answers `{"type": "stay", itemId}`: the first of those items still
  there, which the shell keeps where it stood on the screen though items above it grew, shrank or went (null: none
  is left, and the slides stay where they stand). The iPad 3 spike did so (spike/ios8-ipad3/app/Live.m, in git's history); the web
  and the native app do not send `changed` yet.
- **What stays a shell's**: layout and sizes, widgets and their platform's patterns (an alert on iOS, a dialog on the
  web), icons, animation, scrolling and when the list follows the shown slide, the navigation stack's mechanics,
  which physical key is which event, which slide stands above another in a grid (↑ ↓; the shell sends the slide),
  where the focus is (whether ↵ is the page's), how long a typed number waits, and drawing slides (already one
  renderer, `SlideView`).

## Built (`crates/gp-core/src/page_models.rs`, `live_state.rs`, `page_state.rs`)

| View | What it decides | Proved by | Read by |
| --- | --- | --- | --- |
| `addPositionView` {order, shownId, lastAddedId, chosenId, selectedId} | the item + adds after, one rule for a computer and a phone: the item chosen; while presenting the last added while ahead of the shown, else the shown; before, the selected, else the last added (a phone has no selection) | random running orders against the TS `addAfter` at 238d481b where 2.0's rule holds (`parity/views/page-models.mjs`), unit tests where Lars changed it | web (`liveList.ts`), iOS (`Model.afterFor`) |
| `startPageView` {today} | the start page's lists: Idag by time, Kommande soonest first, the rest last changed first; which show a date and a year; each row's number of items; an empty list left out | 32 days against the TS `groupPresentations` and `itemCounts` at 238d481b; `packages/core/test/node/page-models.test.ts` | web (`Presentations.tsx`), iOS (`Model.refresh`) |
| `presentationActionsView` {isTemplate, presenting, role} | the title menu: Redigera detaljer, Material (not for a template), Spara som mall (who may manage templates), the trash (not while presented) | unit tests (`page-models.test.ts`); the web's e2e specs of the menu | web (`PresentationEditor.tsx`), iOS (`PresentationScreen.titleMenu`) |
| `itemActionsView` {item, song, arrangements, overlays, shownId} | an item's menu: Byt namn (a programme item), Redigera (a song not in the trash, a custom slide), Redigera bilder, Kommentar; Arrangemang › (two or more, a song not in the trash) and Överlägg › (while there are overlays), not for a programme item; Lägg till efter › (nothing above: Lars, 2026-11-18), Markera; Radera, disabled for the item on the outputs, black or not | unit tests; the scenario; the web's e2e specs of the menu; iOS's UI test | web (`ItemContextMenu.tsx`, a phone's `ItemSheet.tsx`), iOS (`ItemMenu`) |
| `liveChangeView` {pointer, change, overlays}, `followItemOverlayView` | the app's live state: a change numbered after the last, the overlays' rules, a start refused while another presentation is presented | 6 000 random changes and 3 000 overlays changed against 2.0's `applyLiveChange` and `followItemOverlay` (`parity/views/live-state.mjs`), every start over another refused; `packages/core/test/node/live-state.test.ts` (the TS tests moved there) | web (`live/live.ts`, `live/owner.ts`), iOS (`Live.set`) |
| `pageEventView` {state, context, order, event}, `pageModelView` | a page's own state and what each key, tap and row does to it: ← → ↑ ↓ PageUp PageDown Space ↵ Escape b . a Delete digits ⌘↑ ⌘↓ ⌥↑ ⌥↓ F5 ⌘., a slide tapped, a row chosen, an addition, the page read again (`changed`, the item that stays); ▶ offered; the cue over the live picture | `packages/core/test/node/page-state.test.ts` (30 tests); the scenario's keys in each state; the web's e2e specs of the keys (keyboard, live-order, phone, journeys) | web (`live/pageState.ts`, `useEditorKeys.ts`, the computer's page and the phone's), iOS (`Model.send`) |
| `detailsDialogView` {isNew} | a presentation's details dialog: its title, its fields in their groups in order (the theme only for one there), its buttons in order with their texts and roles (Avbryt; Skapa, Skapar…, or Spara) | unit tests (`page-models.test.ts`); the web's e2e specs that make and edit presentations | web (`PresentationDetailsDialog.tsx`), Mac and iOS (`DetailsSheet`, whose bar draws the core's texts: on a Mac as buttons with them, on iOS 26 as the system's × and ✓ named by them) |
| `FIELD_RULES` (the web reads it directly since step 5 of `docs/core-back-to-typescript.md`; it was `rulesView`'s `fields`) | a field's rule: required, and its most characters, for a presentation's name, an item's title and comment, a place and a description | `packages/core/test/node/rules.test.ts` runs each field's mutator at its most, one over and empty, so the rule is what the mutator takes | web (`HeaderDialog.tsx`, `PresentationDetailsDialog.tsx`, `PresentationNameField.tsx`, `SaveAsTemplateDialog.tsx`), iOS (`TextPrompt`, `DetailsSheet`) |

Inställningar (Lars, 2026-11-21: settings in the native app, `crates/gp-core/src/settings_models.rs`,
`settings_pages.rs`):

| View | What it decides | Proved by | Read by |
| --- | --- | --- | --- |
| `settingsListView` {role, host}, `settingsSearchView` {role, host, query, texts}, `settingsSearchKeysView` | Inställningar's groups and rows: who sees which (the permission each needs, Enheter on a host only), each row's text, icon, colour and intro; the search over names and other words (the shell gives the words of the keys, as the core holds none) | Rust tests (`settings_models_tests.rs`); `apps/web/test/settingsLinks.test.ts` against the web's old expectations, and that the core names only texts the web writes out | web (`settingsLinks.ts`), Mac and iOS (`Settings.swift`) |
| `mySettingsView` {role, superAdmin, desktop, email, emailConfirmed, mail} | Mina inställningar's groups and rows in order: Bekräfta e-post only for an unconfirmed address where the server mails, Superadminläge only for a Superadmin, Slå på utgångar automatiskt only in the desktop app | Rust tests | Mac and iOS (`SettingsMine.swift`); the web not yet |
| `trashPageView` {role, now, kind?, query?} | the trash: the kinds a role manages, newest deletion first, days left, the mutators that restore and purge each, the tabs, whether to purge what expired | Rust tests | Mac and iOS (`SettingsTrash.swift`); the web not yet (Trash.tsx has the same rules) |
| `ccliPageView` {locale, filter, keep}, `themesPageView` {role} | the CCLI report's cards and filter; Teman's order, default and each theme's actions | the same | Mac and iOS; the web not yet (the TS core has no `themesPageView`: no shell read it) |
| `libraryPageView` {kind, role, host?} | what each of Inställningar's lists can do (Lars, 2026-11-21): a `collection` or a list of `pages`, what a row `opens`, the + and the action beside it, whether rows may be picked and which (`pickOnly`), the actions for the picked rows and a row's menu (with the row's field one needs, `when`); how a platform does each is the shell's (docs/native-apps.md, "Each platform's own patterns") | Rust tests (`library_pages_tests.rs`) | Mac and iOS (`Settings*.swift`), the web (`ui/Library.tsx` and its pages) |
| `freshNameView`, `displayCodeView`, `labelColoursView`, `mediaImportView`, `storageLimitsView`, `bibleImportTextView` | a new thing's name; an output's code from random bytes; a label's swatches; what an import takes and how a picture is fitted; Lagring's limits; a Bible zip as the text and hash a shell keeps | the same, and `bible-import.test.ts` against the TS `serializeBibleText`, `bibleTextHash`, `bibleId` | Mac and iOS; the web reads `freshNameView` (`justCreated.ts`) |

The editors and the rest of Inställningar (the same day, `theme_editor.rs`, `slide_editor.rs`, `image_edit.rs`,
`org_transfer.rs`, `settings_pages.rs`): `themeEditorView`/`themeEditView`, `slideEditorView`/`slideEditView`/
`slideHitView`/`editorSlideView`, `imageEditView`/`imageDrawView` (proved against the web's `imageEdit.ts` and
`CropFrame.tsx` on 500 random pictures, imageEditCore.test.ts at the tag native-experiment-end), `libraryOrderView`, `deckImportView`,
`deckPagesView`, `videoImportView`, `displayStatusView`, `exportPlanView`, `importManifestView`, `importPlanView`;
`userRulesView` (what Användare and Enheter offer before pressing, proved against accounts.ts on every case,
user-rules.test.ts (at the tag native-experiment-end)), `autoOutputsView` (Slå på utgångar automatiskt on the Mac, proved
against the web's `displaysToTurnOn` and useAutoOutputs's step, autoOutputsCore.test.ts at the tag native-experiment-end), `mediaStorageView` taking a folder's files (`held`) for Lagring;
`songListView` gained letter sections, the sort by author and `index` (the letters at the edge), `songHistoryPageView` {id, today, yesterday} groups the
versions by day, and `slideEditView`'s `insert` pastes a copied element under a new id; Rust tests of each, and `parity settings` against a real server. The web still decides these in its own TS; switching
it to them is not done.

`addPositionView` and `startPageView` had a TS function to port, so they are proved against it; the menus were JSX
conditions, so they are proved by unit tests of each condition and by the e2e specs that open the menus.

The web's computer and phone layouts differed in two rules; Lars chose on 2026-11-18 (docs/layout-2-0.md): + before
presenting adds after the selected item, else the last added, on both; and the item on the outputs cannot be removed
after Släck either, on both, as the scenario showed that → would then start the order over.

## Checked deterministically

1. **The core**, in `pnpm test` and `build.sh test`: the parity checks against the old TS core where it had the rule,
   unit tests of each rule, and scenarios (`packages/rust-core/scenarios`): a small organisation made by the mutators
   (`sunday.json`), presenting moved by its keys, and in each state (before, a slide shown, after Släck) what the core
   offers: the slide shown and marked, each item's menu, where + adds, whether ▶ may start there and in another
   presentation (one at a time), and the page's state after a run of keys. The answers are `sunday.expected.json`, a file
   snapshot: a rule changed changes that file (`vitest -u`), read in the diff. They prove the core against what 2.0 is
   meant to do and outlive the reference (`docs/rust-core.md`, "Before 2.0 goes out", point 3).
2. **Each shell against the same answers.** iOS: `apps/mac/apple.sh uitest` (XCUITest, `apps/mac/ios/UITests`, about
   two minutes on a simulator) makes the scenario's organisation in the app (`-gp.fixture`), reaches each state as
   someone would (▶, a part tapped, Släck), opens each item's … and checks that the entries the app draws are those the
   core offers, enabled as it says, and that none it does not offer is there, found by their Swedish texts; then, the
   Sunday still presented, that the evening meeting's ▶ is offered as the core says (not). On an iPad
   (`apple.sh uitest "iPad Pro 13-inch (M5)"`) also `WindowsTests`: the Sunday opened from a second window's start
   page brings forward the first window that has it, its slide made ready there (made to fail once on purpose, the
   rule left out: the second window opened a page of its own). Run when
   the app's Swift changes, not in every check. Made to fail once on purpose (Radera always enabled): it failed for the
   shown item, shown and black. The web: ItemMenus.test.tsx (gone in step 5 of `docs/core-back-to-typescript.md`, the
   menu now the web's, `apps/web/test/itemMenu.test.ts`), in `pnpm test` (under a second), drew the computer's … and a
   phone's sheet for each item in each state, in a DOM (happy-dom, Lars 2026-11-18), from the same organisation, and
   checked the same three things. Made to fail on purpose
   twice (a phone's Radera always enabled; Byt namn drawn for every item): it failed where it should. The keys are
   checked in the web by its e2e specs (keyboard, live-order), not yet against the scenario's answers in a shell test;
   iOS sends the same events, from its own keys, unchecked by a test.
3. **The shells against each other** (not built, and not planned): the same scenario's accessibility snapshots
   compared between the web and iOS. Point 2 against one answer file catches nearly the same, more simply. Pictures are
   compared only within one shell, before and after a change (`docs/look.md`), never across shells, whose components
   differ on purpose.

## Ids

Every button and action a view lays out has an id of the core's (`pageButtonsView`'s `back`, `start`, `end`, `new`,
`add`, `fold`, `black`; `presentationActionsView`'s and `itemActionsView`'s entries; Inställningar's `libraryPageView`
`add`, `extra`, `picked` and `row`, `themesPageView`'s actions and `mySettingsView`'s rows), and each shell names its control
by it (Lars, 2026-11-21): SwiftUI's `accessibilityIdentifier`, the web's `data-testid`, WinUI's `AutomationId`, GTK's
accessible id. A test, or an assistive tool, then finds the same button on every platform. A choice under a button is
named by both, `add.song` (or `addAfter.song` under the item menu's Lägg till efter); a column's fold and its way back
by the column's place, `runningOrder.fold`, `liveColumn.unfold`. Rows of a list are named by their data's id, not by
these. For the Mac and iOS app, packages/architecture/test/action-ids.test.ts (at the tag native-experiment-end) checks only this much: a Swift file that
reads one of those views sets an identifier somewhere (it does not see a second control left unnamed), and `back`,
`new`, `add` and `black` are each set by name. The web's controls are not named by them yet.

## Next

Each further view model is a step of the loop in `docs/rust-core.md`: write it in the core, check it, switch the web to
read it (the e2e specs that reach the page unchanged), switch the native app, and add the page's states to a scenario.
In the order the native app builds pages: the song's page, the library's menus. The core decides what can be done;
layout, icons, focus, scrolling, animation, what is selected and keyboard shortcuts stay each shell's. The cost is more views over the bridge (small JSON, read when a menu opens) and the web's components reading
actions instead of deciding them; it does not make the shells look alike, which they should not, or decide
navigation, which stays each platform's.

Prior art: Crux (Red Badger), whose core returns a view model and whose shells only draw it; Kotlin Multiplatform's
shared view models; Mozilla's application-services share the logic but not the view models, and their shells drift in
just these ways.
