# PowerPoint shown as itself, through DeckCraft's libraries

Decided (Lars, 2026-11-20): build step 1 below, the clicks as stills; the animations (step 2) after it. Until now a
slideshow came in only as a PDF the church exports from PowerPoint or Keynote (the decision of 2026-10-28, which this
changes: PDF stays as the fallback, for charts above all). The probes behind the measurements were spike/pptx-deckcraft, in git's history (removed on 2026-11-24). This adds a `.pptx` item whose slides, their builds click
by click and, optionally, their animations show on every device, drawn by DeckCraft's libraries when the file is
added; no DeckCraft app, and no PowerPoint, on any device.

## DeckCraft

[DeckCraft](https://github.com/storytold/deckcraft) (MIT or Apache-2.0) is written in Rust from the ECMA-376 standard:
`deckcraft-pptx` reads and writes `.pptx`, `deckcraft-anim` works out each shape's state at any moment of a show
(`Timeline::state`), `deckcraft-render` draws slides with vello_cpu, a shape's animation state included
(`RenderOpts.state`), and draws the backdrop and the content apart (`render_slide_part`). Version 0.19, marked in
development. It needs Rust 1.95 or newer: the repository is held at 1.100.0 by `rust-toolchain.toml` (2026-11-20);
its crates come from git at pinned commits, not crates.io.

## Step 1, built (2026-11-20): the desktop host draws the clicks

- **`crates/gp-pptx`**: `pages(pptx)` reads the deck and draws every slide shown, at every click of its builds, to a
  JPEG fitting 1920×1080 and a thumbnail fitting 400×225 (`IMAGE_VARIANTS`), a hidden slide left out; `charts` says
  whether a slide shown has a chart. Its program `gp-pptx DECK OUT MAX` writes them and prints what it wrote, and
  stops at MAX pages (exit 3). A Cargo workspace of its own, so the core's builds never fetch DeckCraft, from git at
  a pinned commit; 5.7 MB stripped; the fixture deck (`fixtures/make_deck.py`) in under a second. A Mac release
  builds it for arm64 and x64 and joins them (lipo), as its packages are both.
- **The desktop host** builds the program beside its bundle (`apps/desktop/build.mjs`; `electron-builder.yml` puts it
  among a package's resources) and gives the server `POST /api/slides/pptx` (`apps/server/src/pptx-routes.ts`): the
  deck in, its pages out, one deck drawn at a time. The route is only where a host draws decks: the cloud has none
  and answers 404, which the page asks first (`GET`), so a deck is never sent for nothing. The desktop app also
  draws a deck itself whatever server it is a client of, our cloud included (Lars, 2026-11-26): its main process runs
  the same program for the page (`drawPptx` in the preload, `draw-pptx` in `apps/desktop/src/main.ts`), and the page
  asks it before the server.
- **The web** (`apps/web/src/media/slides.ts`) takes a `.pptx` where it takes a PDF: the host draws it and the pages
  are kept as a PDF's (`addSlides`), so they sync, show and are replaced as those do; a 404 asks for a PDF, a `.ppt`
  for a `.pptx` or a PDF, and a deck with a chart is kept with a notice that a PDF may show it better (PRES-R11).
- **Checked**: gp-pptx's tests on the fixture (a list built a point a click is four pages, the hidden slide none, the
  chart noted, the pictures' sizes); `powerpoint.spec.ts` imports it in the desktop app and shows a click's page on
  the output at 1920×1080. Not checked: a real sermon deck through the app, a package (`release`) with the program
  in its resources, Windows and Linux, a package for an architecture other than the machine's (build.mjs builds the
  machine's own). Not built: the native app's import (it has no slideshow import yet; the libraries build for iOS).

## How it would work: layers drawn once, moved by the GPU

1. **On adding** a `.pptx`, the desktop host or the native app reads it with DeckCraft's libraries and draws, per
   slide, the backdrop and, bottom to top in the shapes' own order, a layer for what stands still between animated
   shapes and one per animated shape (or per paragraph, for a build by paragraph), at twice the output's size where
   the animation grows it. With them goes a small description per click: which layer, when, and its offset, scale,
   rotation about its centre, opacity and clip over time (`AnimState`). The layers sync as media files, as a PDF's
   pages do today; the description is the item's content.
2. **Showing**: every output (the output window, `/display`, `/watch`, iPad, iPhone) only moves pictures: Core
   Animation in the native app, CSS transforms on the web. A click is a step of the core's live state, as any slide;
   VISAS and NÄSTA, Släck, overlays and the remote control work as for every item, and all screens show the same.
3. **What a layer cannot do** (a colour change, Morph, an effect that redraws the shape) is a hard cut to that click's
   end state.
4. **A setting**, per organisation: animations on, or hard cuts between the clicks (the decision of 2026-11-04 kept).
5. **A first step** is the clicks as stills only: the same layers with every movement off, nothing lost.

The web never runs DeckCraft, so neither its WASM size nor Rust 1.95 reaches the web's core.

## Tried (2026-11-20, on a Mac; the probe in a scratch folder, not in this repository)

- **Three real sermon decks** (21 slides): drawn in 0.2–1.2 s per deck, Swedish text, bullet lists, pictures, text
  boxes on photos, tables with banded rows and the master's background right as far as could be seen. Not compared
  with PowerPoint's own export: Keynote's export stopped on a dialog.
- **A build drawn click by click** through the libraries (a list by paragraph, then a picture flying in): seven
  states, as PowerPoint steps them; 15 pictures of a deck in 204 ms. The same on iOS: the libraries build for
  `aarch64-apple-ios` and ran in the iPhone simulator (177 ms); the text 1–2 % of pixels apart from the Mac's (other
  system fonts).
- **Size**: reading, the clicks and drawing to PNG add about 8.3 MB to a stripped binary.
- **Animation drawn whole every frame** (1920×1080): 27.5 ms a frame on one thread, 5.3 ms on eight (median); enough
  on a fast Mac, not on the web's one thread.
- **Animation as layers**, every frame put together from layers drawn once and compared with the slide drawn whole at
  the same moment:
  - own test animations on the sermon decks: fly, fade, zoom, wipe, spin, grow/shrink, swivel, a motion path, shrink
    and turn, dissolve within 0–1.8 % of pixels; a colour pulse 8.5 % (not a layer's).
  - **real files**: LibreOffice's and Apache POI's test decks (`sd/qa/unit/data/pptx`, `test-data/slideshow`, 518
    files, many from bug reports of real PowerPoint files): 507 read, the 11 others broken zips (10 fuzz cases);
    nothing crashed or hung; 35 ms a slide (median). 178 animated steps in 49 files: of the 115 that move and have a
    right reference, 94 within 0.5 % and 14 within 2 % (94 %), 7 at 2–5 % (fades and a path with grow/shrink in two
    files, not looked at one by one); 23 steps without movement (appear, media); 2 colour changes; 38 steps animate
    a group, which DeckCraft's own whole drawing does not move, so they have no reference.
- **Against PowerPoint itself** (PowerPoint for Mac, driven by AppleScript on copies): the 49 animated corpus files,
  the three sermon decks and two test decks exported as PDF and as a movie (`save as movie`, the animations played);
  51 of 54 exported, three hung PowerPoint (two with narration or odd timing, one broken). Each DeckCraft slide after
  its last click against the PDF page most like it (313 slides, 480×270, both blurred a little so that the sampling of
  photos does not count): 125 within 1 %, 202 within 3 %, 269 within 10 %, median 2 %. The sermon decks: layout,
  pictures, tables and text as PowerPoint's, the text a little heavier (DeckCraft's substitute for Calibri). Where
  DeckCraft is off: charts (axis labels running together, a legend missing, a bar-and-line chart drawn otherwise).
  Some of the worst scores are the check's own (hidden slides shift the PDF's pages). Each click's state against the
  movie frame most like it (436 states, unblurred): 201 within 5 %; not looked at one by one. The movie of a sermon
  deck's build plays the clicks in the order and with the movements the layers give.
- **Driving the DeckCraft app** through its control port (`--control`, JSON lines: `show.start`, `ui.key`,
  `ui.inspect`): each step under 1 ms, black and back 14 ms; but it cannot choose a display (moving its window there
  first needed macOS's Accessibility permission), shows none of Gospel Presenter's overlays, and runs on a computer
  only. Weighed and left for the layers.

## Not tried, and open

- Charts: DeckCraft's are not PowerPoint's; until they are, a deck with charts could take its pictures from the
  church's PDF export, or say that its charts may differ.
- The movements against PowerPoint's movie frame by frame (only the click states were matched), animated groups (38
  of 178 steps in the corpus), and the 7 steps 2–5 % apart.
- Layers on a GPU: Core Animation and CSS were not tried, only the same arithmetic on the CPU.
- Fonts: each platform substitutes PowerPoint's fonts with its own; drawing the layers once, on the host, would give
  every device the same.
- DeckCraft's crates from git rather than crates.io.
- The decision of 2026-11-04 (hard cuts) holds for step 1; step 2 makes the animations a setting with hard cuts as the
  other choice.
