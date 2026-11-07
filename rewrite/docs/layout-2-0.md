# The 2.0 layout

Version 2.0 leaves the current app's look (docs/look.md) where this file says so, decided with Lars on
2026-11-01 from a clickable mockup: <https://claude.ai/artifact/7cD8NA2ZyiHmFC36SnvP53> (private to Lars; the
canvas "Gospel Presenter 2.0"). The look follows iOS 26 on a phone and macOS on a computer: dark cells
(`#1c1c1e`) on black, round glass buttons in the bar, sheets that float off the edges, the app's sky blue as its
colour. Everything not named here keeps the current look.

## Colours

One scale for the whole app, Tailwind's warm grey `stone`, the text's too (Lars, 2026-11-02: warm as Claude's; no
blue-tinted Apple greys and no `neutral` beside it), named by role in the Tailwind theme (`apps/web/src/app.css`):
`ground` (the page, the lightest: stone-50 light, stone-950 dark), `surface` on it (cards, panels, dialogs, a list's
rows: white with a hairline, stone-900), `raised` on a surface (fields, pills, secondary buttons, rows inside a card:
stone-100, stone-800) and `raised-2` a step further (hover), see-through hairline `separator`s, a `sidebar` a step
darker than the page beside it (stone-100), and a sheet's own `sheet` with its rows in `sheet-cell`. A class names
the role (`bg-surface`) rather than a step of the scale. Cards are flat: a hairline, no shadow, no box of their own
around fields that have boxes. A shadow belongs to a bar or a toolbar only (Lars, 2026-11-02): their buttons are
lifted, and ▶ and ■ cast their own colour; in the content a button is flat, filled for the one that matters, tinted
for a quiet one in a colour, grey for the rest (`ui/glass.ts`).

## One rule across the app

The bar opens things (sheets, menus, other views); actions on what is shown sit by it. Nothing in a bar both
changes the view and acts. What is used all the time is always in view, what is used now and then is a tap away,
and what is set once lives in a menu. A page that lists something adds to it with a round + in its heading row, tinted in the app's blue
(`ui/AddButton.tsx`): the start page, Sånger, Användare and the other pages of Inställningar, importing pictures,
audio and video too. Only live has its + floating at the bottom right, as its bar is full and the list is all there
is. A selected row is the app's blue (`sky-500`), and a list's rows are 52 pt high, except in Inställningar's sidebar on a computer: 36 pt as macOS's
(44 pt on an iPad lying down), the icons and texts smaller with them (Lars, 2026-11-01).

## The layout follows the width

At least about 1 000 pt wide (a computer, an iPad lying down) the app has columns; narrower (a phone, an iPad held
upright) it is one column with sheets. An iPad lying down is the computer's layout with touch sizes: rows and
buttons at least 44 pt, and an item dragged by its ≡ so a finger still scrolls; a mouse or trackpad drags the
whole row.

## Live, one column (phone, iPad upright)

A presentation has one view, the same before and while it is presented (Lars, 2026-11-01); there is no editor
apart from it. Before it is presented the picture, Släck and the live column are not there, a part
tapped shows nothing, and ▶ starts it.

- **The bar:** back (to the start page; the presentation keeps running), the title with a line under it
  (`● LIVE · 10:00 · Kyrksalen`; LIVE until Avsluta, also while Släck has blacked the outputs), and at the right
  one glass button in two parts: … and ■, which ends the presentation (asking first). Start and stop are always an
  icon at the far right of the bar, on a phone and a computer (Lars, 2026-11-01).
  The title never wraps: one line each, a fixed height, the place cut with "…" first. A tap on it opens the
  presentation's menu, the same as on a computer (Lars, 2026-11-02): Redigera detaljer… and Noter och länkar, Spara
  som mall…, and to the trash when not presented.
- **…** holds only what the title's menu does not, in groups as on iOS (Lars, 2026-11-02): Utgångar, Överlägg and
  Fjärrstyrning; then Inställningar. Spara offline is the line under the running order while it is kept. "…" in a
  menu only where a dialog asks first. There is no
  Scenläge: the live view is it on a phone and a tablet (Lars, 2026-11-01).
