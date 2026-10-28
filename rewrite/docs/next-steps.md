# Next steps

Where to pick up. Milestones 1–5, and the live work after them (stage view, remote control, public outputs,
audio, files by need, https on the LAN), are on branch `claude/milestone-1`, which also carries the latest ADR
0007 and spec (decisions up to D32); `claude/rewrite-behavior-spec` is behind it. Overlays, the first step agreed
on 2026-10-27, are built (see [Overlays](live.md#overlays)), and so are the second, starting the app on a tablet without the host
(see [Starting the app without the host](lan-https-and-addresses.md#starting-the-app-without-the-host)), and the third, the client's address behind a reverse proxy (see
[Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)), and the fourth, paired screens and the QR codes (see [Paired screens](live.md#paired-screens)). The rest, in
this order:

1. **PDF and PowerPoint import** (ADR 0007 (10), D29) and templates. Planned with Lars on 2026-10-28, which
   changes ADR 0007 (10): **no Gotenberg and no LibreOffice**. PowerPoint is rendered in the client too, once, at
   import, by an npm renderer; every page, PDF or PowerPoint, becomes a WebP picture fitting 1920×1080 and a
   thumbnail fitting 400×225, stored as media blobs like the pictures in Bilder. Other devices only download the
   pictures, and import works offline. No animations, transitions or video, as today. `.ppt` is dropped (only
   LibreOffice reads it; the tab says to save it as `.pptx`). Text from the PPTX waits, though the renderer has
   already read it. The ADR and PRES-R11 are rewritten with the code of step (c). One session per step:
   - (a) **Prototype**, thrown away: `pptx-glimpse` against `@office-kit/pptx-preview` on real files from Lars,
     with LibreOffice's PDF as the reference; time per page, and whether rendering runs in a worker with
     `OffscreenCanvas`. If neither is good enough, Gotenberg is back on the table.
   - (b) **Core and sync**, no UI (independent of (a)): item type `slides`, `content` is JSON
     `{ fileName, pages: [{ full, thumb }] }` with media hashes, a snapshot like a Bible item, no deck table.
     `addSlides` is refused with `media-missing` for an unknown hash; at most 100 pages, PRES-R10's quotas;
     the pages shown as pictures in `slides.ts`; `ORPHAN_BLOBS_SQL` counts them as used; `MediaUploads` uploads
     a waiting `addSlides`'s blobs before the push.
   - (c) **The PowerPoint tab**: PDF through pdf.js, PPTX through the renderer chosen in (a), both loaded only
     when the tab opens; the old app's markup and texts (`SlidesTab.razor`), 50 MB and 100 pages; an e2e test.
   - (d) **Templates**, as spec 03 has them (admin list, `/templates/{id}`, the picker on create, "Spara som
     mall", the trash). Slide decks go along on "Spara som mall" (PRES-R31 changes; with content-addressed
     pages a copy costs nothing).
2. **The trial deploy to Cloudflare** ran on 2026-10-28 and is kept for Lars to try (see [On Cloudflare](cloudflare.md)):
   migrating a Durable Object and D1 (`DROP COLUMN` included), Ed25519 passkeys, R2, hibernating live sockets
   and the Worker serving the web app are proven there. Left: Google sign-in against a real Google client
   (Lars makes the client; its redirect URI is `{origin}/api/auth/google/callback`), and deleting the trial
   when Lars is done. Setup and sign-in with a passkey there work in a browser, tried by hand.
3. **Getting there** (ADR 0007 (13)): the one-way import from the current app, packaging and updates per D32
   (the desktop app for macOS, Windows and Linux, and the Docker image), and the Capacitor app for tablets
   (ADR 0007 (7)), Android first and iOS later. Lars has said the Capacitor app need not come early: https on
   the LAN covers tablets for now.

Also waiting, in TODO.md: remote control as an organisation setting ("Aldrig", "Presentatören väljer",
"Alltid").

To try it with a tablet: `GP_LAN=1 GP_TLS=self-signed pnpm --filter @gp/desktop start`, then
`https://<the Mac's LAN address>:47843` on the tablet, accept the certificate warning once, and pair it under
Enheter → Anslut enhet.

The smaller gaps in [Not done yet](not-done-yet.md) can be taken along the way.
