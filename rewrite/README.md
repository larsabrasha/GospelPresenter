# Gospel Presenter, rewrite

The TypeScript, local-first rewrite decided in `adr/0007-rewrite-on-typescript-local-first.md`,
built from the behaviour spec in `spec/`. It runs beside the current .NET app until it has proved
itself.

Milestone 1 was one song, one presentation, output on a second screen, and sync between two clients,
in Electron with no internet. Milestone 2 makes songs and presentations behave as spec 02 and 03 say:
arrangements, ranked search, the trash, item arrangements, renaming and moving items, and the event
date after create. The output window reads through the operator window's database, so it also works
where OPFS is missing. Milestone 3 brings real sign-in, membership and pairing (spec 01, ADR 0007
decisions 6 and 12), so the desktop host can serve other devices on the LAN. Sign-in is with Google or
a passkey: there are no passwords. Milestone 4 adds Bibles and themes (spec 05), so a Sunday service
with Bible readings and a chosen look runs offline. Milestone 5 adds the media library and pictures
(spec 05 Media, ADR 0007 decision 9, D31): import, trash, and a picture as a slide.

| Package | What it is |
|---|---|
| `packages/core` | Schema and its migrations, mutators with Zod-validated arguments, permissions, slides, song search, live pointer |
| `packages/sync` | The sync engine: client (rebase, pokes) and server (push, pull, change log) |
| `apps/server` | Hono server on Node (one SQLite file per organisation) and on Workers (a Durable Object per organisation) |
| `apps/web` | React + Vite client: wa-sqlite on OPFS in a worker |
| `apps/desktop` | Electron: the embedded server, the main window and the output window |

```sh
pnpm install
pnpm build
pnpm lint && pnpm typecheck && pnpm test   # unit and sync tests, on Node, node:sqlite and local workerd, and the host's own
                                           # (lint also refuses a REPLACE in a mutator: see docs/assumptions.md)
pnpm e2e                                   # milestones 1–6 in Electron, windows hidden, half the cores as workers
                                           # (GP_E2E_WORKERS=n); some specs: pnpm e2e -- drag watch; without turbo,
                                           # playwright test drag builds first (apps/desktop/e2e/global-setup.ts)
pnpm check:quick [-- e2e/drag.spec.ts]     # while working: typecheck, lint, unit tests with the server on Node only
                                           # (SYNC_ADAPTERS=node), then the given e2e specs; agents: see AGENTS.md

export GP_GOOGLE_CLIENT_ID=… GP_GOOGLE_CLIENT_SECRET=…   # the host's Google client (see docs/sign-in-and-pairing.md)
pnpm --filter @gp/desktop start            # the desktop app: the host, on 127.0.0.1:47800
GP_LAN=1 pnpm --filter @gp/desktop start   # the host, reachable on the LAN
GP_SERVER=http://127.0.0.1:47800 GP_DATA_DIR=/tmp/gp-second pnpm --filter @gp/desktop start
                                           # a second client of the first; pairing signs it in
pnpm --filter @gp/desktop serve            # the server alone on :8787, then `pnpm --filter @gp/web dev`
GP_PASSKEY_RP_ID=localhost GP_PASSKEY_ORIGINS=http://localhost:8787 pnpm --filter @gp/desktop serve
                                           # the same with passkeys; open http://localhost:8787 (not 127.0.0.1)
```

Needs Node 22 or later and pnpm 12. The e2e runs the real app, with its windows hidden: they are made but never
shown, there is no Dock icon, and the output never takes a second display, so a run takes no focus from whoever
is at the computer (`GP_E2E_VISIBLE=1 pnpm e2e` shows them). It plays the system browser and
Google itself (`apps/server/test/fake-google.ts`), so it needs no internet and no Google client. Its
passkey tests play the system browser with Playwright's Chromium and its virtual authenticator, so
that browser must be installed once (`pnpm --filter @gp/desktop exec playwright install chromium`). `?storage=memory` in the page URL
(`GP_STORAGE=memory` for the desktop app) keeps the database in memory, as where OPFS is missing.

## Docs

The rest is in `docs/`, one file per topic; read the one your task touches.

| File | What it holds |
|---|---|
| [sign-in-and-pairing.md](docs/sign-in-and-pairing.md) | Google and passkey sign-in, setup, invites, logins, sessions, pairing a device with the host, their configuration, the fake Google, and the schema versions of the global and organisation databases |
| [bibles-and-themes.md](docs/bibles-and-themes.md) | How a translation's text is stored, uploaded and kept per device, importing and checking a real translation; the built-in themes and their fonts |
| [media-and-files.md](docs/media-and-files.md) | Pictures and audio: what syncs, where the bytes live, the endpoints, the client pipeline, clean-up, audio during live, and which files a device keeps |
| [live.md](docs/live.md) | Overlays, paired screens (`/display`) and the QR codes, remote control, and public outputs (`/watch`) |
| [lan-https-and-addresses.md](docs/lan-https-and-addresses.md) | A tablet over plain http, https on the LAN, the service worker that starts the app without the host, a reverse proxy, and the app's addresses |
| [cloudflare.md](docs/cloudflare.md) | The Worker serving the web app, and the trial on a real Cloudflare account with its measurements |
| [look.md](docs/look.md) | How the web app follows the current Blazor app's look, page by page, the autosave, the output window switch, dragging, and the screenshot scripts |
| [next-steps.md](docs/next-steps.md) | Where to pick up, in order |
| [not-done-yet.md](docs/not-done-yet.md) | The smaller gaps, per area |
| [assumptions.md](docs/assumptions.md) | Where the spec and ADR 0007 leave a choice open, the choice made, per milestone |

## Next steps

Where to pick up, in order: PDF and PowerPoint import and templates; finishing the trial deploy to Cloudflare
(Google sign-in against a real client, then deleting the trial); getting there (the import from the current app,
packaging and updates, the Capacitor app). The details are in [docs/next-steps.md](docs/next-steps.md).
