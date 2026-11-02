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
apart from it. Before it is presented the picture, Rensa and the live column are not there, a part
tapped shows nothing, and ▶ starts it.

- **The bar:** back (to the start page; the presentation keeps running), the title with a line under it
  (`● LIVE · 10:00 · Kyrksalen`; LIVE until Avsluta, also while Rensa has blacked the outputs), and at the right
  one glass button in two parts: … and ■, which ends the presentation (asking first). Start and stop are always an
  icon at the far right of the bar, on a phone and a computer (Lars, 2026-11-01).
  The title never wraps: one line each, a fixed height, the place cut with "…" first. A tap on it opens the
  presentation's menu, the same as on a computer (Lars, 2026-11-02): Redigera detaljer… and Noter och länkar, Spara
  som mall…, and to the trash when not presented.
- **…** holds only what the title's menu does not, in groups as on iOS (Lars, 2026-11-02): Utgångar, Overlays and
  Fjärrstyrning; then Inställningar. Spara offline is the line under the running order while it is kept. "…" in a
  menu only where a dialog asks first. There is no
  Scenläge: the live view is it on a phone and a tablet (Lars, 2026-11-01).
- **The description** sits at the top of the left column on a computer, on a flat card a step lighter than the column, as
  a group in iOS's Settings (Lars, 2026-11-02), three lines with mer at the end of the last to unfold the rest.
  A phone leaves it out of the running order, to keep the room for the parts (Lars, 2026-11-02); Redigera detaljer…
  has it. The picture while presenting is at most a fifth of the screen high, for the same reason.
  A phone lying down has two columns: the running order at the left, the picture and ‹ Rensa › at the right, the +
  at the foot of the order (Lars, 2026-11-02).
- **The picture** that is shown, with **‹ Rensa ›** right under it (Rensa only blacks the outputs, and
  rests while they are black: a part tapped or an arrow shows one again, as ProPresenter's Clear; no "Visa igen").
  Meanwhile no part is marked as shown, not VISAS, nor the item's dot; only the bar's LIVE stays. The part last
  shown keeps a thin grey border, no words, and NÄSTA stays on the one after it: what → (or a pedal) shows next
  (Lars, 2026-11-01). An audio or video item adds a player line between them:
  pause, the time and how far it is.
- **The running order** fills the rest, with no heading row; Lägg till is a round glass + floating at the bottom right, as iOS 27's Notes and Reminders put
  "new" (no Redigera, as iOS 27's lists have none; Klar takes the +'s place while moving). Every part of
  every item is shown with its whole text (pictures as thumbnails); a tap on a part shows it. Each item is a
  section whose heading (name, LIVE dot, kind, …) sticks at the top until the next pushes it away. The shown part
  has a red ring and VISAS, the next NÄSTA; the ones before look as the rest (not dimmed), as one goes back to them.
- **The list follows the shown part** only when it changed some other way than a tap in the list (the arrows,
  someone controlling it remotely), and only when the part is out of view: nothing moves under a finger.
- **Markera** in an item's … opens the computer's running order in its select mode (Lars, 2026-11-02: one list, as
  iOS's lists edit), that item ticked: one row per item, ticked to remove together after a question, moved by ≡; the
  shown item can move but not be ticked. Klar ends it.
- **An item's …** (on its heading) offers Lägg till efter…, Markera and Ta bort.
- **Lägg till** (Sånger, Bibel, Text) adds right after what is shown, or after the last thing added while that is
  still ahead, so several additions keep their order; "Lägg till efter" in an item's … names the place instead.
  The list goes to the new item and marks it; nothing changes on the outputs. Adding and removing can be undone.
- **Utgångar** is a sheet as high as its content (centred on an iPad held upright, as iPadOS's form sheet, as are
  the other sheets): each output with its state and a switch, then Anslut tillfällig
  skärm. The outputs are equals in the list, not nested.

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
  sync has a problem. A template has no ▶.
- **Left:** the items, one row each, the shown one marked by a red dot in the room left of the row (Lars, 2026-11-02) and a tint across the
  whole row. Dragged straight away with the mouse (after 4 px, so a click still selects), Delete removes, and a
  right click or the row's … gives Redigera (a song's), Lägg till efter, Flytta upp, Flytta ned, Markera and Ta bort; in
  Markera's select mode every row has ≡, and the shown item cannot be ticked. A click scrolls the middle
  to the item. A move, removal or addition shows a line with Ångra.
- **Middle:** the whole order as sections with sticky headings, the parts as a grid of slides; a click shows one.
- **No Scenläge.** The stage view is gone (Lars, 2026-11-01): the live view does it on a phone and a tablet, and a
  clicker's keys (→ ← Space PageDown PageUp, B and .) work on the live page.
- **Right:** the picture, ‹ Rensa ›, the next slide, the overlays as switches (one shown at a time, drawn on the
  picture too), and the outputs folded to one line that says how they are ("3 på · 12 tittare", a green dot) and
  turns orange with what is wrong ("Kyrksal är offline"); a click unfolds the switches and Anslut tillfällig skärm.

## The start page and the bar

The bar has only the user's picture (+ for Ny presentation is in the page's heading row, as on every page that lists something). The cog and the cloud go: the picture's menu holds the
name (no role or organisation), Inställningar (Mina inställningar is a row in it), Byt organisation (only with two organisations or more), the sync's state only while it has a problem, and Logga ut, with no line under each (Lars, 2026-11-02). The cloud shows
in the bar only when the sync has a problem (pending changes, offline), with a dot on the picture; the menu says
what and offers Synka nu. The page keeps Visas nu at the top, then Idag, Kommande and Senast ändrade, each row with
its time and place under its name and its number of items at the right, two lines at every width with no
columns (Lars, 2026-11-02). The bar has Inställningar's cog beside the picture, as a presentation's bar has it. There is one Papperskorg, a row in
Inställningar's list (Lars, 2026-11-02); no list or page has its own.

## Inställningar

On a phone a list as iOS's Settings: Mina inställningar as a profile cell at the top, then Bibliotek (Sånger,
Biblar, Bilder, Ljud, Videor), Presentation (Overlays, Mallar, Etiketter), Visning (Skärmar, Publika utgångar, Teman, CCLI-rapport),
Organisationen (Användare, Organisationen, Organisationer) and Om Gospel Presenter, each with a coloured icon; a row
opens its page full width, with a round ‹ alone at the left of the dialog's bar (one step up) and the page's name in
its middle (Lars, 2026-11-02); Skärmar and Publika utgångar are pages of their own, each with its floating + (Lars,
2026-11-02). Overlays, Mallar, Etiketter, Skärmar, Publika utgångar, Teman, CCLI-rapport, Enheter and Organisationen
open with a card as iOS's Settings has: the row's icon, the page's name and what it is for; the bar names the page
once the card has scrolled away. On a computer as macOS's System Settings: the same list at the
left, the page at the right. It stays a dialog over the page the user is on (filling the screen on a phone); the
list replaces the dialog's side menu.
