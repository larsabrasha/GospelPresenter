# Slideshows (Bildspel) and overlays

Decided with Lars on 2026-11-04: a church makes its own slides by placing texts, pictures and shapes freely, and
overlays are made the same way. One editor for both, on a phone too. A PDF (a PowerPoint or Keynote deck saved as
PDF) is a slideshow too, its pages its pages' pictures: one kind of thing, Bildspel, made here or imported.

## What it is

- **A slideshow** (Bildspel; `custom_slides`, a custom slide in the code) is an item of the library with one or more
  pages, made in the editor or imported from a PDF. It is added to a presentation from Lägg till's tab Bildspel
  (Ctrl/⌘+5), or made or imported there, and it is a reference, as a song is: a change in the library shows in every
  presentation that uses it, old ones too.
- **An overlay** is one page with no background of its own, drawn above an item's slides when the item carries it,
  as today (LIVE-R15, `applyLiveChange`). The overlays of before (a text and a picture) are dropped, not converted;
  an import from 1.x makes its overlays pages ([import-from-1x.md](import-from-1x.md)).
- Both are stored apart, as their own types, and edited by the same editor.

## A page

A page is a 1920×1080 stage (`CANVAS`), so it is drawn the same on every output. Its elements, in drawing order,
each with a box in stage pixels (`x`, `y`, `w`, `h`):

- **text**: the text, its size, bold, italic, its alignment, and a colour;
- **image**: a picture, fitted inside its box or filling it. It is the slideshow's own (`picture`: the hashes of its
  `full` and `thumb` blobs), as Keynote keeps its pictures (Lars, 2026-11-04): one taken from Bilder is a copy, the
  same blobs, as blobs are named by their content, so it takes no more room; one taken from the device goes into the
  slideshow only. Bilder and slideshows are apart: a picture removed from Bilder leaves every slideshow as it was;
- **rect** (with a corner radius), **ellipse**: a fill and an outline, each a colour or none;
- **line**: from the box's one corner to the other, a colour and a width.

A page's background is a colour, a picture of its own filling the stage (`backgroundPicture`), or nothing, and over
it a PDF's page (`backgroundPage`), fitted to the stage, where the slideshow was imported. Nothing, and a colour or a font that is not set,
follow the presentation's theme: the background, the font and the text colour of its song slides. So the same slide
fits a dark and a light theme, and what is set stays as set. An overlay's page has no background.

Limits, so a page stays small enough to sync and draw: 100 elements a page, 100 pages a slideshow (a PDF's most),
2 000 characters a text, 1 000 slideshows outside the trash.

## Where it lives

- `packages/core/src/custom-slides.ts`: the page's schema (zod), its limits, and the text of a page for a public
  output (its texts, top to bottom).
- `custom_slides` (synced): `id`, `name`, `pages` (JSON, the pages), `created_at`, `updated_at`, `deleted_at`. In
  the trash as a song is. A save writes all its pages, so the last save of two devices wins the slide.
- A presentation item of type `custom` names the slide by `source_id`; its slides are drawn from the slide as it is
  now, one per page (`apps/web/src/live/live.ts`).
- `overlays` keeps its table and ids, so items, the live pointer and the outputs keep naming overlays as now; its
  `content` holds the page (JSON), and `image_id` is no longer used.
- Until schema 22 a page's pictures were pictures of Bilder by id (`imageId`, `backgroundImageId`); the migration
  made each the page's own blobs, those of the picture then, and left out one whose picture was gone.

## PDFs

A PDF, picked or dropped in Lägg till's Bildspel or in Inställningar → Bildspel, is rendered on the device, one
picture per page ([media-and-files.md](media-and-files.md#slide-decks)), and becomes a slideshow named by the
file, each page the picture of its PDF page on black (`pdfPages`) with nothing on it: Lägg till puts it in the
presentation at once (`addSlides`). It is then a slideshow as any other: its pages can be removed, moved, and have
texts put on them, and a page's PDF picture taken away (Format, with nothing picked). A slideshow with a PDF page
has Ersätt med ny PDF in its menu: after a question, all its pages are the new PDF's, what was put on them gone,
in every presentation that shows it. A page with a PDF picture is a picture slide for the outputs: a public output
gets its picture (and its texts), as an image item's.

The PDF's blobs are kept while a slideshow of the library, the trash too, names them (`ORPHAN_BLOBS_SQL`); the
server cleans up after a slideshow is made, changed or purged. A slideshow's mutators are refused with
`media-missing` if a PDF page's blob is unknown where they run, and `MediaUploads` uploads them before the push.

Until schema 20 a PDF was a snapshot on its item, and until 21 a deck of a table of its own (`slide_decks`):
schema 20 made each item's pages a deck, and 21 made each deck a slideshow of its id, its items slideshow items,
and dropped the table. An import from 1.x writes slideshows; a zip of an older format is upgraded
(`upgradeLegacyRows`).

## The outputs

- This machine's output window draws a page as every preview does (`SlideView`).
- A public output gets a page's texts, and a PDF page's picture.
- A paired screen gets the canvas: the page, its pictures' hashes in it, and the server lets it fetch a picture only
  if the canvas draws it and a slideshow of the shown presentation, or the overlay switched on, has it
  (`live-output-gate.ts`, `SLIDE_PAGES_SQL`, `OVERLAY_PICTURES_SQL`).
- A presentation's files, which a device fetches to present, include its slideshows' pictures and every overlay's;
  the clean-up keeps the blobs any slideshow of the library (the trash too) or overlay draws (`ORPHAN_BLOBS_SQL`), and
  a slideshow's or an overlay's save is refused with `media-missing` until its pictures' blobs are uploaded, which
  `MediaUploads` does before the push.

## The editor

As Keynote's (Lars, 2026-11-04), in `apps/web/src/pages/custom-slides/`:

- **Above the page**, Ångra and Gör om at the left, + and Format (the brush) at the right. + adds a text, a picture
  (of Bilder or from the device, `ImagePicker.tsx`), or a shape (rektangel, rundad rektangel, ellips, linje) in the middle of the page.
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
2. Overlays in the same format, the old ones dropped (schema 19); Överlägg a library of them and the editor's
   overlay mode (one page, no background, `pages/custom-slides/edited.ts`); paired screens' canvas and the server's
   picture gate for both; the pictures fetched with a presentation's files. Done 2026-11-04.
3. A PDF is a slideshow (schema 21): one library and one tab, Bildspel, for both (Lars, 2026-11-04). Done 2026-11-04.
4. A page's pictures are its own, not pictures of Bilder (schema 22, LEGACY_FORMAT 5), from Bilder or the device. Done 2026-11-04.
