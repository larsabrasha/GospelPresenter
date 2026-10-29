# Next steps

Where to pick up. Milestones 1–5, and the live work after them (stage view, remote control, public outputs,
audio, files by need, https on the LAN), are on branch `claude/milestone-1`, which also carries the latest ADR
0007 and spec (decisions up to D32); `claude/rewrite-behavior-spec` is behind it. Overlays, the first step agreed
on 2026-10-27, are built (see [Overlays](live.md#overlays)), and so are the second, starting the app on a tablet without the host
(see [Starting the app without the host](lan-https-and-addresses.md#starting-the-app-without-the-host)), and the third, the client's address behind a reverse proxy (see
[Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)), and the fourth, paired screens and the QR codes (see [Paired screens](live.md#paired-screens)). The rest, in
this order:

1. **PDF import** (ADR 0007 (10), D29) and templates. Decided with Lars on 2026-10-28, which changes ADR 0007
   (10): **only PDF is imported**. A PowerPoint, Keynote or Google Slides deck is saved as PDF by the user first,
   in the program that made it, with its own fonts; no Gotenberg, no LibreOffice, no PowerPoint renderer in the
   client. Every page becomes a WebP picture fitting 1920×1080 and a thumbnail fitting 400×225, rendered once, at
   import, by pdf.js in the client, and stored as media blobs like the pictures in Bilder. Other devices only
   download the pictures, and import works offline. A picked or dropped `.pptx` or `.ppt` is refused with how to
   save it as PDF in PowerPoint, Keynote and Google Slides (the old app took both through Gotenberg). One
   session per step:
   - (a) **Prototype**, done on 2026-10-28 and thrown away: PowerPoint rendered in the client by `pptx-glimpse`,
     `@office-kit/pptx-preview` and `@aiden0z/pptx-renderer`. Office-kit drew sermon-like text best but refused a
     file another tool wrote; glimpse read every file but lost bold and wrapping; aiden0z draws DOM, which has to
     be captured with html-to-image. Lars then chose PDF only, as simpler and cheapest. Two findings hold for
     PDF too: neither Chromium nor WebKit draws an SVG in a worker (`createImageBitmap` cannot decode it), and
     WebKit's canvas does not encode WebP (`convertToBlob`/`toBlob` silently give PNG), so Safari and iPads
     need a WASM WebP encoder or another format. Converting PowerPoint can come back later (local LibreOffice
     first, then Gotenberg on Lars's server; Cloudflare Containers need Workers Paid) without changing how pages
     are stored.
   - (b) **Core and sync**, done on 2026-10-28 (see [Slide decks](media-and-files.md#slide-decks)): item type
     `slides`, `content` is `{ fileName, pages: [{ full, thumb }] }`, `addSlides` (1–100 pages, `media-missing`
     for an unknown hash), the pages as pictures live, the clean-up, the files a device keeps, the uploads
     before a push, and a public output serving a shown page. The running order shows the old app's
     RectangleStack icon, and the editor's slides come from `slidesOf` as an image item's do; the
     e2e test of (c) sees the item and its three page tiles, but not the icon.
   - (c) **The PowerPoint tab**, done on 2026-10-28 (see [Slide decks](media-and-files.md#slide-decks)): PDF
     only, through pdf.js loaded at import, the old app's markup and texts saying to save as PDF first, 50 MB
     and 100 pages, ADR 0007 (10) and PRES-R11 rewritten, an e2e test (`slides.spec.ts`). Not tried in
     Safari or on an iPad: the JPEG fallback there is untested.
   - (d) **Templates**, done on 2026-10-29 (see [Assumptions](assumptions.md), "Templates"): the admin list,
     `/templates/{id}` under a sky banner, the picker on create, "Spara som mall", and their own trash. Slide
     decks and arrangements go along on "Spara som mall" (D10, PRES-R31 changed); only admins edit templates
     (D24). Tested in `apps/server/test/sync.test.ts`, `media.test.ts` and `e2e/templates.spec.ts`.
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
