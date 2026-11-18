# Slides drawn without a browser: a proposal, not decided

Asked by Lars on 2026-11-18, with an Apple Watch and an Apple TV in mind. Not built, and not for 2.0.

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
