# Not done yet

Slide-deck pages, profile pictures and logos, English text, mobile, and a real deploy to
Cloudflare. The Workers adapter is tested in local workerd, and once on a real account (see [On Cloudflare](cloudflare.md)).

From milestone 5 and the media library: the S3 adapter of D31 (the interface has room for it; no adapter,
so an install that wants S3 cannot yet); organisation images as a theme's background (a theme's image is
still only a built-in asset, `backgroundImageSchema`, and there is no theme editor to choose one);
a limit on the total size of an organisation's media (only 1 000 pictures and 10 MiB per blob are limited); MEDIA-R14's eviction
by when a file was last used (it is by when it arrived); live and public URLs
(MEDIA-R10) and `/api/watch` with it; HTTP Range for audio; a native file dialog for "Importera" (the page's
file input is used, also in Electron); dropping files onto the add dialog. The page's
image pipeline runs only in Chromium (Electron) in the tests; Safari cannot encode WebP in a canvas, so there
it falls back to JPEG on a white background, which is written but untested.

From templates: their time and place reach a new presentation only as its date, as presentations have no
event time or place yet; the `n` shortcut on the start page and the keyboard in the picker; the templates page
is ordered by name, not by when a template was last changed; a template is not pictured by the capture script.

From overlays: the picture on a public output (only the text is sent); reordering (spec 03 Q11, as there);
saving 500 ms after typing with "Sparad" in the header, as songs do now (a field saves when it loses focus); dropping a file onto the
overlay page (the picture comes from Bilder); the 500 ms fade of the black screen, which would cover the overlay.
An overlay deleted while it is shown disappears from the outputs at once (spec 04 keeps it until toggled). The
picture in an overlay is tested in the unit tests (which files are fetched), not drawn in an e2e test.

From the service worker: a tablet over plain http keeps no page (no secure context). Nothing tells the user that
a newer build is waiting while the app runs from its kept copy; the sync's update message is all, and a reload
fetches it. The worker is tested in Chromium only: whether Safari lets it answer the database worker's fetch of
wa-sqlite's wasm (a dedicated worker inherits its page's service worker in Chromium) is not known. A device
whose new build ran from the host, and whose new worker then failed to install before the host went, starts the
older kept build against a database the newer one may have migrated; that is not handled or tested. On
Cloudflare the Worker serves `/sw.js` with `no-cache`, but the service worker there was not tried in a browser.

From audio: HTTP Range on `/api/media`
(MEDIA-R9: clients play their own copies, so nothing asks for it yet); an item with several files.

From spec 04's public outputs: on Cloudflare `/watch/{code}` and `/display` get the app's
`index.html` as on Node, not opened in a browser there; a viewer whose network is slow gets every event in turn
rather than only the newest (the stream is not a one-slot queue); the 500-viewer cap is not tested; texts are
Swedish only, not per Accept-Language. A Durable Object with open streams does not hibernate; spec 04 and
ADR 0007 leave a Durable Object per output for when that matters.

From spec 04's paired screens: the 4-hour idle unbinding of LIVE-R43; a saved screen whose session has
ended shows its name rather than plain black; a `/display` page of an older build, still open when the server
is updated, does not know the `canvas` event and waits until it is reloaded. In local workerd a closed stream is
never noticed, not even when a ping is written: a saved screen stays Online and a public output's viewer stays
counted after the page has closed (on Node both go at once); whether Cloudflare itself notices is not known. A
four-digit code is unique across every organisation on the server: 8 999 at a time, plenty on a desktop host,
few on a shared cloud. Not tested on a real TV browser.

From spec 04's remote control: `?stage=true` in the link; the
4-hour idle eviction of LIVE-R42 (only an abandoned session, 2 hours without its owner, is ended); the
superadmin's Aktiva sessioner. A session id is per window
(kept for the tab's life), also in the desktop app, rather than derived from the device token (spec 04): a
desktop that restarts starts a new session, and the old one stays frozen until someone ends it or 2 hours
pass. Two operator windows on one machine share their pointer (one BroadcastChannel) and so show as two
sessions that move together. The 2-second warning is written but not tested.

From spec 04: the stage view (Scenläge, a button on the live page, `pages/StageView.tsx`) is built for the
operator's own session and a controller's, with the Overlays button; no `?stage=true` in
the URL. Next and previous stay within the selected
item (LIVE-R41); the page's own step keys, which cross items, are off while it is open. Its keys are a pedal's
or clicker's, as `utils.js`'s: → ↓ PageDown Space Enter next, ← ↑ PageUp previous, `.` `b` `B` blank (only
blank, as Rensa), Esc closes an open sheet or else the view; none of them in a text field. It is tested in
`e2e/milestone6.spec.ts`. The wake lock is requested but not tested.

From spec 05 and milestone 4: creating and editing themes (spec 05 and ADR 0001 have no editor yet;
the Teman page lists the built-ins and sets the default), the stage view and the public output, and
the theme's Media style (there are no media slides). BIBLE-R16's device-local Bibles (a translation
that never leaves the device) are not built, by decision D30: an import made offline is queued and goes
to the server (see [Bibles](bibles-and-themes.md#bibles)). Two translations with exactly the same text share it on a device, so
keeping one shows the other as "Tillgänglig offline" too (the current app's "imported here" text).

From spec 01 and milestone 3: OIDC providers other than Google, which are not planned (ADR 0007
(12)); passkey autofill (conditional mediation: the sign-in page has a button, no username field);
ending the sessions a removed passkey made (removing a login ends no session; a new invite ends them
all); trusting attestation (which authenticator made a passkey is never checked); any mail at all (an admin's new invite link is the reset); packaging
the desktop app, so its callback scheme is registered by an installer (a development build registers
`gospelpresenter-local` only with `GP_REGISTER_SCHEME=1`) and its Google client is built in; a login
hint or profile picture from Google; more than one Google account per user (ORG-R13 allows 5);
profiles and profile images, `/settings` and the
language switch; organisations other than the one setup makes, the SuperAdmin switcher and super admin
pages; a user in several organisations (D1 leaves it for later); listing and revoking your own
devices' sessions (D23; removing the user or pairing again are the ways today); `/admin/devices`;
MCP keys and calendar feeds; the welcome modal; closing
an open poke socket when its session is revoked (it receives only sequence numbers until it closes,
and its next sync is refused); behind a reverse proxy, `X-Forwarded-Proto` and `X-Forwarded-Host`
(the Google redirect URI then needs `GP_GOOGLE_REDIRECT_BASE_URL`; see [Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)).

From spec 02 and 03 in particular: song history (SONG-R20–R24, D9), the labels page, CCLI, ProPresenter
import, the dashboard's Idag/Kommande sections and "last changed" order, event time, place,
description and theme, multi-select removal, the keyboard help dialog, the song editor inside the add
dialog, the clash warning of D18, and dropping files (reordering items and arrangement chips by dragging is
built, see `e2e/drag.spec.ts`).
