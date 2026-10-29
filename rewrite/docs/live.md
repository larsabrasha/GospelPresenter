# Live: overlays, paired screens, remote control and public outputs

## Overlays

Text, a picture, or both, shown above the live slide (spec 03 §4, spec 04 LIVE-R15). An overlay is a synced row in
`overlays` (title, text up to 2 000 characters, the id of a library picture, `sort` in the order of creation), and an
item names the one it carries in `presentation_items.overlay_id`. Everyone may make,
change and delete them (ManageOverlays is every role's, as in spec 01), at most 200. Overlays (`/admin/overlays`)
lists them with a preview; one overlay's page has Titel, Textinnehåll and a picture chosen from Bilder, each saved
when the field loses focus, a preview, and Radera, which asks first and is permanent (no trash). Deleting one
leaves no item carrying it.

**During live.** The live pointer carries `overlayId`, so the overlay travels with the slide in the same message
and every output draws it above the slide (text top left, 40 px, 60 % white; the picture over the whole stage,
contained). The live page has Overlays (collapsed, a dot while one is on) with a toggle each, at most one on; the
stage view has the same behind its Overlays button. The rules are one pure function, `applyLiveChange` in
`packages/core/src/live.ts`, which the presenting window runs for its own clicks and for a controller's commands:

- An item that carries an overlay switches it on when it goes live and off when it leaves, if it is still the one
  shown. The overlay shows on every slide of the item (per item, not per slide; decided 2026-10-27).
- A manual toggle lasts until the item changes: switched off, it stays off on the item's other slides; going back
  to the item switches it on again. An overlay chosen by hand that is not the left item's own stays when the item
  is left (Lars's choice, 2026-10-27).
- "Svart skärm" and stopping switch the overlay off (a change from LIVE-R16, TODO.md 2026-10-27). Back from
  black on the same item, it stays off, as after a manual off.
- Switching an overlay on while black ends the black screen, as selecting a slide does (LIVE-R11).

A controller sends `overlayId` only when it toggles; its slide commands leave the overlay to the presenting
window. A public output gets the overlay's text with the slide, centred near the top (spec 04 §6), but not its
picture. The editor has an Overlay choice for the selected item, draws the overlay on the item's tiles, and the
running order and the live page name the overlay an item carries.

**Files.** Every overlay's picture is fetched with the presentation's files: ahead on a device that keeps its
data, else once a presentation is open, since any overlay can be switched on during live. "Alla bilder och ljud
finns på den här enheten" counts them.

## Paired screens

A TV or a PC in the church opens `/display` at the server, the cloud's or the desktop host's, and shows a
session (spec 04 §5). It signs in to nothing and is no paired device; on a desktop host `/api/display/` and
`/api/screen` answer it like `/api/watch/`. Spec 04 has paired screens on the web host only (LIVE-R52); Lars
chose on 2026-10-27 to have them on the desktop host too, so a TV on the church's LAN works without the
internet. A screen draws the projector's canvas, as the output window does (`SlideView`, spec 04 §5 "same
rendering as `/live`"), and like every output never shows an error or reconnection screen (LIVE-R33). Two kinds:

- **A saved screen** is a row in `displays` of kind `screen` (organisation schema 9, no new column; an older
  app must update first, since it would list it as a public output). An admin adds it under Skärmar → Skärmar
  ("Lägg till"), and the TV opens its link, `/display?id={code}&name={name}`, as a QR code or text. Its code
  is in the global index with the public outputs' (`watch_codes`), but each answers at its own path only. It is
  online while its page has a stream open (`/api/display/{code}/stream`); the live hub sends every socket which
  outputs are online, so Skärmar shows Online or Offline and Utgångar can switch it on only then (LIVE-A21). A
  page that closes switches it off (LIVE-R24, LIVE-A20), once it has not come back for 15 s
  (`SCREEN_GRACE_MS`): a TV whose Wi-Fi blinks reconnects within that and stays on, and Lars chose on
  2026-10-27 that a blink should not count as a closed page. Unbound, it shows its name.
- **A temporary screen** is paired for one session. `/display` asks `POST /api/screen` for a code: four digits
  in [1000, 9998], unique among live codes, good for 10 minutes and single use (LIVE-R28), and asks again every
  3 s until paired, getting a new code once the old one has run out. Its id is 32 random bytes, kept in the
  tab (`sessionStorage`), and is its only credential (ADR 0007 decision 5). Since an unpaired screen belongs to
  no organisation, it lives in the global tables (`screens`, `screen_tokens`, global schema 6), and a stream is
  found by its id at `/api/screen/{id}/stream`. "Anslut tillfällig skärm" under Utgångar pairs it, by the four
  digits typed into four boxes (`POST /api/live/screens/claim`; a wrong code counts against the address with
  the setup token and device pairing codes), or by a QR code of `/display?token={token}`: 32 random bytes,
  single use, 10 minutes, renewed every 8 minutes while the dialog is open and dropped when it closes. The TV
  that opens it is paired at once and its address becomes `/display`; the dialog learns which screen used the
  token by asking every 2 s. Either way the screen is switched on, as "Tillfällig skärm (n)". ✕, or the end of
  the session, lets it go: the TV gets `unpaired` and shows a new code. A screen nobody pairs is forgotten after
  a day. Making screens counts against the address too (30 in 15 minutes), so one machine cannot fill the table.

The other QR codes: a public output's (Visa QR-kod, with "Ladda ner som bild": `qr-{code}.png`, 24 pixels per
module, error correction M), remote control's on the live page, and device pairing's under Enheter (on the
LAN), whose code rides in the fragment, `/#pair={code}`, so no server sees it; the pairing page fills its form
from it and takes it out of the address. They are drawn in the page with `uqr` (no service sees a link), and
built against the host's LAN address on a desktop host.

**What a screen gets.** It has no database, so the owner reports, beside the public slide, the canvas
(`canvasSchema` in `live-protocol.ts`): the slide as data, the theme's id, and the overlay's text and picture;
null is black. The hub sends a screen `canvas` events and a public output `slide` events as before, so `/watch`
gets nothing new. A screen is bound to the session by an operator, as the projector is, so it gets what the
projector draws; what that adds to the public slide is only the overlay's picture and "nothing selected". Its
pictures come through its own path (`/api/screen/{id}/image/{hash}`, `/api/display/{code}/image/{hash}`): the
slide's under the public output's rule (LIVE-R32), and the overlay's only while that overlay is the one the
session's pointer has on and has that picture (LIVE-R34). An owner of an older build sends no canvas: its screens
draw the public slide on the canvas, without the overlay's picture. A screen that is bound draws black while the
session is black, rather than waiting with its name, as `Display.razor`. The live socket has no version number:
the field is optional, as every field added before it, and the largest report is now 192 KiB, as it carries the
slide twice.

Tested in `apps/server/test/screens.test.ts` (three adapters: code, QR token, single use, letting go, a saved
screen online and off, another organisation; the canvas to a screen and the public slide to `/watch` from the
same session, an older owner, black, and the overlay's picture to a screen and never to `/watch`) and
`apps/desktop/e2e/screens.spec.ts` (LIVE-A17 to A21, a TV played by Playwright's Chromium; the canvas, its theme,
black, and a picture item's picture); the QR codes in `watch.spec.ts`, `remote.spec.ts` and, through `pair()`,
`https.spec.ts`.

## Remote control

Every window that presents owns its session and drives its own outputs from its own state; only the
selection travels (ADR 0004, ADR 0007 decision 4). This holds for a browser as for the desktop app: there is
no server-side slide and no second kind of session. Each operator window keeps one WebSocket to
`/api/live/socket` (`apps/web/src/live/remote.ts`), reconnecting after 0, 2, 5, 10 s and then every 30 s
(LIVE-R51). Over it the owner reports its whole state on connect, on every reconnect and on every change
(LIVE-R47): presentation, device name, "Tillåt fjärrstyrning" and the pointer. Every member's window gets the
organisation's sessions as they change. A controller sends an absolute command (item, part, black); the server
forwards it to the owner's socket only, never queued (LIVE-R48), and refuses it while remote control is off or
the owner is gone. The owner applies it if it still makes sense (presenting, item exists, not already showing;
LIVE-R49), whichever page is open (`apps/web/src/live/owner.ts`), and its next report is what everyone sees.
A controller's own click shows at once; if the owner has not confirmed it within 2 s, it warns once.

**On the server** (`apps/server/src/live-hub.ts`) the same code runs in process on Node and in the
organisation's Durable Object. Sessions are rows in a server-only table, `live_sessions`, and which socket owns
which session is kept on the socket (a hibernatable socket's attachment), so a Durable Object may hibernate
between messages. Every hub call runs in the organisation's queue, so a live write never lands inside a
mutation's transaction. Only the user who first reported a session id may report it again. A lost owner
freezes the session (LIVE-R50): it stays, cannot be driven, and anyone in the organisation may then end it
("Avsluta presentationen"); after 2 hours without its owner it is ended when the sessions are next read.
Starting and controlling need `ManagePresentations` (ADR 0007 decision 5), which every role has, so any
member may control, as LIVE-R38 says. The poke sockets are now tagged `poke` in the Durable Object, so a
poke never goes to a live socket.

**In the app.** On the live page, "Tillåt fjärrstyrning" (it stays on for the window, LIVE-R39) has a QR code
button beside it, grey while off, for the "Fjärrstyr presentationen" dialog (`RemoteControlInfoDialog.razor`):
the link, `/live/{id}?remote=1&session={id}`, as a QR code, and folded under it the link to copy and how to take
control from the app. The first time it is switched on on a live page, the dialog opens by itself. On a desktop
host the link has its LAN address. Under Presentationer every other
window of the organisation sees "Visas just nu · {name}" with "Ta kontroll" for each session that allows it
(LIVE-A27). The controller's live page has the amber banner, the same grid, the black screen and the stage view,
no "Extern skärm", and "Bara datorn som presenterar kan stoppa presentationen." instead of Avsluta. With
several candidates it asks which; otherwise it says "Ingen aktiv presentation just nu", "Fjärrstyrning är inte
aktiverad av presentatören" or that the presenting computer lost contact. Tested in `apps/server/test/live.test.ts`
(three adapters) and `apps/desktop/e2e/remote.spec.ts` (two desktops).

## Public outputs

An admin makes a public output under Skärmar (`/admin/displays`): a synced row in `displays` with a name and
a 7-character code from `abcdefghjkmnpqrstuvwxyz23456789` (LIVE-R30; at most 50 per organisation). Anyone
opens `/watch/{code}`, signed in or not, on a phone or a tablet. Since a viewer has nothing but the code, the
server keeps a global index of codes (`watch_codes`, global schema version 5), which it brings up to date after
a push that made, renewed or deleted an output (`apps/server/src/watch.ts`). A code another organisation
already holds is not taken over; with 31^7 codes that is unlikely, and "Ny kod" is the way out.

The presenting window chooses its outputs under Utgångar on the live page (kept for the window, as the
current app keeps its output configuration) and sends, with its live report, the slide as data: kind, text,
verses, picture hash, credits and theme id, never HTML (D25). It builds it from its own copy, so viewers see
what its projector shows; black and nothing selected are the waiting screen (LIVE-R14). One session per
output (LIVE-R23): taking an output from another presentation asks first ("Ta över"). The live hub keeps the
binding (`live_bindings`) and the viewers. `GET /api/watch/{code}/stream?v={viewer}` is server-sent events:
the output's name and the organisation's first, then the newest state and every change, a ping every 15 s
(LIVE-R35). At most 500 viewers per output; a reconnect under the same viewer id (kept in the tab) replaces its
old stream and is never refused (LIVE-R36). Viewer counts reach the operators at most every 2 s.
`GET /api/watch/{code}/image/{hash}` serves a picture only while it is on that output (LIVE-R32), with
`private, max-age=3600` rather than spec 04's `public` (LIVE-R34), so no shared cache serves it after it left
the screen. The owner's report alone does not make a picture public: the server also checks that it is a
picture of an item in the presentation the session shows, so a changed client cannot publish any picture of the
library through an output. Guessing codes is slowed: an unknown code counts as a failure for the address, and
after 20 in 15 minutes the address gets 429 for 15 minutes on every `/api/watch/` request (`lookupThrottled`). A
real code never counts, however many viewers share an address. A frozen session keeps its last slide on the outputs; an ended one shows the waiting
screen. A new code or a deleted output disconnects its viewers at once, and their page says the code no
longer exists. On a desktop host, `/api/watch/` answers unpaired devices too (it is the one anonymous API).

The page (`apps/web/src/pages/Watch.tsx`) opens no database. It uses the theme's colours, fonts and
background, and sizes the text from the viewport, never larger than the theme's size (LIVE-R31):
`clamp(18px, min(size/1920·160 vw, size/1080·100 vh), size px)`, credits at least 11 px. It is `noindex`, and its
title is the organisation's name. Tested in `apps/server/test/watch.test.ts` (three adapters) and
`apps/desktop/e2e/watch.spec.ts` (a phone played by Playwright's Chromium).
