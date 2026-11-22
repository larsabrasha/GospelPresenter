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

- [ ] 1 ↑↓ in the grid
- [ ] 2 Markera
- [ ] 3 Redigera
- [ ] 4 Noter och länkar
- [ ] 5 Lägg till, every kind
- [ ] 6 Mallar and Spara som mall
- [ ] 7 Utgångar
- [ ] 8 Fjärrstyrning
- [ ] 9 ⌘K
- [ ] 10 Phone lying down, moving on a phone

## Mac and iOS

- [ ] 1 ↑↓ in the grid
- [ ] 2 Markera
- [ ] 3 Redigera
- [ ] 4 Noter och länkar
- [ ] 5 Lägg till, every kind
- [ ] 6 Mallar and Spara som mall
- [ ] 7 Utgångar
- [ ] 8 Fjärrstyrning
- [ ] 9 ⌘K
- [ ] 10 Phone lying down, moving on a phone

## Linux

The Linux app is at its first milestone (docs/linux-app.md): what the Mac has and Linux does not comes first, as
the rounds above need it.

Its base, from docs/linux-app.md's "Not built":

- [ ] Signing in to a host and sync (the app opens a database file as the demo's caller now)
- [ ] Skapa presentation, the presentation's menu (Redigera detaljer, Radera)
- [ ] + with Sång and Programpunkt, an item's menu (Byt namn, Kommentar, Arrangemang, Överlägg, Lägg till efter, Radera)
- [ ] The description card; folding the columns
- [ ] The overlays in the live column
- [ ] Media files fetched; audio and video played
- [ ] Inställningar, every page the Mac has
- [ ] A phone's one column

The rounds:

- [ ] 1 ↑↓ in the grid
- [ ] 2 Markera
- [ ] 3 Redigera
- [ ] 4 Noter och länkar
- [ ] 5 Lägg till, every kind
- [ ] 6 Mallar and Spara som mall
- [ ] 7 Utgångar
- [ ] 8 Fjärrstyrning
- [ ] 9 ⌘K
- [ ] 10 Phone lying down, moving on a phone

## Questions

Where a choice was not clear, the one most like the web was taken and the question written here for Lars.

## Standing still

What failed three times, and where it stands.
