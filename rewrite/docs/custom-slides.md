# Custom slides and overlays

Decided with Lars on 2026-11-04: a church makes its own slides by placing texts, pictures and shapes freely, and
overlays are made the same way. One editor for both, on a phone too.

## What it is

- **A custom slide** (Egna slides) is an item of the library with one or more pages. It is added to a presentation
  from Lägg till's tab Egna slides, or made there as a song is, and it is a reference, as a song is: a change in the
  library shows in every presentation that uses it, old ones too.
- **An overlay** is one page with no background of its own, drawn above an item's slides when the item carries it,
  as today (LIVE-R15, `applyLiveChange`). The overlays of before (a text and a picture) are dropped, not converted.
- Both are stored apart, as their own types, and edited by the same editor.

## A page

A page is a 1920×1080 stage (`CANVAS`), so it is drawn the same on every output. Its elements, in drawing order,
each with a box in stage pixels (`x`, `y`, `w`, `h`):

- **text**: the text, its size, bold, italic, its alignment, and a colour;
- **image**: a picture of Bilder by id (a reference: a trashed picture still shows, a purged one is left out), fitted
  inside its box or filling it;
- **rect** (with a corner radius), **ellipse**: a fill and an outline, each a colour or none;
- **line**: from the box's one corner to the other, a colour and a width.

A page's background is a colour, a picture of Bilder, or nothing. Nothing, and a colour or a font that is not set,
follow the presentation's theme: the background, the font and the text colour of its song slides. So the same slide
fits a dark and a light theme, and what is set stays as set. An overlay's page has no background.

Limits, so a page stays small enough to sync and draw: 100 elements a page, 50 pages a slide, 2 000 characters a
text.

## Where it lives

- `packages/core/src/custom-slides.ts`: the page's schema (zod), its limits, and the text of a page for a public
  output (its texts, top to bottom).
- `custom_slides` (synced): `id`, `name`, `pages` (JSON, the pages), `created_at`, `updated_at`, `deleted_at`. In
  the trash as a song is. A save writes all its pages, so the last save of two devices wins the slide.
- A presentation item of type `custom` names the slide by `source_id`; its slides are drawn from the slide as it is
  now, one per page (`apps/web/src/live/live.ts`).
- `overlays` keeps its table and ids, so items, the live pointer and the outputs keep naming overlays as now; its
  `content` holds the page (JSON), and `image_id` is no longer used.

## The outputs

- This machine's output window draws a page as every preview does (`SlideView`).
- A public output gets text only, as now: a page's texts.
- A paired screen gets the canvas: the page with its pictures' hashes, and the server lets it fetch a picture only
  if the page of an item in the shown presentation, or the overlay switched on, has it (`live-output-gate.ts`).

## The editor

As Keynote's (Lars, 2026-11-04), in `apps/web/src/pages/custom-slides/`:

- **Above the page**, Ångra and Gör om at the left, + and Format (the brush) at the right. + adds a text, a picture
  of Bilder, or a shape (rektangel, rundad rektangel, ellips, linje) in the middle of the page.
- **The page** is drawn as the outputs draw it (`CustomPageView`), scaled to the column. A tap picks an element,
  a tap beside them all picks none; the picked one is dragged and sized by its handles (react-moveable, larger
  on a touch screen), and lines up with the page's edges and middle and with the other elements by yellow guides.
  A text tapped twice is written on the slide itself. A held finger or a right click opens Klipp ut, Kopiera,
  Klistra in, Duplicera and Ta bort; on a computer ⌘Z, ⇧⌘Z, ⌘C, ⌘X, ⌘V, ⌘D and Delete do the same.
- **Format** has the picked element's tabs: Text (words, size, bold, italic, alignment, colour) or Stil (fill,
  outline, its width, a rectangle's corners; a line's colour and width) or Bild (fit, another picture), and Ordna
  (to front, forward, backward, to back, Duplicera, Ta bort). With nothing picked it has the slide's name and the
  page's background (a colour, the theme's, or a picture). It stands at the right where the editor is wide enough
  (its own width, `@4xl`: Inställningar's column is narrower than the window), else it is a sheet over the lower
  part of the screen, pulled down to close.
- **The pages** are a column of numbered thumbnails at the left where the editor is wide, a row under the page
  otherwise; + adds a page after the open one, and a page's menu (held, or a right click) duplicates, moves or
  removes it.
- **Ångra** keeps the last 100 steps; a run of the same change of one element within 0.6 s (a slider pulled, a
  word typed) is one step, while adding, removing and a page's change are always steps of their own (`history.ts`).
- It saves as it goes, all the pages, half a second after the last change, and at once on leaving. A version saved
  by another device is taken over when it is newer than the last one saved here and nothing waits to be saved.

## In steps

1. The slide's model, its table and mutators; the editor; Egna slides in Inställningar's library and in Lägg till
   (Ctrl/⌘+7, Skapa makes one, puts it in and opens it); the item drawn in the app and in the output window; a
   public output's text; the trash. Done 2026-11-04.
2. Overlays in the same format, the old ones dropped; paired screens' canvas and the server's picture gate for both.
