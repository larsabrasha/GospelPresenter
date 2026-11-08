# Not done yet

What 2.0 still lacks, as Lars decided it on 2026-11-08: what is to be built, in order; what is left out; and what is
built but not tried where it will run. Checked against the code that day.

## To build

In this order (proposed; the first of Lars's list, a newer build taken at once, was built on 2026-11-08 as a quiet
swap: [Updating](lan-https-and-addresses.md#starting-the-app-without-the-host)):

1. **Calendar subscriptions** (spec 01 "Calendar subscription"): a personal secret link to an organisation's coming
   presentations, an iCal feed on the server, made and removed under Mina inställningar.
2. **Monitoring for super admins**: one page, not the current app's three (Enheter, Aktiva sessioner, Inloggade
   just nu): every device token with its user, app version and when it was last seen, and above it the
   organisations presenting now. The rewrite's Enheter is the host's paired devices only, and the sync sends the
   protocol and schema version but not the app's version.
3. **MCP** (spec 01 "MCP API key", the MCP tools of spec 02 and 03): keys, and an MCP server with the current
   app's tools (songs listed and searched, presentations read and made, songs and Bible texts added, items
   renamed, moved and removed, arrangement, time and place), each change through the same mutators as the app.
4. **Your own sessions**: listing and revoking your devices' sessions (D23; removing the user or pairing again are
   the ways today).
5. **Sign-in**: passkey autofill (conditional mediation: the sign-in page has a button, no username field); more
   than one Google account per user (ORG-R13 allows 5); removing a passkey ends the sessions it made (today
   removing a login ends no session; a new invite ends them all).
6. **Profile pictures**: initials stand in for them, in the top bar and on the user page.
7. **Backspace removes** the selected item in a presentation, as Delete does (the libraries take both already).
8. **Overlays**: their pictures and shapes on a public output (only the texts are sent, `toPublicSlide`), and
   reordering them (spec 03 Q11).
9. **A limit on an organisation's media**, set by a super admin per organisation, with a default (today only the
    number and size of files per kind are limited). How much is used shows as a bar, as iOS's storage in Settings
    does: one coloured run per kind (pictures, videos, sound, slideshows, Bibles), the free part grey, and the
    numbers beside it.
10. **A video as a theme's background** (docs/themes.md, "Not yet").

## Before 2.0 replaces the current app

A thorough review of code quality and security, of the whole rewrite, before any church moves to it (Lars,
2026-11-08). It starts from what was found first: an Admin of one organisation could take over the account of anyone
whose e-mail address they knew, a SuperAdmin's too. That was closed on 2026-11-08 by the account model of
[accounts-and-roles.md](accounts-and-roles.md), whose own gaps are listed there; the review of the rest is not done.

## Left out

Not planned for 2.0 (Lars, 2026-11-08, unless said otherwise):

- The organisation's logo (its first letter stands in) and the welcome modal.
- Undoing an addition, a move or a removal in a presentation (docs/layout-2-0.md's line with Ångra); a removed
  item is deleted at once, so removing asks first.
- The S3 adapter of D31 (the media interface has room for it; disk and R2 are built); HTTP Range for audio
  (MEDIA-R9: clients play their own copies, so nothing asks for it; video has it).
- Fonts of the organisation's own (docs/themes.md, "Not yet").
- The phone app beyond its iOS shell and sign-in ([phone-app.md](phone-app.md); the phone layout of the web app
  is built).
- The stage view (Scenläge), removed 2026-11-01, to be built again if a church needs it; a music stand for the band
  is an idea waiting for what the musicians need.
- BIBLE-R16's device-local Bibles, by decision D30: an import made offline is queued and goes to the server (see
  [Bibles](bibles-and-themes.md#bibles)).
- OIDC providers other than Google (ADR 0007 (12)); trusting attestation (which authenticator made a passkey is
  never checked).

Smaller gaps, not decided:

- MEDIA-R14's eviction by when a file was last used (it is by when it arrived); an audio item with several files.
- The keyboard in the template picker; a template is not pictured by the capture script.
- The start page's Visas nu says the presentation's time and place, not the part shown.
- The packaged desktop app's Google client built in (its package registers the callback scheme since 2026-11-03,
  [desktop-app.md](desktop-app.md); a development build registers `gospelpresenter-local` only with
  `GP_REGISTER_SCHEME=1`); a login hint or profile picture from Google.
- Closing an open poke socket when its session is revoked (it receives only sequence numbers until it closes, and
  its next sync is refused).
- Behind a reverse proxy, `X-Forwarded-Proto` and `X-Forwarded-Host` (the Google redirect URI then needs
  `GP_GOOGLE_REDIRECT_BASE_URL`; see [Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)).
- An overlay deleted while it is shown disappears from the outputs at once (spec 04 keeps it until toggled).
- The server's own pages in the system browser (a desktop sign-in's passkey page, "Du är inloggad", the sign-in
  error) are Swedish only, as is the desktop host's window title.

## Built, not tried where it runs

To try first (Lars, 2026-11-08): Safari and Cloudflare.

- **Safari**: the service worker is tested in Chromium only; whether Safari lets it answer the database worker's
  fetch of wa-sqlite's wasm is not known. Safari cannot encode WebP in a canvas, so the image pipeline falls back
  to JPEG on a white background, which is written but untested.
- **Cloudflare**: the Worker runs on gp-test, but `/watch/{code}` and `/display` were not opened in a browser
  there; the Worker serves `/sw.js` with `no-cache`, but the service worker there was not tried. In local workerd
  a closed stream is never noticed (a saved screen stays Online, a viewer stays counted); whether Cloudflare
  notices is not known. A Durable Object with open streams does not hibernate; spec 04 and ADR 0007 leave a
  Durable Object per output for when that matters.

The rest:

- A tablet over plain http keeps no page (no secure context). A device whose new build ran from the host, and
  whose new worker then failed to install before the host went, starts the older kept build against a database
  the newer one may have migrated; not handled or tested.
- Public outputs: a viewer whose network is slow gets every event in turn rather than only the newest (the stream
  is not a one-slot queue); the 500-viewer cap is not tested. A `/display` page of an older build, still open when
  the server is updated, does not know the `canvas` event and waits until it is reloaded. A four-digit code is
  unique across every organisation on the server: 8 999 at a time, plenty on a desktop host, few on a shared
  cloud. Not tested on a real TV browser.
- Remote control: the 4-hour limits (LIVE-R42, R43) are tested only in `live-hub.test.ts` on a clock the test
  moves; on a Durable Object the screen timer is lost if the object is evicted, and the next event checks
  instead. A session id is per window (kept for the tab's life), also in the desktop app, rather than derived from
  the device token (spec 04): a desktop that restarts starts a new session, and the old one stays frozen until
  someone ends it or 2 hours pass. Two operator windows on one machine share their pointer and so show as two
  sessions that move together. The 2-second warning is written but not tested.
- Dropping files onto the add dialog's tabs is built but not dropped in an e2e test. A template's time and place
  reach a new presentation, and the start page's `n` shortcut is built; an e2e test checks neither
  (templates.spec.ts asserts only the date). The pictures in an overlay are tested in the unit tests, not drawn in
  an e2e test.
- The touch sizes of an iPad lying down follow `(pointer: coarse)` (the `touch:` variant in `app.css`), tested
  with Chromium's touch emulation in `live-order.spec.ts`, not on an iPad; they cover the live bar, the left
  column, Släck and the switches, not the editor.
- Two translations with exactly the same text share it on a device, so keeping one shows the other as
  "Tillgänglig offline" too.
- The English that is not the current app's was written for the rewrite and has not been read by an English
  speaker.
