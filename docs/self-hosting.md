# Running it on your own machine

Gospel Presenter on a church's own computer or server, with Docker Compose (Lars, 2026-11-25), as 1.x had it: the
same app as `app.gospelpresenter.com`, its data in one folder on that machine. Two containers: the app (the server
with the web app beside it, `apps/server/Dockerfile`) and [Caddy](https://caddyserver.com) in front of it, which
gets the https certificate by itself. https is not optional: passkeys, the service worker that keeps presentations
offline, and the phone's camera for QR codes all need it.

## What you need

- A machine that runs Docker (Linux, a Mac, Windows with WSL; amd64 or arm64, so a Raspberry Pi 4 or 5 too).
- An address for it, such as `presenter.example.org`, whose DNS points at the machine, with ports 80 and 443 reachable
  from the internet: Caddy proves to Let's Encrypt that the address is yours that way.

## Getting started

```sh
mkdir gospel-presenter && cd gospel-presenter
curl -fsSLO https://raw.githubusercontent.com/larsabrasha/GospelPresenter/main/docker/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/larsabrasha/GospelPresenter/main/docker/.env.example
# set GP_DOMAIN in .env, and Google or e-mail if you want them (below)
docker compose up -d
docker compose logs app        # "Setup token: gpst_…"
```

Open `https://<GP_DOMAIN>`. "Välkommen!" asks for your name, the church's name and the setup token, then for a
passkey or Google: that account is the first Admin, and the Superadmin. Setting `GP_SETUP_TOKEN` in `.env` chooses
the token; left empty, the app makes one at each start and prints it until setup is done. Everyone else comes in by
invitation, from Användare (docs/accounts-and-roles.md).

## The settings (`.env`)

| Setting | |
|---|---|
| `GP_DOMAIN` | The address. Passkeys, Google's redirect and the links in e-mails are made from it (`docker/docker-compose.yml`). Changing it later loses the passkeys made on the old one. |
| `GP_SETUP_TOKEN` | What setup asks for. Empty: made and printed at start. |
| `GP_GOOGLE_CLIENT_ID`, `GP_GOOGLE_CLIENT_SECRET` | Sign-in with Google: an OAuth client (Web application) in Google Cloud, with the redirect URI `https://<GP_DOMAIN>/api/auth/google/callback`. Without them, passkeys only. |
| `GP_RESEND_API_KEY`, `GP_MAIL_FROM` | E-mail through [Resend](https://resend.com), from a domain verified there: invitations by mail and "Glömt hur du loggar in?". Without them, an Admin copies each invitation's link. |
| `GP_SUPER_ADMINS` | The Superadmins' addresses, comma-separated. Without them the one who did setup is. |

The same names configure the desktop app's plain-Node server (`apps/server/src/node-env.ts`).

## Updating

```sh
docker compose pull && docker compose up -d
```

The image `ghcr.io/larsabrasha/gospelpresenter-server:latest` is built from main by
`.github/workflows/docker-publish.yml`; each build is also kept as `:sha-<commit>`, which pins a version. The databases
migrate on their first request after an update. A version that changed a schema cannot be rolled back: the server
refuses a database newer than itself (docs/cloudflare.md, "Deploys and restores"). So update on a weekday, never
between Saturday evening and Sunday's service.

## Backups

All a church has is in the volume `data`: a SQLite file per organisation, a global one, and the files (pictures,
sounds, videos) under `media/`. The app backs it up itself each night, while it runs (Lars, 2026-11-25), into
`/data/backups/{YYYY-MM-DD}/` (`apps/server/src/backup-node.ts`): every database copied with SQLite's `VACUUM INTO`,
which reads one consistent state beside the server's own connection, and the files as hard links. A file is named by
its hash and never written again, so a link costs no space, and it stays when the app later removes the original. A
night costs about the databases' size, a few MB.

The nights are thinned as Time Machine thins its own (`apps/server/src/backup-retention.ts`): every night for two
weeks, then the newest of each week for eight weeks, then the newest of each month for a year; at most about 34. The
app looks each hour, so the first look of a day (UTC) makes it. `GP_BACKUPS=off` turns it off, and `GP_BACKUP_DIR`
puts the nights elsewhere, such as a second disk mounted into the container (a copy there, not a link, takes the
files' space). A backup now, beside the running app:

```sh
docker compose exec app node node-server.mjs backup
```

The backups are in the same volume as what they back up: a disk that fails takes both. Copy `backups/` off the machine
too, now and then, or mount it from another disk. To go back to a night: stop the app, put that night's files in
`/data` in place of the databases and `media/`, start it. Exportera, under Organisationen, is a church's own copy too
(docs/import-from-1x.md, "From 2.0 itself").

## From 1.x, or from app.gospelpresenter.com

An organisation moves with its zip: exported from 1.x beside its database, or with Exportera in 2.0, and imported
under Organisationen (docs/import-from-1x.md).

## Without Caddy, or without Compose

A church with a reverse proxy of its own (nginx, Traefik, a Cloudflare Tunnel) leaves out the `caddy` service,
publishes the app's port (`ports: ["8080:8080"]`) and sets `GP_TRUSTED_PROXIES` to the proxy's address, so the
sign-in throttles see each client's own (docs/lan-https-and-addresses.md, "Behind a reverse proxy"). The proxy must
pass WebSockets on: live and sync use them. Without Compose, `docker run` takes the same settings, the address's
three spelled out as Compose makes them:

```sh
docker run -d --name gospel-presenter --restart unless-stopped \
  -p 8080:8080 -v gospel-presenter-data:/data \
  -e GP_PASSKEY_RP_ID=presenter.example.org -e GP_PASSKEY_ORIGINS=https://presenter.example.org \
  -e GP_GOOGLE_REDIRECT_BASE_URL=https://presenter.example.org -e GP_APP_URL=https://presenter.example.org \
  -e GP_TRUSTED_PROXIES=<the proxy's address> \
  ghcr.io/larsabrasha/gospelpresenter-server:latest
```

To try it on one computer, `localhost` is a secure context without https: `GP_PASSKEY_RP_ID=localhost` and
`GP_PASSKEY_ORIGINS=http://localhost:8080`, then `http://localhost:8080` (README.md, "Running it on your own
machine").

## How it is built

`apps/server/src/standalone.ts` starts the server (`startNodeServer`) on all the container's addresses, port 8080,
with Node's own SQLite (`node:sqlite`, so nothing is compiled into the image), its data in `/data` and the built web
app in `/app/web`; `apps/server/build-node.mjs` bundles it into one file with every dependency inside. So the image's
last stage is bare Alpine with Node's program and the C++ library it links, and nothing to install: no npm, yarn or
corepack (Lars, 2026-11-25: as small as it goes). It is about 147 MB, 56 MB to download; Node's program is 122 MB of
it, the server and the web app 7 MB. On `node:24-slim` it was 358 MB. The image runs as `node`, and `docker stop`
closes the databases before it goes.

**Tried** (2026-11-25, Docker Desktop on an Apple Silicon Mac): with Compose, `GP_DOMAIN=localhost` and Caddy's own
certificate for localhost, the image builds; `/api/auth/state` over https says setup is needed and passkeys are on;
the page loads; http is redirected to https; the setup token is printed; the data volume belongs to `node` and keeps
`global.sqlite` across a restart; a stop exits cleanly. With `docker run` on `localhost:8080`, the same state and the
token. **Not tried**: setup and sign-in with a passkey in the container, a certificate from Let's Encrypt on a real
address, the amd64 image, and the workflow's first run.
