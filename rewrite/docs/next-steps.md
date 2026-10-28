# Next steps

Where to pick up. Milestones 1–5, and the live work after them (stage view, remote control, public outputs,
audio, files by need, https on the LAN), are on branch `claude/milestone-1`, which also carries the latest ADR
0007 and spec (decisions up to D32); `claude/rewrite-behavior-spec` is behind it. Overlays, the first step agreed
on 2026-10-27, are built (see [Overlays](live.md#overlays)), and so are the second, starting the app on a tablet without the host
(see [Starting the app without the host](lan-https-and-addresses.md#starting-the-app-without-the-host)), and the third, the client's address behind a reverse proxy (see
[Behind a reverse proxy](lan-https-and-addresses.md#behind-a-reverse-proxy)), and the fourth, paired screens and the QR codes (see [Paired screens](live.md#paired-screens)). The rest, in
this order:

1. **PDF and PowerPoint import** (ADR 0007 (10), D29) and templates.
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
