# Proposal: view models in the core, so every shell behaves alike

Not decided: a proposal for Lars (2026-11-18), after the native iOS app (`docs/native-apps.md`) copied the web's flow
by hand. Nothing here is built.

## The question

The core decides what the data is and what may change: the mutators and their checks, permissions (`rulesView`),
limits, every page's data (the views), presenting's keys (`presentingKeyView`). A differential check proves each shell
gets the same answers. How a page behaves around that data is the shells' own: which entries an item's menu has and
which are disabled, where Lägg till puts a new item, when Spara may be pressed, how the start page is grouped. The web
has that in React; the native app now has it again in Swift, read off the web's code and pictures. Nothing checks that
the two agree, and they already do not:

| Rule | The web | The native app |
| --- | --- | --- |
| Where + adds while presenting (`addAfter`, `apps/web/src/live/liveList.ts`) | the item chosen in a menu, else the last added while still ahead of the shown, else the shown, else the selected | after the shown item, else at the end |
| An item's menu (`apps/web/src/pages/live/ItemContextMenu.tsx`) | Redigera for a song, pictures for a picture item, Arrangemang only for a song not in the trash with two or more, Överlägg when there are overlays, Markera | a subset, the song-in-the-trash case missing |
| The start page's lists (`groupPresentations`, `apps/web/src/pages/dashboard.ts`) | in TypeScript | the same rules again in Swift |
| Spara in a name's dialog (`HeaderDialog.tsx`) | disabled while empty, a comment excepted | the same, written again |

Each is small; together they are the flow, and every new shell (Android, MCP, a CLI) would write them a third time.

## The proposal

What a page offers, and in what state, is worked out in the core as a view model; the shells draw it with their own
components and say nothing of their own about it. The same split as Crux's (`docs/rust-core.md`, "What else was
weighed"): the core answers "what is on this screen and what can be done", the shell answers "how it looks and moves".

- **Actions, not only data.** A view returns the actions a thing has, in their groups and order, each with its id, its
  text's key (`i18n.ts`'s, with its values), whether it is enabled and, if not, why (a key). For example
  `itemActionsView {presentationId, itemId, shown}` → `[{group: "open", actions: [{id: "rename", text: "header.rename",
  enabled: true}]}, …, {group: "remove", actions: [{id: "delete", text: "live.shownCannotRemove", enabled: false}]}]`.
  The shells map an id to what it does (a sheet, a mutation); which ids exist and when is the core's.
- **Rules that are now a page's.** `addPositionView` (`addAfter`), `startPageView {today, liveId}` (the groups, with
  which rows show a date and a year), `fieldView` (a field's rule: required, its limit, the refusal's key, from the same
  checks `args.rs` makes when the mutator runs), and the presentation's title menu (`presentationActionsView`: no
  Radera while presented, no ▶ for a template).
- **Texts by key.** Views never return words, only `i18n.ts`'s keys and their values; `apps/web/src/i18n.ts` stays the
  one table, which the native app reads already (`apps/mac/texts.mjs`).
- **What stays a shell's**: layout and sizes, widgets and their platform's patterns (an alert on iOS, a dialog on the
  web), animation, scrolling and when the list follows the shown slide, the navigation stack's mechanics, keyboard
  shortcuts' keys, and drawing slides (already one renderer, `SlideView`).

## Checked deterministically

1. **Scenarios against the core**, in `build.sh test` with the rest: a scenario is a JSON file of events (a mutation,
   a presenting key, a view asked with its arguments) and the view models expected after each. Golden files, no UI;
   the same run proves the rules for every shell at once. The differential checks prove the core against the old TS
   core; these prove the core against what 2.0 is meant to do, and outlive the reference (`docs/rust-core.md`, "Before
   2.0 goes out", point 3).
2. **Each shell against the view models**: a test per shell feeds a view model from the same fixtures and checks what
   it draws through its accessibility tree (role, text, enabled), not its pixels: Playwright or Testing Library on the
   web, XCUITest on iOS, the action's id as the element's identifier. A shell that drops an action, renames it or
   leaves it enabled fails.
3. **The shells against each other**: the same scenario's accessibility snapshots, normalised (roles mapped, layout
   ignored), compared between the web and iOS. Pictures are compared only within one shell, before and after a change
   (`docs/look.md`), never across shells, whose components differ on purpose.

## Cost and order

Each view model is a step of the loop in `docs/rust-core.md`: write it in the core, check it with scenarios, switch the
web to read it (the e2e specs that reach the page unchanged), switch the native app. In order of what already differs:
`addPositionView`, `itemActionsView`, `startPageView`, `fieldView`, `presentationActionsView`; later every page's menus
and buttons as they are built natively. Each is a change to the core and the web, so each waits for Lars.

What it costs: more views over the bridge (small JSON, read when a menu opens), the web's components reading actions
instead of deciding them, and some rules moving out of React. What it does not do: make the shells look alike, which
they should not, or decide navigation, which stays each platform's.

Prior art: Crux (Red Badger), whose core returns a view model and whose shells only draw it; Kotlin Multiplatform's
shared view models; Mozilla's application-services share the logic but not the view models, and their shells drift in
just these ways.
