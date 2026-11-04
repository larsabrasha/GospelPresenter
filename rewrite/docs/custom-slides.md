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

The page at its size in the window; a tap picks an element, a drag moves it, the handles at its corners size it,
and a toolbar adds Text, Bild, Rektangel, Ellips and Linje. What the picked element is (its text, size, colours,
order, Radera) is a panel: beside the page on a computer, a sheet under it on a phone. Pages are a row of thumbnails
to add, reorder and remove. It saves as it goes, as the song editor does.

## In steps

1. The slide's model, its table and mutators; the editor; Egna slides in Inställningar's library and in Lägg till;
   the item drawn in the app and in the output window; a public output's text.
2. Overlays in the same format, the old ones dropped; paired screens' canvas and the server's picture gate for both.
