# The native apps' parity with the web

Asked by Lars on 2026-11-22: the Mac, iOS and Linux apps do all the web and the Electron app do, without him. The
reference is the web app (`apps/web`) and the Electron shell (`apps/desktop`) of this line of work; the web's code is
the confirmation of an edge case, so AGENTS.md's rule of having them confirmed does not apply to these rounds.

A round is one page or one flow on all three platforms: the rule in the core with its test first
(`crates/gp-core`), then Swift (`apps/mac`, Mac and iOS) and GTK (`apps/linux`). A round is done when the core's
tests, `pnpm check:quick`, the e2e specs it reaches, a UI test for Mac/iOS (`apps/mac/apple.sh uitest`) and
pictures from Linux (`apps/linux/docker.sh shoot`) pass, and `/code-review` has been answered; then it is
committed on its own branch, not pushed.

Legend: `[x]` done and checked as above, `[~]` done with a known gap (said on the line), `[ ]` not done.

## The rounds

Each is what docs/native-apps.md lists as not built in a presentation, in the order they are taken. The core's part
is shared; each platform's part is checked off in its own section below.

1. **↑↓ in the grid**: ↑ and ↓ move to the slide above and below as the tiles stand (the web's `slideGridNav.ts`,
   `slideAcross`), not as → and ←.
2. **Markera** (an item's `tick`): an item ticked off in the running order (the web's ItemContextMenu, `presentation.tick`).
3. **Redigera**: an item's menu opens the song's page (a song, `edit`), the slideshow's editor (`custom`) or the
   pictures (`editImages`), and returns to the presentation.
