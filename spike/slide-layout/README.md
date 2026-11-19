# Can the core break a slide's lines as the browser does?

The probe that `docs/native-slide-rendering.md` asks for before way 3 is decided (Lars, 2026-11-19): a song slide's
main text laid out and fitted in Rust with [parley](https://github.com/linebender/parley) (HarfRust shaping, ICU4X's
line breaking), compared with the browser's `FittedText` (`apps/web/src/ui/FittedText.tsx`), in Chromium and WebKit.

**Result: yes.** On 12 916 slides from 812 real Swedish songs, in five faces and weights, parley and the browsers
give the same fitted size and the same lines on 99.7–99.98 % of them; the browsers differ from each other about as
much. Every difference has one of three causes, all explained below, none a fault of parley's.

## What was compared

- **The slides:** every part of the songs in a ProPresenter library (`GP_REAL_PRO_DIR`, read by the core's
  `proPresenterSongView`), as it is; runs of 2 to 4 parts joined by line breaks; and runs of 1 to 8 parts as one
  flowing paragraph, so lines wrap and texts are made smaller down to the least size. 12 916 distinct texts, of which
  2 885–3 388 (by face) have lines that wrap and 23–115 are made smaller.
- **The style:** Classic's song style (75 px, line height 1.4, centred, white space kept, a long word broken where it
  must be, the box of the canvas minus its padding, 1760 × 856) in a face the app ships, since Classic's Tahoma is not
  shipped: Inter 700 and 400, Montserrat 700 and 400, Lato 400.
- **The fit:** FittedText's own, on both sides: the theme's size if the text fits, else halving between 35 % and 100 %
  eight times while the text is taller than the box (as `offsetHeight` rounds it, plus a pixel), then rounded down.
- **What must agree:** the size, the number of lines, and where each line that has text starts.

## Results

| Face | Chromium ≠ parley | WebKit ≠ parley | Chromium ≠ WebKit |
|---|---|---|---|
| Inter 700 | 15 (0.12 %) | 5 | 10 |
| Inter 400 | 2 | 2 | 0 |
| Montserrat 700 | 9 | 9 | 0 |
| Montserrat 400 | 33 (0.26 %) | 33 | 0 |
| Lato 400 | 5 | 5 | 0 |

The control: parley given a box 4 px narrower than the browser's differs on 200 (Chromium) and 210 (WebKit), sizes and
line counts among them, so the check sees a difference where there is one.

## The causes

1. **A word at the box's edge** (most of them): parley's line is within 2 px of 1760, and the browser measures it a
   hair wider and moves the word down, or the other way: given 1 px more, parley breaks as the browser does. The
   engines round sub-pixel widths differently (Chromium works in 1/64 px). Where it happens while the size is sought,
   the search takes another path and the size comes out a pixel apart, the lines the same. Chromium and WebKit differ
   from each other this way too (Inter 700: 10 slides).
2. **A break after a hyphen before a digit**, "(Apg 5:1-|11)": the browsers break there; Unicode's line breaking
   (UAX #14), which parley follows, does not, as the hyphen may be a minus sign.
3. **A break before a comma after a space**, "övervanns |, nå'n": the browsers break there; UAX #14 never breaks before
   a comma. The space before the comma is a typing slip in the song.

Not a cause: Montserrat first differed on a quarter of the slides because its variable file is named for its default
instance, "Montserrat Thin", and parley fell back to a system face. Registered under the theme's name, as `@font-face`
names a face, it agrees; the core must do the same.

## What it says for way 3

- The core can lay out a slide's text and fit it as the web does, with the app's own faces, so a projector and a
  preview drawn by different shells would show the same lines. Differences are a word at the edge, as the browsers
  already have between themselves.
- To agree on the two rules, parley would need its breaking tailored (a hyphen before a digit, a comma after a space),
  or the web would keep its own; that is a decision, not a fault.
- Speed: 0.046 ms a slide on an M1 Max, the 12 916 laid out and fitted in 0.6 s (native, not WASM).
- Not tried: Bible slides (verse numbers as superscripts), capitals (`text-transform` follows the language), outlines
  and shadows (they do not move lines), other stage sizes (the stage is always 1920 × 1080, scaled), Tahoma (not
  shipped), WASM's size and speed, and the core drawing nothing yet: this lays out, it paints no pixel.

## Run it

```sh
crates/gp-core/build.sh                              # the core that reads the .pro files
brew install woff2                                   # for woff2_decompress
mkdir -p spike/slide-layout/.build && cp apps/web/src/assets/fonts/*.woff2 spike/slide-layout/.build/
for f in spike/slide-layout/.build/*.woff2; do woff2_decompress "$f"; done
(cd spike/slide-layout && cargo build --release)
GP_REAL_PRO_DIR=<a folder of .pro files> node spike/slide-layout/compare.mjs
GP_FONT=Montserrat GP_WEIGHT=400 GP_REAL_PRO_DIR=… node spike/slide-layout/compare.mjs   # another face
GP_SKEW=4 GP_REAL_PRO_DIR=… node spike/slide-layout/compare.mjs                         # the control
```

The report, with up to 40 differences each and parley's line widths, is `.build/report.json`.
