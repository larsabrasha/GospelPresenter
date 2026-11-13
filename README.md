# Gospel Presenter

Delightfully simple presentation software for churches. Free and open-source.

Gospel Presenter shows song lyrics, Bible verses, pictures, videos and slides on a second screen during services.
It works offline, in a desktop app that can also serve the church's other devices on its own network, in a browser,
and in a phone app.

## Where things are

| Folder | What it holds |
|---|---|
| [`apps/`](apps/), [`packages/`](packages/) | The app: TypeScript, local-first (pnpm + turbo); how to build and run it is below, and agents start with [`AGENTS.md`](AGENTS.md) |
| [`docs/`](docs/) | How the app works, one file per topic (the table under [Docs](#docs)) |
| [`spec/`](spec/) | What the app does, area by area: the behaviour spec the app is built from |
| [`adr/`](adr/) | The decisions; [`adr/0007-rewrite-on-typescript-local-first.md`](adr/0007-rewrite-on-typescript-local-first.md) is the rewrite's |
| [`website/`](website/) | The website, gospelpresenter.com (`.github/workflows/static.yml`) |
| [`research/`](research/), [`spike/`](spike/) | What was tried before the rewrite was decided |
| [`Assets/`](Assets/), [`scripts/`](scripts/) | The app icon's designs; the app's own scripts, and those the ADRs and the spec name |

## The C# app (1.x)

The app before this one, in C# (Blazor and MAUI) with PostgreSQL and Garage, is kept at the tag
[`v1-final`](../../tree/v1-final): build or patch it from there (`git worktree add ../gp-1x v1-final`). How to
deploy it is in its README at that tag. A church moves its data to this app with the export from 1.x
([`docs/import-from-1x.md`](docs/import-from-1x.md)).

## Developing

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
| `packages/core` | Schema, mutators with Zod-validated arguments, permissions, slides, song search, live pointer |
| `packages/sync` | The sync engine: client (rebase, pokes) and server (push, pull, change log) |
| `packages/architecture` | Tests of the code itself, read as text: file length, names, copies, which package may import which |
| `apps/server` | Hono server on Node (one SQLite file per organisation) and on Workers (a Durable Object per organisation) |
| `apps/web` | React + Vite client: wa-sqlite on OPFS in a worker |
| `apps/desktop` | Electron: the embedded server, the main window and the output window |
| `apps/mobile` | Capacitor: the web app in an iOS shell, with its sign-in sheet (docs/phone-app.md) |
| `apps/legacy` | The export from the current app: one organisation from its PostgreSQL and Garage to a zip the new app imports (docs/import-from-1x.md) |

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
export GP_RESEND_API_KEY=… GP_MAIL_FROM='Gospel Presenter <noreply@…>' GP_APP_URL=http://localhost:8787
                                           # e-mail through Resend (see docs/sign-in-and-pairing.md, "E-mail")
```

Needs Node 22 or later and pnpm 12. The e2e runs the real app, with its windows hidden: they are made but never
shown, there is no Dock icon, and the output never takes a second display, so a run takes no focus from whoever
is at the computer (`GP_E2E_VISIBLE=1 pnpm e2e` shows them). It plays the system browser and
Google itself (`apps/server/test/fake-google.ts`), so it needs no internet and no Google client. Its
passkey tests play the system browser with Playwright's Chromium and its virtual authenticator, so
that browser must be installed once (`pnpm --filter @gp/desktop exec playwright install chromium`). `?storage=memory` in the page URL
(`GP_STORAGE=memory` for the desktop app) keeps the database in memory, as where OPFS is missing.

### Docs

The rest is in `docs/`, one file per topic; read the one your task touches.

| File | What it holds |
|---|---|
| [sign-in-and-pairing.md](docs/sign-in-and-pairing.md) | Google and passkey sign-in, setup, invites, logins, sessions, pairing a device with the host, their configuration, the fake Google, and the schema versions of the global and organisation databases |
| [accounts-and-roles.md](docs/accounts-and-roles.md) | The account as the person's: invitations as pending memberships, a confirmed and unique address that tells no one whose it is, the Users and Admins of an organisation (at least one Admin), the Superadmin as a mark on the account and its superadminläge, when a fresh sign-in is asked, and the desktop host's people; the four takeovers it closed, and what is not built |
| [bibles-and-themes.md](docs/bibles-and-themes.md) | How a translation's text is stored, uploaded and kept per device, importing and checking a real translation; the themes' fonts |
| [media-and-files.md](docs/media-and-files.md) | Pictures, audio and video: what syncs, where the bytes live, the endpoints, the client pipeline, video's upload in parts and streaming, clean-up, audio during live, and which files a device keeps |
| [custom-slides.md](docs/custom-slides.md) | Custom slides and overlays: a page of texts, pictures and shapes, where it is stored, how the outputs draw it, the editor, and the steps |
| [themes.md](docs/themes.md) | The two built-in themes and the organisation's own: what a theme sets, where it is stored, how the outputs get it, text made smaller to fit, the editor |
| [live.md](docs/live.md) | Overlays, paired screens (`/display`) and the QR codes, remote control, and public outputs (`/watch`) |
| [lan-https-and-addresses.md](docs/lan-https-and-addresses.md) | A tablet over plain http, https on the LAN, the service worker that starts the app without the host, a reverse proxy, and the app's addresses |
| [desktop-app.md](docs/desktop-app.md) | The desktop app's packages: making them, what they hold, signing, what was tried and what is left |
| [phone-app.md](docs/phone-app.md) | The Capacitor app for iOS and Android: which server it talks to and how a church changes it, CORS for its origins, its sign-in, and updates from the server outside the App Store |
| [import-from-1x.md](docs/import-from-1x.md) | The one-way import from the current app: the export zip, the import in Inställningar, and what maps to what |
| [cloudflare.md](docs/cloudflare.md) | The Worker serving the web app, and the trial on a real Cloudflare account with its measurements |
| [performance.md](docs/performance.md) | How fast the most used flows are, measured before and after, and what made them so |
| [scenarios.md](docs/scenarios.md) | What a church does with the app, most common first, and the e2e tests that run each scenario, whole Sundays included |
| [layout-2-0.md](docs/layout-2-0.md) | Version 2.0's layout, decided from a mockup: live on a phone and in columns, the start page and its bar, and Inställningar; where it leaves the current look |
| [look.md](docs/look.md) | How the web app follows the current Blazor app's look, page by page, the autosave, the output window switch, dragging, and the screenshot scripts |
| [next-steps.md](docs/next-steps.md) | Where to pick up, in order |
| [not-done-yet.md](docs/not-done-yet.md) | The smaller gaps, per area |
| [bug-reports.md](docs/bug-reports.md) | "Rapportera fel": what a report carries and never carries, the steps before it, Felrapporter for the SuperAdmin, and the thread with the one who reported |
| [assumptions.md](docs/assumptions.md) | Where the spec and ADR 0007 leave a choice open, the choice made, per milestone |

### Next steps

Where to pick up, in order: finishing the trial deploy to Cloudflare
(Google sign-in against a real client, then deleting the trial); getting there (the import from the current app,
packaging and updates, the Capacitor app). The details are in [docs/next-steps.md](docs/next-steps.md).

## License

[AGPL-3.0](LICENSE).
