# The 2.0 layout

Version 2.0 leaves the current app's look (docs/look.md) where this file says so, decided with Lars on
2026-11-01 from a clickable mockup: <https://claude.ai/artifact/7cD8NA2ZyiHmFC36SnvP53> (private to Lars; the
canvas "Gospel Presenter 2.0"). The look follows iOS 26 on a phone and macOS on a computer: dark cells
(`#1c1c1e`) on black, round glass buttons in the bar, sheets that float off the edges, the app's sky blue as its
colour. Everything not named here keeps the current look.

## Colours

One scale for the whole app, iOS's grouped one, named in the Tailwind theme (`apps/web/src/app.css`): `ground`
(the page: `#ebebf0` light, black dark), `surface` on it (cards, panels, dialogs, the bar, a list's rows: white,
`#1c1c1e`), `raised` on a surface (fields, pills, secondary buttons, rows inside a card: `#f2f2f7`, `#2c2c2e`) and
`raised-2` a step further (hover), hairline `separator`s, and a sheet's own `sheet` with its rows in `sheet-cell`.
Light mode's ground is a step darker than iOS's `#f2f2f7`, so a white row stands out on it. A class names the role
(`bg-surface`), never a grey; the old `neutral` greys remain only for text, icons and fields' borders.

## One rule across the app

The bar opens things (sheets, menus, other views); actions on what is shown sit by it. Nothing in a bar both
changes the view and acts. What is used all the time is always in view, what is used now and then is a tap away,
and what is set once lives in a menu.

## The layout follows the width

At least about 1 000 pt wide (a computer, an iPad lying down) the app has columns; narrower (a phone, an iPad held
upright) it is one column with sheets. An iPad lying down is the computer's layout with touch sizes: rows and
buttons at least 44 pt, and an item dragged by its ≡ so a finger still scrolls; a mouse or trackpad drags the
whole row.

## Live, one column (phone, iPad upright)

- **The bar:** back (to the start page; the presentation keeps running), the title with a line under it
  (`● LIVE · 10:00 · Kyrksalen`; `RENSAD` in grey instead of `LIVE` while the outputs are black), and at the right
  one glass button in two parts: Utgångar (with the number on, green) and ….
  The title never wraps: one line each, a fixed height, the place cut with "…" first. A tap on it opens
  **Om presentationen**: time, place, the whole description, and Redigera.
- **…** holds Om presentationen, Scenläge, Overlays, Fjärrstyrning and, last and red, Avsluta presentation, which
  asks first. Avsluta stays there: it is mostly done from the computer.
- **The picture** that is shown, with **‹ Rensa ›** right under it (Rensa becomes a white "Visa igen" while the
  outputs are black). An audio or video item adds a player line between them:
  pause, the time and how far it is.
- **The running order** fills the rest, its heading row fixed (Ordning, Redigera, Lägg till). Every part of
  every item is shown with its whole text (pictures as thumbnails); a tap on a part shows it. Each item is a
  section whose heading (name, LIVE dot, kind, …) sticks at the top until the next pushes it away. The shown part
  has a red ring and VISAS, the next NÄSTA, the ones before are dimmed.
- **The list follows the shown part** only when it changed some other way than a tap in the list (the arrows,
  someone controlling it remotely), and only when the part is out of view: nothing moves under a finger.
- **Redigera** folds the list to one row per item, moved by ≡ and removed by a red minus; the shown item can move
  but not be removed. Klar ends it.
- **An item's …** (on its heading) offers Lägg till efter, Flytta (Redigera) and Ta bort.
- **Lägg till** (Sånger, Bibel, Text) adds right after what is shown, or after the last thing added while that is
  still ahead, so several additions keep their order; "Lägg till efter" in an item's … names the place instead.
  The list goes to the new item and marks it; nothing changes on the outputs. Adding and removing can be undone.
- **Utgångar** is a sheet as high as its content: each output with its state and a switch, then Anslut tillfällig
  skärm. The outputs are equals in the list, not nested.

## Live, columns (computer, iPad lying down)

- **The bar:** "‹ Presentationer" at the left; in the middle the title, LIVE and the time and place, which open a
  popover with all of it and Redigera; at the right Scenläge, … (Fjärrstyrning, Kortkommandon) and a red Avsluta.
- **Left:** the items, one row each, the shown one marked by a red dot left of its name and a tint across the
  whole row. Dragged straight away with the mouse (after 4 px, so a click still selects), Delete removes, and a
  right click or the row's … gives Lägg till efter, Flytta upp, Flytta ned and Ta bort. A click scrolls the middle
  to the item. A move, removal or addition shows a line with Ångra.
- **Middle:** the whole order as sections with sticky headings, the parts as a grid of slides; a click shows one.
- **Right:** the picture, ‹ Rensa ›, the next slide, the overlays as switches (one shown at a time, drawn on the
  picture too), and the outputs folded to one line that says how they are ("3 på · 12 tittare", a green dot) and
  turns orange with what is wrong ("Kyrksal är offline"); a click unfolds the switches and Anslut tillfällig skärm.

## The start page and the bar

The bar has only + (Ny presentation) and the user's picture. The cog and the cloud go: the picture's menu holds the
name and role, Mina inställningar, Inställningar, Byt organisation, the sync's state and Logga ut. The cloud shows
in the bar only when the sync has a problem (pending changes, offline), with a dot on the picture; the menu says
what and offers Synka nu. The page keeps Visas nu at the top, then Idag, Kommande and Senast ändrade, each row with
its time, place and number of items, and Papperskorg last. On a computer the groups are tables.

## Inställningar

On a phone a list as iOS's Settings: Mina inställningar as a profile cell at the top, then Bibliotek (Sånger,
Biblar, Bilder, Ljud, Videor), Presentation (Overlays, Mallar, Etiketter), Visning (Skärmar, Teman, CCLI-rapport),
Församlingen (Användare, Församlingen, Organisationer) and Om Gospel Presenter, each with a coloured icon; a row
opens its page full width with "‹ Inställningar". On a computer as macOS's System Settings: the same list at the
left, the page at the right. This replaces the admin dialog and its side menu.
