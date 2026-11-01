# Not done yet

Profile pictures and logos, the mobile app (the phone layout of the web app is built), and a real
deploy to Cloudflare. The Workers adapter is tested in local workerd, and once on a real account (see [On Cloudflare](cloudflare.md)).

From milestone 5 and the media library: the S3 adapter of D31 (the interface has room for it; no adapter,
so an install that wants S3 cannot yet); organisation images as a theme's background (a theme's image is
still only a built-in asset, `backgroundImageSchema`, and there is no theme editor to choose one);
a limit on the total size of an organisation's media (only the number and size of files per kind are limited);
MEDIA-R14's eviction by when a file was last used (it is by when it arrived); HTTP Range for audio (video has it).
Dropping files onto the add
dialog's tabs is built but not dropped in an e2e test. The page's
image pipeline runs only in Chromium (Electron) in the tests; Safari cannot encode WebP in a canvas, so there
it falls back to JPEG on a white background, which is written but untested.

From templates: the keyboard in the template picker; a template is not pictured by the capture script. A
template's time and place reach a new presentation, and the start page's `n` shortcut is built; an e2e test checks
neither (templates.spec.ts asserts only the date).

From overlays: the picture on a public output (only the text is sent); reordering (spec 03 Q11, as there).
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
rather than only the newest (the stream is not a one-slot queue); the 500-viewer cap is not tested. A Durable Object with open streams does not hibernate; spec 04 and
ADR 0007 leave a Durable Object per output for when that matters.

From spec 04's paired screens: a `/display` page of an older build, still open when the server
is updated, does not know the `canvas` event and waits until it is reloaded. In local workerd a closed stream is
never noticed, not even when a ping is written: a saved screen stays Online and a public output's viewer stays
counted after the page has closed (on Node both go at once); whether Cloudflare itself notices is not known. A
four-digit code is unique across every organisation on the server: 8 999 at a time, plenty on a desktop host,
few on a shared cloud. Not tested on a real TV browser.

From spec 04's remote control: the 4-hour limits (LIVE-R42, R43) are tested only in `live-hub.test.ts` on a
clock the test moves, not on the adapters or in the app; on a Durable Object the screen timer is lost if the
object is evicted, and the next event checks instead. A session id is per window
(kept for the tab's life), also in the desktop app, rather than derived from the device token (spec 04): a
desktop that restarts starts a new session, and the old one stays frozen until someone ends it or 2 hours
pass. Two operator windows on one machine share their pointer (one BroadcastChannel) and so show as two
sessions that move together. The 2-second warning is written but not tested.

From spec 04: the stage view (Scenläge, a button on the live page, `pages/StageView.tsx`) is built for the
operator's own session and a controller's, with the Overlays button; `?stage=true` opens it. Next and previous stay within the selected
item (LIVE-R41); the page's own step keys, which cross items, are off while it is open. Its keys are a pedal's
or clicker's, as `utils.js`'s: → ↓ PageDown Space Enter next, ← ↑ PageUp previous, `.` `b` `B` blank (only
blank, as Rensa), Esc closes an open sheet or else the view; none of them in a text field. It is tested in
`e2e/milestone6.spec.ts`. The wake lock is requested but not tested.

From spec 05 and milestone 4: creating and editing themes (spec 05 and ADR 0001 have no editor yet;
the Teman page lists the built-ins and sets the default). BIBLE-R16's device-local Bibles (a translation
that never leaves the device) are not built, by decision D30: an import made offline is queued and goes
to the server (see [Bibles](bibles-and-themes.md#bibles)). Two translations with exactly the same text share it on a device, so
keeping one shows the other as "Tillgänglig offline" too (the current app's "imported here" text).

From spec 01 and milestone 3: OIDC providers other than Google, which are not planned (ADR 0007
(12)); passkey autofill (conditional mediation: the sign-in page has a button, no username field);
ending the sessions a removed passkey made (removing a login ends no session; a new invite ends them
all); trusting attestation (which authenticator made a passkey is never checked); packaging
the desktop app, so its callback scheme is registered by an installer (a development build registers
`gospelpresenter-local` only with `GP_REGISTER_SCHEME=1`) and its Google client is built in; a login
hint or profile picture from Google; more than one Google account per user (ORG-R13 allows 5);
profiles and profile images (the user page has no picture, and `/logins` stands in for Min profil), the
language switch; the organisation logo; MCP API-nycklar; listing and revoking your own
devices' sessions (D23; removing the user or pairing again are the ways today); `/admin/devices` as spec 01
has it (every device token with its version; the rewrite's page is the host's paired devices);
MCP keys and calendar feeds; the welcome modal; closing
an open poke socket when its session is revoked (it receives only sequence numbers until it closes,
and its next sync is refused); behind a reverse proxy, `X-Forwarded-Proto` and `X-Forwarded-Host`
(the Google redirect URI then needs `GP_GOOGLE_REDIRECT_BASE_URL`; see [Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)).

From spec 02 and 03 in particular, nothing big is left: song history (`packages/core/src/mutators/history.ts`), the
labels page and the CCLI report (`packages/core/src/mutators/ccli.ts`) are built; the ProPresenter import is built, `packages/core/src/propresenter.ts`; reordering items and arrangement chips by dragging is built, see
`e2e/drag.spec.ts`; so are multi-select removal and the start page's "last changed" order).

From the language switch (GAPS.md "Engelska"): the server's own pages in the system browser (a desktop sign-in's
passkey page, "Du är inloggad", the sign-in error) are Swedish only, as is the desktop host's window title. The
English that is not the current app's was written for the rewrite and has not been read by an English speaker.

From the 2.0 layout (docs/layout-2-0.md), all of it is built but these: undoing an addition, a move or a removal
(the doc's line with Ångra; a removed item is deleted at once, so removing asks first, on a phone and a computer);
the start page's Visas nu says the presentation's time and place, not the part shown; a user's picture (initials
stand in for it). Delete removes the selected item on a computer, Backspace (a Mac's delete key) does not.
The touch sizes of an iPad lying down follow `(pointer: coarse)` (the `touch:` variant in `app.css`), tested with
Chromium's touch emulation in `live-order.spec.ts`, not on an iPad; they cover the live bar, the left column, ‹ Rensa ›
and the switches, not the editor.
