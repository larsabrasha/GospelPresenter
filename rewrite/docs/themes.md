# Themes

A theme says how a presentation's slides look (spec 05, ADR 0001): per kind of slide (a song, a Bible text, a picture
or a video) its background, and for a text slide its main text and its credits line. Two are built in, and an
organisation makes its own (Lars, 2026-11-04).

## Built in

Code, not rows (`BUILT_IN_THEMES` in `packages/core/src/themes.ts`), the same for every organisation and changed only
by a new version of the app:

- **Mörkt** (`classic`, spec 05's Klassisk, which keeps its id so presentations that named it still do): bold white
  75 px Tahoma, line height 1.4, centred, on black; a Bible text regular and left; credits 40 px, 40 % white, at the
  foot. The fallback for an unknown theme (THEME-R1, R9).
- **Ljust** (`light`): the same, black on white, credits 40 % black. Pictures and videos stay on black.

Spec 05's Midnatt, Dagsljus and Norrsken, and Norrsken's picture, are gone: no church used them (Lars). A
presentation or a default that still names one shows Mörkt, as any unknown id does.

A built-in theme is not changed or deleted (the mutators refuse it, `forbidden`); Duplicera in its ⋯ makes an
own copy, which is.

## What a theme sets

Per kind (`themeDefinitionSchema`): `song` and `bible` each have a background, `main` and `credits`; `media`
(pictures, videos, PDF pages) a background only.

- **Background**: a colour; a picture or none, filling the stage (`cover`) or whole (`contain`); a dimming over the
  picture, 0–100 % black (`scrim`). A picture is the theme's own, its two blobs named in the definition, as a
  slideshow's page names its pictures: one of Bilder is a copy (the same blobs), one from the device goes into the
  theme only.
- **A text** (`main`, `credits`): typeface (Tahoma, Inter, Lato or Montserrat), size, weight, line height, colour (with
  how opaque it is), alignment, shadow, capitals (`uppercase`), an outline around each letter (`outline` px and its
  colour, drawn under the fill, so letters widen outwards), and where it sits: its box on the 1920×1080 stage
  (`area`) and the text at the box's top, middle or foot (`valign`). The built-in themes' boxes are the canvas minus
  its padding (LIVE-R17) and, for credits, the band at the foot.

Not set by a theme: the overlay, the black screen (always black), audio items, and a slideshow's page, which sets
its own and takes the theme's background and text colour only where it sets none (docs/custom-slides.md).

## Text that does not fit

The size is the most the text gets (ADR 0001 (8) foresaw it): a text too tall for its box is made smaller until it
fits, down to 35 % of the size, below which it is clipped as before. `ui/FittedText.tsx` measures in the stage's own
pixels after every render, and again when the fonts have loaded, so a tile, the editor and the output agree. The
public output (`/watch`) sizes text from the viewport as before (LIVE-R31) and does not shrink.

## The organisation's own

A synced table, `themes` (schema 23): `id`, `name`, `definition` (JSON, written whole at each save, so the last of two
devices' saves wins it), `sort` (when it was made) and `updated_at`. Mutators in
`packages/core/src/mutators/themes.ts`, all `ManageThemes` (admins): `createTheme` (at most 50, `THEME_LIMITS`),
`updateTheme` (its name, its definition, or both), `deleteTheme` (for good, no trash: the presentations and templates
that named it, and a default that was it, are cleared, so they follow the default, else Mörkt). `setDefaultTheme`
and `updatePresentation` take an own theme's id as a built-in one's (`requireTheme`). A theme whose picture's blobs
are not where the mutator runs is refused with `media-missing`; `MediaUploads` uploads them before the push, as for
a slideshow.

A theme's pictures are kept by the clean-up while a theme names them (`ORPHAN_BLOBS_SQL`, `THEME_PICTURES_SQL`).
Every device fetches their thumbnails; a device that presents, or keeps a presentation offline, fetches every own
theme's pictures, as it does every overlay's, since any of them may be chosen during live.

## On the outputs

The output window draws in the theme it resolves from its own database. A report to the server carries the theme
by its id and, for an own theme, its definition too (`theme` in `publicSlideSchema` and `canvasSchema`;
`themeOfReport` reads it back), since a paired screen and a public output have no database to find it in. A paired
screen may fetch a theme's picture while its canvas's theme names it and it is a picture of one of the
organisation's themes (`live-output-gate.ts`). A public output draws the theme's colours and type, never its picture.

## Teman and the editor

Teman (`pages/Themes.tsx`) lists the built-in themes, then the organisation's own, as a grid of previews. An admin's
+ makes a copy of the default, named first, and opens it in the editor. Each tile has its ⋯ under it, as a library's
item (Lars, 2026-11-07: a sheet in between added little): Använd som standard where it is not the default, Redigera
for an own theme, Duplicera, and Ta bort tema red, asked first; a right click or a finger held on a tile opens the
same menu. A tap on an own theme opens its editor; a built-in one says what it is for as its tooltip. Välj, as every
list has it, ticks own themes to delete together; the built-in ones are greyed under it.

The editor (`pages/theme-editor/`) is the slideshows' (Lars, 2026-11-04): Ångra and Gör om above the slide (⌘Z,
⇧⌘Z), the three kinds of slide (Sång, Bibeltext, Bild och video) where the slideshows' editor has its pages, and
Format at the right where the editor is wide (`@4xl`), else a popover under the brush, or a sheet on a phone, as
the slideshows' editor has it. The slide is a sample of the kind, drawn as
every output draws it; the boxes of its texts are dashed. A tap on the main text or the credits picks it: its handles
drag and size its box, lined up with the stage's edges and middle, and Format has its look; a tap beside them, the
theme's name and the kind's background. By the keyboard as the slideshows' editor: with focus on the slide, Tab
picks the main text, then the credits, an arrow moves the picked box a point (⇧ ten), and Escape picks none
(`e2e/keyboard.spec.ts`). It saves as it goes, the whole definition, half a second after the last
change, and at once on leaving.

## Not yet

- A video as a background (TODO.md asked for one): a theme's background is a colour or a picture.
- Fonts of the organisation's own: the four that ship with the app.
- One change for both song and Bible text: each kind is set on its own.
- Spec 05's Oswald, Playfair Display and Merriweather: not shipped.

Tested: `packages/core/test/themes.test.ts` (the built-in themes, resolution, CSS, blobs),
`packages/core/test/live-protocol.test.ts` (an own theme on the wire), `apps/server/test/themes.test.ts` (the
mutators on every adapter), `apps/web/test/themeModel.test.ts` (the editor's colours and changes),
`apps/desktop/e2e/themes.spec.ts` and `milestone4.spec.ts` (made, changed, the default, on the output, deleted).