- **The description** sits at the top of the left column on a computer, on a flat card a step lighter than the column, as
  a group in iOS's Settings (Lars, 2026-11-02), three lines with mer at the end of the last to unfold the rest.
  A phone, with no side column, has it too (Lars, 2026-11-03, after leaving it out on 2026-11-02): before presenting
  the same card at the top of the running order, scrolling away with it; while presenting a round button at the left
  end of Släck's row, in the room that keeps Släck in the middle, which opens a sheet with the text and Redigera
  detaljer…; with no description that room stays empty. The picture while presenting is at most a fifth of the screen
  high, to keep the room for the parts.
  A phone lying down has two columns: the running order at the left, the picture and Släck at the right, the +
  at the foot of the order (Lars, 2026-11-02).
- **Before presenting**, a slide clicked (a computer's tile, a phone's part row) is outlined in blue and nothing else,
  to click around and point one out to someone (Lars, 2026-11-03, as the current app), and moved by the keys that
  step while presenting (→ ← ↑ ↓ PageDown PageUp, and ⌘↓ ⌘↑ to an item's first slide); Starta presentation still starts
  black and lets go of it.
- **While presenting**, ↵ shows the next slide, unless one is made ready, outlined in blue: the arrows make one ready
  and move it through the slides as they stand (← → a slide, ↑ ↓ a row), ⌘↑ ⌘↓ the item before or after, a number
  that slide; it is said over the live picture with its item's name, ↵ shows it and the outline goes, Esc lets it
  go (Lars, 2026-11-07). On the slide shown the blue wins over the red, VISAS still saying it. A click on a slide, and
  a clicker's Space PageDown PageUp, show at once (`pages/presentation-editor/useEditorKeys.ts`). Under the mouse a
  slide shows nothing but the pointer, as Keynote's.
- **The picture** that is shown, with **‹ Släck ›** right under it (on a phone Släck alone: a part is shown by a tap
  on it, and the arrows drew the eye there; Lars, 2026-11-03) (Starta presentation brings it in softly: on a phone its block takes its room first, on a computer the live column
  slides in from the right as a macOS sidebar, then the picture fades in out of a slight blur; Avsluta presentation plays it backwards before the presentation ends, all of it by transform and opacity, which
  the graphics card draws (the computer's slides narrow at once as the column starts in, and widen once it is out), "Mjuk" of the variants
  tried, Lars, 2026-11-03; none of it with less motion asked for) (Släck only blacks the outputs, and
  rests while they are black: a part tapped or an arrow shows one again, as ProPresenter's Clear; no "Visa igen").
  Meanwhile no part is marked as shown, not VISAS, nor the item's dot; only the bar's LIVE stays. The part last
  shown keeps a thin grey border, no words, and NÄSTA stays on the one after it: what → (or a pedal) shows next
  (Lars, 2026-11-01). An audio or video slide shown has its controls on the picture (see "Audio and video while
  presenting" below).
- **The running order** fills the rest, with no heading row; Lägg till is a round glass + floating at the bottom right, as iOS 27's Notes and Reminders put
  "new" (no Redigera, as iOS 27's lists have none; Klar takes the +'s place while moving). + first asks which
  kind, a menu with Sång first, Bildspel last and under a line Programpunkt (spec 03 2f), then opens that kind's dialog alone,
  without a row of tabs (Lars, 2026-11-04: six tabs do not fit a phone); on a computer the running order's Lägg till is
  the same menu (Lars, 2026-11-05: as ProPresenter's and Planning Center's +, a computer as a phone). An item's parts are one group of rows with hairlines, as iOS's inset grouped lists, and the foot of the list
  has more room than the + takes, so the last item's … scrolls clear of it (Lars, 2026-11-04). Every part of
  every item is shown with its whole text (pictures as thumbnails); a tap on a part shows it. Each item is a
  section whose heading (name, LIVE dot, kind, …) sticks at the top until the next pushes it away. The shown part
  has a red ring and VISAS, the next NÄSTA; the ones before look as the rest (not dimmed), as one goes back to them.
- **The list follows the shown part** only when it changed some other way than a tap in the list (the arrows,
  someone controlling it remotely), and only when the part is out of view: nothing moves under a finger.
- **Markera** in an item's … opens the computer's running order in its select mode (Lars, 2026-11-02: one list, as
  iOS's lists edit), that item ticked: one row per item, ticked to remove together after a question, moved by ≡; the
  shown item can move but not be ticked. Klar ends it.
- **An item's …** (on its heading) opens the same menu as its row's (see Left below).
- **Lägg till** (Sånger, Bibel, Text) adds right after what is shown, or after the last thing added while that is
  still ahead, so several additions keep their order; "Lägg till efter" in an item's … names the place instead.
  The list goes to the new item and marks it; nothing changes on the outputs. Adding and removing can be undone.
- **Utgångar** is a sheet as high as its content (centred on an iPad held upright, as iPadOS's form sheet, as are
  the other sheets): each output with its state and a switch, then Anslut tillfällig
  utgång. The outputs are equals in the list, not nested. Anslut tillfällig utgång opens a sheet of its own as
  Fjärrstyrning's (Lars, 2026-11-03): the QR code with one line under it, then the address to open (a tap copies it)
  and the four code boxes as rows of one group, with no numbered steps and no "eller".

## Live, columns (computer, iPad lying down)

Editing sits in the middle, before and while presenting: a section's heading names the item (it is not renamed in
the app, which confused: Lars, 2026-11-02), opens its song (Redigera) or edits its pictures, and under it are the item's warnings, its player,
its arrangement and its overlay. Markera in a row's … ticks items to remove together, that row first; the column has no … of its own (Lars, 2026-11-02). On a phone
an item's … holds the same but Byt namn (Lars, 2026-11-02): Redigera (plain, not "Redigera sången": Lars, 2026-11-02), the arrangement and the
overlay.

- **The bar** is the presentation's own, the same before and while it is presented, so its name stays in one place
  (the left column has none): "‹ Presentationer" at the left; in the middle the name, LIVE only while following another's session (this window's own has the red ■: Lars, 2026-11-02), and when
  and where, which open the presentation's menu (Redigera detaljer… and Noter och länkar, Spara som mall…, and to the trash
  when not presented, each group apart); at the right round icons for Fjärrstyrning (while presented) and Inställningar, no … (Lars,
  2026-11-01), and at the far right ▶ to start or ■ to end, which asks first. The cloud shows there while the
  sync has a problem. A template has no ▶, and its ‹ goes back to Mallar.
- **Mallar** (`/templates`) is a page of its own beside the start page, not in Inställningar (Lars, 2026-11-02: a
  template opened from there left Inställningar for its editor, which felt out of place): reached by "Hantera mallar"
  beside the templates' caption in Skapa presentation, for who may change them; a round ‹ back to the start page, the
  templates as rows, + to make one. The first template is made with Spara som mall, since the picker shows only when
  there are templates.
- **Left:** the items, one row each, the shown one marked by a red dot in the room left of the row (Lars, 2026-11-02) and a tint across the
  whole row. Dragged straight away with the mouse (after 4 px, so a click still selects), Delete removes, and a
  right click or the row's … gives the item's menu, the same as its heading's … in the middle (Lars, 2026-11-03: the two
  differed), grouped as Apple groups a menu (Lars, 2026-11-03): Redigera (a song's page, or a picture item's
  pictures; a programme point's Byt namn) and Kommentar; Arrangemang › and Överlägg ›, each with the chosen one in grey and its choices in a submenu beside it,
  opened by a pointer resting on the row or a tap; Lägg till efter… (the kinds and Programpunkt, beside it), Ny
  programpunkt ovanför and Markera; and Radera last, in red. A phone's sheet of an item's … has the same groups in the
  same order (Lars, 2026-11-05: it had the list's first). No Flytta
  upp or ned: a row is dragged, or moved with Alt+↑/↓, as Apple's lists have it. In
  Markera's select mode every row has ≡, and the shown item cannot be ticked. A click scrolls the middle
  to the item. A move, removal or addition shows a line with Ångra.
- **Middle:** the whole order as sections with sticky headings, the parts as a grid of slides; a click shows one.
  The slides are 384 px, and shrink to no less than 340 px where that fits one more to a row: three on an iPad lying
  down with both columns folded (Lars, 2026-11-03; `apps/web/src/pages/presentation-editor/SlideGrid.tsx`).
- **Audio and video while presenting** (Lars, 2026-11-06): each is shown and played alone, as a slide. An audio
  item has one slide, which the outputs show as the theme's background with nothing on it, and its tile a speaker
  and the file's name; shown, it plays from its start, and any other slide shown stops it (a video does the same).
  Their controls lie on the live picture, on a computer and a phone alike, not in the slides: the audio's name and
  Tona ut at the top, play and pause, the time, the seek bar and the length at the foot (`pages/live/MediaControls.tsx`).
  On the presenting window the live picture shows the video playing, muted, following the one that plays with its
  sound in the output window (Lars, 2026-11-07; docs/live.md "Where audio and video play"); a controller's shows its
  still. Before presenting an item keeps its preview player in the slides. Moving to another page stops neither audio
  nor video: the presentation is still live.
- **Folding the columns away** (Lars, 2026-11-03), as iPadOS's and macOS's sidebars: a quiet button with a sidebar
  icon in each column's foot, at its inner edge beside its last line (the left column's at the right of the sync line;
  the live column's at the left, Fjärrstyrning at the right), folds it away ("Göm sidofält", "Göm livekolumnen"); while
  it is folded a round, lifted button floats at the middle's foot on its side and brings it out ("Visa sidofält",
  "Visa livekolumnen"), coming in once the column has slid away. One of the two shows at a time; the first is the
  column's own, so it comes and goes with the column, Starta and Avsluta presentation included
  (`apps/web/src/ui/PanelToggle.tsx`). Each column slides off its edge and back by transform only, the middle taking
  the room at once as it goes in and giving it back once it is out (`apps/web/src/ui/sidePanels.ts`); whether each is
  out is kept on the device, and a start always brings the live column out. Tested in `e2e/panels.spec.ts`.
- **No Scenläge.** The stage view is gone (Lars, 2026-11-01): the live view does it on a phone and a tablet, and a
  clicker's keys (→ ← Space PageDown PageUp, B and .) work on the live page.
- **Right:** the picture, ‹ Släck ›, the next slide, the overlays as switches (one shown at a time, drawn on the
  picture too), and the outputs folded to one line that says how they are ("3 på · 12 tittare", a green dot) and
  turns orange with what is wrong ("Kyrksal är offline"); a click unfolds the switches and Anslut tillfällig utgång.

## The start page and the bar

The bar has only the user's picture (+ for Ny presentation is in the page's heading row, as on every page that lists something). The cog and the cloud go: the picture's menu holds the
name (no role or organisation), Inställningar (Mina inställningar is a row in it; since 2026-11-04 not in the menu, as the bar's cog is the one way there), Byt organisation (only with two organisations or more), the sync's state only while it has a problem, and Logga ut, with no line under each (Lars, 2026-11-02). The cloud shows
in the bar only when the sync has a problem (pending changes, offline), with a dot on the picture; the menu says
what and offers Synka nu. The page keeps Visas nu at the top (a card as the list's, red only in its pulsing dot and the line "Visas just nu", the whole card opening it with a ›, as Music's Now Playing; the row below has only a small red dot: Lars, 2026-11-03), then Idag, Kommande and Senast ändrade, each row with
its time and place under its name and its number of items at the right, two lines at every width with no
columns (Lars, 2026-11-02). The bar has Inställningar's cog beside the picture, as a presentation's bar has it. There is one Papperskorg, a row in
Inställningar's list (Lars, 2026-11-02); no list or page has its own.

## Inställningar

On a phone a list as iOS's Settings: a search field at the top, kept there as the list scrolls (Lars, 2026-11-06), which finds a row by its name or by words of its own ("projektor" finds Fasta utgångar) and what Mina inställningar holds (Färgtema, Språk, Lagring, Inloggningsmetoder) (Lars, 2026-11-03); Mina inställningar as a profile cell under it, then Bibliotek (Sånger,
Biblar, Bilder, Ljud, Videor), Presentation (Överlägg, Etiketter; "Överlägg" in Swedish, as FreeShow says it, since it lies over the picture: Lars, 2026-11-03), Visning (Fasta utgångar, Följ med, Teman, CCLI-rapport),
Organisationen (Användare, Organisationen, Organisationer) and Om Gospel Presenter, each with a coloured icon; a row
opens its page full width, with a round ‹ alone at the left of the dialog's bar (one step up) and the page's name in
its middle (Lars, 2026-11-02); Fasta utgångar (the church's projectors, TVs and computers) and Följ med (links
and QR codes anyone opens in a browser) are pages of their own, each with its floating + (Lars, 2026-11-02: Utgångar
is the word for all that shows, so neither page is "Skärmar" nor "Publika utgångar"). Överlägg, Etiketter,
Fasta utgångar, Följ med, Teman, CCLI-rapport, Enheter and Organisationen
open with a card as iOS's Settings has: the row's icon, the page's name and what it is for; the bar names the page
once the card has scrolled away. On a computer, and on an iPad held upright (from 680 px wide and 500 high,
the `split` variant; Lars, 2026-11-02), as macOS's and iPadOS's Settings: the same list at the
left, the page at the right. It stays a dialog over the page the user is on (on a phone as iOS's page sheet: it slides up to a little under the top, its top corners rounded, the page dimmed behind it; Lars, 2026-11-03); the
list replaces the dialog's side menu. Mina inställningar is grouped rows as iOS's Settings (`ui/Group.tsx`; Lars,
2026-11-02: no box around each choice): Färgtema as three small window pictures side by side, the chosen one ringed
(macOS's Appearance, iOS's Display & Brightness); Språk as a row with a pop-up menu; Den här enheten with a row
Lagring (›, no size: Lars, 2026-11-03) and, in the desktop app, its switch; and Konto. Lagring is a page of its
own, as iOS's iPhone-lagring under Allmänt (Lars, 2026-11-03): the switch Spara kommande presentationer offline, Sparat
offline and Cache, each a group, with short texts and no row the user cannot act on;
a device that keeps nothing between reloads says so once, under the switch. The other pages of settings follow it: Organisationens inställningar's remote control is a row with a pop-up
menu and what the chosen one means under it, as macOS's; a user's and an organisation's page have their fields with no
card around them, their logins or members as a group, and Radera … as a red row of its own.
A song's page the same way (Lars, 2026-11-02, as Apple would): its facts as one card of rows (Namn, Upphovspersoner,
Förlag, År, CCLI, none side by side, hairlines between them, each a field whose name moves up as it is typed in); each part as a group, its label over its card with ⋯ for Flytta
upp, Flytta ned and Ta bort del, the card holding its text alone; Lägg till del in sky text; and at the foot one group of rows that push a page in, as
iOS's Settings pushes a page (Lars, 2026-11-03: as Historik, not sheets): Arrangemang with the order in grey, Noter och
länkar with how many, and Historik; then Ta bort sång as a red row. An arrangement's page is iOS's list in edit mode:
its parts with a red ⊖ and ≡, every part of the song under them with a green ⊕, Ta bort arrangemang in red.
The library pages alike (Lars, 2026-11-03): Sånger, Biblar, Bilder, Ljud and Videor have one title, the page's; their +
(and Sånger's Importera) floating at the bottom right; the search under the title, never in a card; the list alone in
its card, Bilder's pictures on the page itself as Photos'; "{n} bilder" under it; and the whole page takes files, shown
only while they are dragged over it (Lars, 2026-11-04: no dashed place drawn all the time).
New songs, slideshows, overlays and themes are made at once and named in their editor (Lars, 2026-11-04,
`ui/justCreated.ts`): + makes "Ny sång" and opens it, the name focused and picked; an editor with Format opens it, the
name in it. Organisationer is "Alla organisationer", so it is not taken for Organisationen above it.
Papperskorg the same, its Töm papperskorgen a red row last. Every list page in Inställningar (the library's, Användare,
Alla organisationer, Papperskorg) has the same search under its title, iOS's filled grey field as "Sök i inställningar"
(ui/ListSearch.tsx); in a library it and the row under it (the order, the views, Välj) stay at the top as the list
scrolls, and a jump to a caption stops below them (`StickyBar` in ui/PageContainer.tsx, Lars 2026-11-06). A picture has no … on it: a right click or a finger held on it opens Radera at that point, in
the menu an item has (PictureMenu); a context menu opens over dialogs. A page opened alone from outside Inställningar (a song
from a presentation) is as narrow as iPadOS's form sheet, 672 px; Inställningar's pages have 20 px at the sides and
28 px between groups. Historik as Mail and Notes: the versions under a heading for each day (Idag, Igår, a date), each row
its time; the preview beside them when the page's own column has room (576 px), else a version tapped opens on its
own with ‹ Versioner (and Escape) back.
Sånger as Music's Låtar and Contacts: the search under the title, the songs in sections by letter with an index along
the edge from 20 songs, how many in grey under the list, + for Ny sång, and beside it a round, quieter button for
Importera från ProPresenter…, floating with + in Inställningar; .pro files dropped anywhere on the page import too, and the import's progress shows only while it runs.
