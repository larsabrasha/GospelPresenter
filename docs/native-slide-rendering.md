# Slides drawn without a browser

Asked by Lars on 2026-11-18, with an Apple Watch and an Apple TV in mind; not for 2.0. Way 3 below chosen by Lars on
2026-11-19 after the probe ("commit och kör"): the core lays out, each shell paints. The core's `slideLayoutView` is
built, and the Mac and iOS app paint every kind of slide from it (the sections at the end).

## The question

Every slide is drawn by the web's `SlideView` (`apps/web/src/ui/SlideView.tsx`): previews, tiles and every output,
so they always agree. The native app runs the same component in a web view (`apps/mac/Sources/GPMac/SlideRenderer.swift`,
docs/native-apps.md). tvOS and watchOS have no WebKit, so an app there cannot draw a slide that way.

## What needs no renderer

- **Apple Watch** is a remote: the part shown and the next by their label and first line, →, ← and Släck. Its texts
  are the core's already (`slideMarksView`, `pageEventView`); it draws no slide.
- **Apple TV as a screen** is AirPlay from an iPhone, an iPad or a Mac (the goal already set, the sound following the
  picture to the same receiver). The sending app draws; the TV only shows.

A phone already shows a song's parts as their text in rows, not as slides, so more of them fit and they read
easier (docs/layout-2-0.md); it draws a slide only for the live picture and a picture item. A watch would do the same.

A renderer is needed only for an Apple TV app that is an output of its own, taking the live state itself, and for
anything else without a browser later.

## A Raspberry Pi as a screen (Lars, 2026-11-18)

A Pi behind a TV in the entrance or by the stage, showing the songs' texts: a screen, not a host. It is a paired
screen as any TV is today (docs/live.md, LIVE-R28): it opens `/display` of the desktop host or the cloud, shows a
four-digit code, an operator pairs it, and it follows what is presented. A paired screen never plays sound.

- **Today, with no code**: an image of Raspberry Pi OS Lite with a minimal compositor (cage) and Chromium in kiosk
  mode on `/display`; the network and the host's address set in Raspberry Pi Imager before the card is written. A Pi 4
  or 5 runs it well; a Pi Zero 2 W (512 MB) only just, slow to start.
- **With way 3**: a small Rust program in place of the browser, pairing by the same code, taking the live state and
  painting the core's display list straight to HDMI (DRM/KMS, no X, Wayland or browser). It starts in seconds, in some
  tens of MB, and makes a Pi Zero a cheap screen. Such a screen plays no video: where a video is shown it shows the
  video's still, as the previews do, or the theme's ground. That is a new rule for an output (an output that says it
  plays no video, and what it shows then), to be decided before it is built.

The host stays the desktop host or the cloud, whose server is TypeScript around the core and runs on both; a Pi as a
host would need Node, which a Pi 4 or 5 runs, but that is not what the screen needs.

## What a slide is to draw

A 1920×1080 stage, scaled to its box. A song's or a Bible text's lines in the theme's typeface, size, line height,
colour, shadow and capitals (`packages/core/src/themes.ts`), made smaller until they fit their box, down to 35 % of
the theme's size, by measuring in the browser (`apps/web/src/ui/FittedText.tsx`); the part's label for the operator;
the credits; the theme's background, a colour or a picture fitted or filling; a slideshow's page or an overlay, each
element in its box (docs/custom-slides.md: texts, pictures, rectangles, ellipses, lines); a video's still, its video
over it on an output; and the black that fades in and out over 500 ms.

The hard part is the text: where lines break and what size a long verse gets. Two renderers that differ there show a
verse in three lines on the projector and in four in the preview.

## Three ways

1. **Each platform lays out and draws** (Core Text on Apple, the browser on the web). The best looking and the
   fastest on each, and the least work per platform; but line breaks and the fitted size differ between text engines,
   so a slide may not look on the TV as it did in the preview. Against the rule that one component draws everything.
2. **The core lays out and draws** to pixels (tiny-skia, vello). The same pixels everywhere; but every slide is
   painted by the core on the CPU (or through a GPU layer of its own), video and AirPlay go around it, and the text
   loses each platform's own smoothing.
3. **The core lays out, each platform draws** (recommended). The core takes the slide, the theme and the stage, shapes
   the text with the app's own fonts (parley or cosmic-text), breaks and fits it, and returns a display list: the
   ground, pictures by their hash and their box, shapes, and glyph runs with their font, size, colour, shadow and
   exact positions. Each shell paints that list with its own means: Core Graphics or Metal on Apple, a canvas on the
   web; pictures and video through the platform's own decoders and players. The layout is one and is checked
   deterministically, as the view models are (docs/view-models.md); the painting is native. The same line as the rest:
   the core decides what, the shell how.

