# Slides drawn without a browser

Asked by Lars on 2026-11-18, with an Apple Watch and an Apple TV in mind; not for 2.0. Way 3 below chosen by Lars on
2026-11-19 after the probe ("commit och kör"): the core lays out, each shell paints. The core's `slideLayoutView` is
built, and the Mac app paints song slides from it (both at the end).

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

## The Mac app paints (2026-11-19)

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

Next: iOS, then Bible slides (verse numbers small and raised), pictures, videos and custom slides; an overlay over a
painted slide.