4. **Noter och länkar** (`materials`): the presentation's menu shows its songs' notes and links
   (the web's `PresentationMaterials.tsx`, `MaterialViewer.tsx`).
5. **Lägg till, every kind**: + and Lägg till efter offer Sång, Bibel, Bild, Ljud, Video, Bildspel and Programpunkt
   (`addKinds`), each the web's tab (`SongTab`, `BibleTab`, `ImageTab`, `AudioTab`, `VideoTab`, `SlidesTab`); the
   Bible tab with its translation, book, chapter and verses and its search.
6. **Mallar and Spara som mall**: the templates' page (list, open, rename, delete, a presentation made from one) and
   Spara som mall in the presentation's menu (`SaveAsTemplateDialog.tsx`, `Templates.tsx`).
7. **Utgångar** in a presentation: the live column's outputs (the output window, the saved screens, the sound's
   output) switched there (the web's `OutputsPanel.tsx`, `useOutputs.ts`).
8. **Fjärrstyrning, both ways**: a native app drives a session presented elsewhere, and is driven from elsewhere
   (`remoteCommandView`, `remotePointerView`, `remoteTakeView`; the web's `RemotePanel.tsx`, `live/remote.ts`,
   `live/owner.ts`).
9. **⌘K**: the command palette, searching everything and going anywhere (the web's `CommandPalette.tsx`).
10. **A phone lying down and moving on a phone**: two columns on a phone on its side, and an item moved in the
    running order on a phone (the web's `phone/`).

## Core

- [x] 1 ↑↓ in the grid: `slideAcrossView` (crates/gp-core/src/grid_nav.rs, 12 tests); the web reads it
- [x] 2 Markera: `tickView` (crates/gp-core/src/ticking.rs, 18 tests); the web's RunningOrder reads it
- [x] 3 Redigera: `itemActionsView`'s `opens` says where Redigera leads (a song's page, a custom slideshow's editor,
  an image item's pictures; 3 tests in packages/rust-core/test/page-models.test.ts); the web reads it (`editRoute`)
- [x] 4 Noter och länkar: `presentationMaterialsView` (crates/gp-core/src/song_page.rs; 4 tests in
  packages/rust-core/test/views.test.ts); the web's PresentationMaterials reads it
- [x] 5 Lägg till, every kind: `bibleBrowseView` (the Bible tab's browse, crates/gp-core/src/bible_browse.rs, 9 tests)
  and `addPickView` (a library's pick and the command that adds it, add_pick.rs, 10 tests); the web's BibleTab and
  ImageTab read them
- [x] 6 Mallar and Spara som mall: `templateView` (a template's slot and next date, crates/gp-core/src/template_view.rs,
  8 tests) and `templatesView`'s `recent` (the picker's ten last used, 2 tests in views.test.ts); the web's
  templates.ts and recentTemplates read them
- [~] 7 Utgångar: `shownOnOutputsView` (what a session's public outputs and screens get, live_report.rs, 12 parity
  cases against the TS it replaced) and `outputRowsView` (Utgångar's rows and the take-over question, 5 tests); the
  web's owner.ts and useOutputs.ts read them. Left: the shells' live socket as owner (below)
- [ ] 8 Fjärrstyrning
- [x] 9 ⌘K: `paletteView`, the presentations a search finds (name, place, the date as the shell writes it), the
  coming first, a few (crates/gp-core/src/palette.rs; 4 tests in views.test.ts); the web's CommandPalette reads it
- [x] 10 Phone lying down: `pageLayoutView` (columns from 1 000 points, else one column, and lying down while
  presenting the picture at the right, 45 %; crates/gp-core/src/page_layout.rs, 5 tests). The web keeps its CSS
  (`lg` and `landscape:`), which says the same; moving is reorderItems as before

## Mac and iOS

- [~] 1 ↑↓ in the grid: the tiles' places from `SlideGridLayout.tiles`; `GridKeysTests` on an iPad 13" (↓ to the
  slide under, ↑ back, → still the next). Gap: the keys are pressed through `-gp.keys` into the grid's own handler, as
  XCUITest's typeKey reaches only the on-screen keyboard on iOS; a hardware key reaching the grid is not tested (nor
  on the Mac, where no UI test runs). Seen: MenuTests fails on that iPad when it scrolls to Släck, not on the iPhone;
  not looked into
- [x] 2 Markera: in the item's menu; in columns the running order ticks in place, on a phone a sheet; ⇧-click a
  range on the Mac. `TickTests` (4) on an iPhone 17 Pro Max and an iPad 13"; MenuTests with Markera drawn. No toast
  after removing (the native apps have none); ⇧-click not tried (no Mac UI test)
- [x] 3 Redigera: in a sheet over the presentation, closed back to it: the song's page, the slideshow's editor
  (Inställningar's own), an image item's pictures (moved, removed after a question; ItemEditing.swift). `EditTests`
  (3) and MenuTests with Redigera drawn on an iPhone 17 Pro Max. Not yet: adding more pictures (round 5); a move of a
  picture not tried in a test
- [x] 4 Noter och länkar: in the presentation's menu, a sheet of the songs' materials; a link opens in the browser, a
  file in Quick Look (PresentationMaterials.swift). `MaterialsTests` on an iPhone 17 Pro Max with its own data
  (UITests/materials.json). Not tried: a file opened from it
- [~] 5 Lägg till, every kind: + and Lägg till efter offer every kind; Bibeltext (BibleSheet.swift: search, browse,
  the slides previewed, a translation not kept fetched for the sheet), Bild, Ljud, Video, Bildspel (AddSheets.swift,
  Importera for files; Redigera bilder's + adds to the item). `AddTests` (4) on an iPhone 17 Pro Max, with a sample
  translation in UITests/adding.json (the fixture loader's `importBibleZip`). Gaps: the library sheets keep iOS's
  search, which hides the bar's Lägg till while typing (as Lägg till sång's does); several pictures at once not tried
  in a test (the demo has one; the core's test covers the title); a translation fetched from a host not tried
- [x] 6 Mallar and Spara som mall: Skapa presentation offers a blank one or a template (its name, next date, time and
  place, a copy of its items); Mallar in the account menu and the picker's Hantera mallar (list with the slot, Skapa
  mall, a template opened as a page with its own details and Radera mall); Spara som mall in a presentation's menu
  (Templates.swift). `TemplatesTests` (4) on an iPhone 17 Pro Max with UITests/templates.json. Not tried: a
  template's Redigera detaljer in a test
- [ ] 7 Utgångar
- [ ] 8 Fjärrstyrning
- [x] 9 ⌘K: anywhere a window is (a hidden ⌘K button) and the start page's magnifier (Palette.swift): the open
  presentation's likeliest actions, songs (their page; in a presentation Lägg till, shown while presenting),
  presentations, the commands (Gå till … and Ny sång open Inställningar there), Inställningar's pages.
  `PaletteTests` (3) on an iPhone 17 Pro Max, opened by `-gp.palette` where the test cannot press ⌘K. Gaps: no ↑↓ and
  ↵ through the hits, no preview beside them, no ⌘↵; ⌘K by a hardware keyboard not tried
- [x] 10 Phone lying down, moving on a phone: lying down while presenting, the running order at the left and the
  picture with Släck under it at the right (PhoneLayout.swift from `pageLayoutView`, which also decides columns);
  in Markera's select mode a row is held and moved (Ticking.swift). `PhoneTests` (3) on an iPhone 17 Pro Max, a
  picture of it lying down looked at. Not tried: an iPad mini lying down (columns by the core's 1 000 points)

## Linux

The Linux app is at its first milestone (docs/linux-app.md): what the Mac has and Linux does not comes first, as
the rounds above need it.

Its base, from docs/linux-app.md's "Not built":

- [ ] Signing in to a host and sync (the app opens a database file as the demo's caller now)
- [~] Skapa presentation (round 6); the presentation's menu's Redigera detaljer not built
- [x] + with Sång and Programpunkt (round 5)
- [~] An item's menu: Byt namn, Kommentar, Arrangemang, Överlägg, Markera, Radera (2026-11-22, pictures of the menu);
  Lägg till efter waits for adding. Byt namn, Kommentar, Arrangemang and Överlägg not tried in pictures
- [ ] The description card; folding the columns
- [ ] The overlays in the live column
- [ ] Media files fetched; audio and video played
- [ ] Inställningar, every page the Mac has
- [ ] A phone's one column

The rounds:

- [x] 1 ↑↓ in the grid: `Page::placed` measures the tiles; pictures (light) of ↓ from slide 1 to 4 and back
- [x] 2 Markera: a check on each row (GNOME's selection mode); pictures light and dark of Markera from the row's
  menu, a second ticked, the question for 2, both removed. ⇧-click a range not tried
- [~] 3 Redigera: an image item's pictures in a dialog (moved up or down, removed after a question; image_items.rs),
  pictures light and dark of the menu, the dialog, the question and the picture gone. Gap: Redigera of a song or a
  custom slideshow is left out of the menu until the Linux app has a song's page and a slide editor (its base,
  Inställningar)
- [x] 4 Noter och länkar: the presentation's menu at last (its title a menu button, GNOME's popover menu from
  `presentationActionsView`: Noter och länkar, Radera presentation asked first; presentation_menu.rs), the materials
  in a dialog, a link opened by the desktop's browser. Pictures light and dark of the menu, a song's link and the
  empty page. Not tried: a link opened (no browser in the image), Radera presentation in pictures; a file is listed
  but not opened (media files are the base's)
- [~] 5 Lägg till, every kind: Lägg till under the running order and Lägg till efter › in an item's menu, the kinds
  from `pageButtonsView` (adding.rs): Sång (searched), Programpunkt (named), Bibeltext (adding_bible.rs: searched,
  browsed with crumbs, the slides painted), Bild, Ljud, Video, Bildspel (picked from the library). Pictures light and
  dark of the kinds, Joh 3:16 searched and added, 3:16–18 browsed, a song and a picture added. Gaps: no Importera (the
  app has no media files of its own yet), a translation not kept on this device is not offered (no sync), more than
  500 verses are cut without the question
- [x] 6 Mallar and Spara som mall: + on the start page at last (templates.rs: blank or a template, the details
  prefilled, made and opened), Mallar in the header's menu (list with the slot, Skapa mall opened as a page, Radera
  mall in its menu), Spara som mall in a presentation's menu. Pictures light and dark of the details, Mallar, Skapa
  mall, a template's page and menu, the picker with it, a presentation made from it. Gaps: the date and time are typed
  as text (no pickers), a template's Redigera detaljer is not built (the details dialog is the base's)
- [ ] 7 Utgångar
- [ ] 8 Fjärrstyrning
- [~] 9 ⌘K as Ctrl+K on every page (palette.rs): the presentation's likeliest actions, + 's kinds by their words,
  songs added to the open presentation, presentations found and opened. Pictures light and dark of the blank
  search, a song found and added, a presentation found and opened. Gaps: no song page nor Inställningar to go to
  (the Linux app has neither), no ↑↓ ↵ through the hits
- [ ] 10 Phone lying down, moving on a phone: waits on the base's "A phone's one column" (the Linux app has only
  columns); on a computer an item moves by Alt+↑ ↓ (the core's `move`)

## Questions

Where a choice was not clear, the one most like the web was taken and the question written here for Lars.

- Round 3, the web's Redigera bilder: removing or moving a picture sends its place among the pictures shown
  (ItemParts.tsx `index: i`), but the mutators (`removeItemImage`, `moveItemImage`) count the item's own list, which
  keeps a picture whose file is gone. With one gone before it, the web removes the wrong picture (the demo's
  swish.jpg: ✕ on the one shown removes the gone one). The native apps send the place from the slide's key
  (`image{n}`). Should the web do the same? Not changed, as it changes the web's behaviour.

## Seen in passing, not this list's

- The Linux app shows an item's problem by its raw key (`song-trashed`) instead of its text
  (`presentation.songTrashed`); presentation.rs passes the problem to `t` as if it were a key.

## Standing still

What failed three times, and where it stands.