## What way 3 asks

- **Fonts in the core.** The shaping must use the very fonts the screens show. Inter, Montserrat and Lato ship with
  the app already (`apps/web/src/fonts.css`, OFL). Classic's Tahoma does not, and may not be shipped: its stack falls
  back to what the system has, which a renderer of its own cannot follow. Classic would need a shipped face of the same
  measures, or keep its fallback and accept a difference there.
- **Proof against SlideView.** Before anything switches, thousands of slides (songs of every length, every theme, every
  stage size) laid out by the core and by the browser, comparing each line's break and the fitted size: 0 different,
  or every difference explained, as the Rust core was proved (docs/rust-core.md). Then pictures within one shell,
  before and after, never across shells (docs/look.md).
- **Then the shells, one at a time.** The web last, if at all: its `SlideView` is the reference and works.

## Order

Watch as a remote first (no renderer), then the TV by AirPlay (no app). A probe of way 3 next, on its own: the core
laying out song slides in one theme, compared with `FittedText` over a few thousand slides, to learn whether the line
breaks can agree before anything is decided.

## The probe (2026-11-19)

Done, in `spike/slide-layout` (its README has the numbers): parley laid out and fitted 12 916 slides from 812 real
songs in Inter, Montserrat and Lato as `FittedText` does, against Chromium and WebKit. The same size and lines on
99.7–99.98 % of them, the browsers differing from each other about as much. The rest is a word within a pixel or two
of the edge, rounded differently, and two rules where the browsers leave Unicode's line breaking (a break after a
hyphen before a digit, before a comma after a space). The line breaks can agree; way 3 is not decided by it.

What the probe taught that the core must do: a face is registered under the theme's name, as `@font-face` names it
(a variable file is named for its default instance, Montserrat's "Montserrat Thin"). And parley's own
`CHROMIUM_LINE_BREAK_OVERRIDE` makes the two rules the browsers' (WebKit's too, where songs need them): with it the
differences left are the words at the edge, none at all in Lato, the one face shipped as a static file.

## In the core (2026-11-19)

