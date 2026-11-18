# View models in the core, so every shell behaves alike

Proposed and asked for by Lars on 2026-11-18, after the native iOS app (`docs/native-apps.md`) copied the web's flow
by hand; built the same day for the pages the native app has. The rest of the app follows as its pages are built
natively.

## The question

The core decides what the data is and what may change: the mutators and their checks, permissions (`rulesView`),
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
  the native app reads already (`apps/mac/texts.mjs`). The web still writes each key out where it draws an action, as
  `packages/architecture` wants every key written out, and takes from the core which actions there are and their state.
- **What stays a shell's**: layout and sizes, widgets and their platform's patterns (an alert on iOS, a dialog on the
  web), icons, animation, scrolling and when the list follows the shown slide, the navigation stack's mechanics,
  keyboard shortcuts' keys, and drawing slides (already one renderer, `SlideView`).

## Built (`crates/gp-core/src/page_models.rs`)

| View | What it decides | Proved by | Read by |
| --- | --- | --- | --- |
| `addPositionView` {order, shownId, lastAddedId, chosenId, selectedId} | the item + adds after, one rule for a computer and a phone: the item chosen; while presenting the last added while ahead of the shown, else the shown; before, the selected, else the last added (a phone has no selection) | random running orders against the TS `addAfter` at 238d481b where 2.0's rule holds (`parity/views/page-models.mjs`), unit tests where Lars changed it | web (`liveList.ts`), iOS (`Model.afterFor`) |
| `startPageView` {today} | the start page's lists: Idag by time, Kommande soonest first, the rest last changed first; which show a date and a year; each row's number of items; an empty list left out | 32 days against the TS `groupPresentations` and `itemCounts` at 238d481b; `packages/rust-core/test/page-models.test.ts` | web (`Presentations.tsx`), iOS (`Model.refresh`) |
| `presentationActionsView` {isTemplate, presenting, role} | the title menu: Redigera detaljer, Material (not for a template), Spara som mall (who may manage templates), the trash (not while presented) | unit tests (`page-models.test.ts`); the web's e2e specs of the menu | web (`PresentationEditor.tsx`), iOS (`PresentationScreen.titleMenu`) |
| `itemActionsView` {item, song, arrangements, overlays, shownId} | an item's menu: Byt namn (a programme item), Redigera (a song not in the trash, a custom slide), Redigera bilder, Kommentar; Arrangemang › (two or more, a song not in the trash) and Överlägg › (while there are overlays), not for a programme item; Lägg till efter ›, Ny programpunkt ovanför, Markera; Radera, disabled for the item on the outputs, black or not | unit tests; the scenario; the web's e2e specs of the menu; iOS's UI test | web (`ItemContextMenu.tsx`, a phone's `ItemSheet.tsx`), iOS (`ItemMenu`) |
| `rulesView`'s `fields` | a field's rule: required, and its most characters, for a presentation's name, an item's title and comment, a place and a description | `packages/rust-core/test/rules.test.ts` runs each field's mutator at its most, one over and empty, so the rule is what the mutator takes | web (`HeaderDialog.tsx`, `PresentationDetailsDialog.tsx`, `PresentationNameField.tsx`, `SaveAsTemplateDialog.tsx`), iOS (`TextPrompt`, `DetailsSheet`) |

`addPositionView` and `startPageView` had a TS function to port, so they are proved against it; the menus were JSX
conditions, so they are proved by unit tests of each condition and by the e2e specs that open the menus.

The web's computer and phone layouts differed in two rules; Lars chose on 2026-11-18 (docs/layout-2-0.md): + before
presenting adds after the selected item, else the last added, on both; and the item on the outputs cannot be removed
after Släck either, on both, as the scenario showed that → would then start the order over.

## Checked deterministically

1. **The core**, in `pnpm test` and `build.sh test`: the parity checks against the old TS core where it had the rule,
   unit tests of each rule, and scenarios (`packages/rust-core/scenarios`): a small organisation made by the mutators
   (`sunday.json`), presenting moved by its keys, and in each state (before, a slide shown, after Släck) what the core
   offers: the slide shown and marked, each item's menu, where + adds. The answers are `sunday.expected.json`, a file
   snapshot: a rule changed changes that file (`vitest -u`), read in the diff. They prove the core against what 2.0 is
   meant to do and outlive the reference (`docs/rust-core.md`, "Before 2.0 goes out", point 3).
2. **Each shell against the same answers.** iOS: `apps/mac/apple.sh uitest` (XCUITest, `apps/mac/ios/UITests`, about
   two minutes on a simulator) makes the scenario's organisation in the app (`-gp.fixture`), reaches each state as
   someone would (▶, a part tapped, Släck), opens each item's … and checks that the entries the app draws are those the
   core offers, enabled as it says, and that none it does not offer is there; found by their Swedish texts. Run when
   the app's Swift changes, not in every check. Made to fail once on purpose (Radera always enabled): it failed for the
   shown item, shown and black. The web: `apps/web/test/ItemMenus.test.tsx`, in `pnpm test` (under a second), draws
   the computer's … and a phone's sheet for each item in each state, in a DOM (happy-dom, Lars 2026-11-18), from the
   same organisation (`@gp/rust-core/scenarios` makes it), and checks the same three things. Made to fail on purpose
   twice (a phone's Radera always enabled; Byt namn drawn for every item): it failed where it should.
3. **The shells against each other** (not built, and not planned): the same scenario's accessibility snapshots
   compared between the web and iOS. Point 2 against one answer file catches nearly the same, more simply. Pictures are
   compared only within one shell, before and after a change (`docs/look.md`), never across shells, whose components
   differ on purpose.

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