`slideLayoutView` {slide, theme} (`crates/gp-core/src/slide_layout.rs`): a song slide's background, its main text
fitted as FittedText fits it and its credits on one line, each text with its lines (text, start across, baseline,
width), its glyph runs by face and every glyph's id and position on the 1920 × 1080 stage, and the area it is clipped
to. The shell paints the glyphs with the same faces (`crates/gp-core/fonts`, the app's own as TrueType) and its own
means, and draws the label, overlays and the black itself. Proved against SlideView in Chromium and WebKit (the row in
`docs/rust-core.md`). Only the native shells have it (the `layout` feature): parley, its line breaking data and the
faces would double the web's WASM, which draws with SlideView.

A shell may add faces of its system for a family a theme names that the app does not ship (`add_slide_face` through
UniFFI, `gp_add_face` in the WASM): the Mac adds its own Tahoma, so Classic and Ljust lay out as the browser on that
Mac draws them (`parity/slide-layout.mjs` adds the theme where the system has Tahoma: 106 460 comparisons over the real
songs, 0 different besides the same words at the edge). That follows each platform as the browser does, and does not
decide what Classic's Tahoma becomes where a system has none (iOS, where WebKit falls back to Verdana).

## The Mac and iOS app paint (2026-11-19)

`apps/mac/Sources/GPMac/SlidePainter.swift`: a song slide's thumbnail, live picture and output window are painted from
`slideLayoutView` with Core Text (the glyphs by id where the core put them, the faces from the core's own bytes or the
system's Tahoma), the theme's colour and own picture with its scrim under them, the outline and shadow as SlideView
paints them, and the part's label in the system's sans as the page's. A tile shows the label and no credits, the live
picture the credits and no label, as `apps/web/src/slides/main.tsx` does. Everything else is still SlideView's.

Compared picture by picture (`apps/mac/compare.mjs`): the Mac app paints the demo's first 60 song slides in Classic,
Ljust and three themes of the shipped faces (a shadow, an outline, capitals), every other one through the live
picture's `Canvas`, and the app's own `slides.html` draws the same in Playwright's WebKit; pixels differing by more than
48 of 255: a median of 0.064 % in four themes (the label's letters, drawn by Core Text and by the page in the same
system font), 0.29 % with Montserrat outlined (the outline's edges). What made them agree: each baseline on a whole
pixel of the 1920 stage, as WebKit sets a line before the stage is scaled; the outline stroked as the glyphs' paths,
since a SwiftUI `Canvas` strokes a context's text wider than a bitmap does. Not compared in a WKWebView in the app (a
web view in an app of a locked Mac draws nothing), nor on a screen of the Mac's own density, nor with a theme's
picture.

Measured on an M1 Max (the same run, `<dir>/timing.txt`): a slide's layout 0.36 ms with its JSON both ways, a thumbnail
painted 0.51 ms, the whole stage 1.66 ms; the web view took 65 ms a snapshot and 69 ms a sheet of 20 (docs/native-apps.md).
The rounding that makes the pixels agree costs nothing to speak of; Lars, 2026-11-19: where it would cost, exact pixels
are not needed.

On iOS (the iPhone 17 Pro simulator, `-gp.compare YES`), Classic and Ljust are laid out in iOS's Verdana, the first of
Classic's stack iOS has, as its WebKit falls back; the app's own web view drew SlideView there, so the two are compared
within one shell: the same lines in the same places, pixels apart a median of 1.5–2.8 % by theme, all at the glyphs'
edges. Likely the web view's rounding: it draws at the screen's density 3, so it sets a baseline on a third of a stage
pixel where the painter sets it on a whole one; not tried, as exact pixels are not needed (Lars). Painted in 0.59 ms a
thumbnail, 1.58 ms the whole stage.

## Bible slides (2026-11-19)

`slideLayoutView` lays a Bible slide out too, as SlideView's BibleText sets it: the text flowing (`white-space:
normal`), each verse number half the size, `line-height: 0`, followed by a no-break space (SlideView's, so a number
never ends a line apart from its words), raised a third of the text's size and a pixel (`vertical-align: super`, as
Chromium and WebKit raise it) and a quarter of it more (Tailwind's preflight gives `sup` `position: relative; top:
-0.5em`), and drawn at 40 %, outline and fill together. The browser check (`parity/slide-layout.mjs`) takes the demo's
Bible slides and the songs' lines as verses, numbered up to three digits, 165 slides beside the songs, in Classic's
Bible style too (Tahoma 400 at the left): 0 different. Picture by picture on the Mac, 40 Bible slides in five themes:
the same pixels but the label's (a median of 0.000 %), 0.4 % with Montserrat outlined (the outline's edges); in the
iOS simulator against its own web view as the songs, 1.5–2.5 %, at the glyphs' edges. What the
first try missed, the picture check found: the no-break space and Tailwind's raise, which a copy of SlideView's CSS
without Tailwind leaves out.

## Pictures, videos, slideshows and overlays (2026-11-19)

`slideLayoutView` {slide, theme, overlay} lays out every slide now (`crates/gp-core/src/slide_items.rs`): a picture
slide's picture and a video's still fitted to the stage over the theme's media ground, a slideshow's page (its own
colour, its picture filling the stage, a PDF's page fitted, then its elements in order: pictures fitted or filling
their box, rectangles with rounded corners and a border inside their edge, ellipses, lines round at the ends, and
texts in the theme's song style at their own size, from their box's top, never made smaller, clipped only by the
stage), and an overlay's page over all; no slide is a clear ground (a thumbnail's overlay layer). An italic the faces
lack is slanted by the shell as WebKit slants it (a quarter of the height); a weight the face lacks (Lato is shipped
at 400) is marked, and the shell draws the glyphs again a 24th of the size to the right, as WebKit does, though
WebKit also widens each advance by as much, which the layout does not (such a line runs a little narrower). The
native app plays no video: a video slide shows its still, live too.

Compared picture by picture with made-up pages that have every element, an overlay over a song, a picture slide and
nothing, and pictures drawn into the app's media folder (`apps/mac/Sources/GPMac/ComparePages.swift`): on the Mac
the pages without pictures a median of 0.000 % apart, 0.27 % for Lato's drawn bold (the pictures need the app's own
web view, which a locked Mac's app lacks); in the iOS simulator against its own web view the pictures 0.000–0.3 %,
the pages 0.1–1.8 % at the glyphs' edges. The check found a fault of the web's own: `CustomPageView` read a picture
through the database's hooks also where the page has none (the native apps' renderer, a paired screen), and React
dropped the whole sheet of thumbnails with it; it now takes `media`'s URL without them, as SlideView's pictures do.

Left to decide: iOS's WebKit sets Lato's lines a few pixels higher than the Mac's, which the core follows; whether a
shell paints for its platform's browser or for one look everywhere.