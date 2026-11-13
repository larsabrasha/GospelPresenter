# On Cloudflare

**Cloudflare serves the web app, the Worker only the API** (Lars, 2026-11-02: the app cheap, the data guarded).
`[assets]` in `wrangler.toml` points at `apps/web/dist`, so `pnpm build` comes before `wrangler deploy`, and
`run_worker_first = ["/api/*"]` starts the Worker for the API alone. Every other request is Cloudflare's own asset
serving, which costs no Worker request: a path with no file gets `index.html` (`not_found_handling =
"single-page-application"`), and `apps/web/public/_headers` gives every file the Node server's headers
(`apps/server/src/static.ts`: the CSP, `no-cache` on everything outside `/assets/`), with the hashed files under
`/assets/` kept for a year. `apps/server/test/static-headers.test.ts` checks the two agree. `html_handling = "none"`,
because the default redirects `/index.html` to `/`: the service worker keeps `/index.html` under that name, and a
kept redirect would break a navigation offline. The data is not among the files: D1 (users, sessions), each
organisation's Durable Object (songs, presentations, the sync log) and R2 (media) are reached only through the Worker,
which asks for a session; the bucket has no public address. The Worker still has its own fallback for the files, for a
config that sends it everything; `apps/server/test/static.test.ts` checks it on Node and in local workerd.

**The test environment (2026-11-02).** `https://gp-test.lars-arvidsson.workers.dev`: Worker `gp-test`, D1
`gp-test-global` (WEUR) and R2 `gp-test-media`, named in `apps/server/wrangler.test.toml`. It runs the repo's
Worker as it is, with no debug routes, and signs in by passkey only (Lars, 2026-11-02): no Google client and no
mail, so `/api/auth/state` says `google: false, mail: false`. The setup token is the Worker's secret
`SETUP_TOKEN`, set at the first deploy; a deploy keeps it. `.github/workflows/deploy-test.yml` builds the web
app and deploys on a push to main that touches the app, or for any branch by hand (workflow_dispatch). It
needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. By hand, from `apps/server`
after `pnpm build`: `wrangler deploy --config wrangler.test.toml`. Its D1 and its objects migrate on their first
request after a deploy, as the trial's did.

**apptest.gospelpresenter.com (2026-11-08).** The test environment at the church's own domain, before the
current app's `app.gospelpresenter.com` moves (Lars, 2026-11-08): Worker `gp-apptest`, D1 `gp-apptest-global`
(WEUR) and R2 `gp-apptest-media`, named in `apps/server/wrangler.apptest.toml`, apart from gp-test, whose passkeys
belong to its `workers.dev` address. The address is a Workers custom domain (`routes`, `custom_domain = true`);
until 2026-11-08 it was the current app's test instance, through a Cloudflare Tunnel to a machine at Lars's home.
Passkeys only so far, as gp-test; the setup token is the Worker's secret `SETUP_TOKEN`. By hand, from
`apps/server` after `pnpm build`: `wrangler deploy --config wrangler.apptest.toml`; no workflow deploys it yet.

**app.gospelpresenter.com (prepared 2026-11-11, not deployed).** Production: Worker `gp-app`, D1 `gp-app-global`
(WEUR) and R2 `gp-app-media` (both made 2026-11-11, empty), named in `apps/server/wrangler.app.toml`, set up as apptest is. `pnpm deploy:app` deploys
it; no workflow does. Today the address is the C# app's (1.x), through a Cloudflare Tunnel, and a Workers custom domain
is not made where a DNS record is already there: the deploy fails until that record is removed, so no deploy takes the
address by mistake. Before the first deploy: `wrangler secret put SETUP_TOKEN --config wrangler.app.toml`.
Google and mail, if production has them: the secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `RESEND_API_KEY`,
and `MAIL_FROM` and `APP_URL` (docs/sign-in-and-pairing.md), with
`https://app.gospelpresenter.com/api/auth/google/callback` among the Google client's redirect URIs. The cutover: the
churches export from 1.x (docs/import-from-1x.md), the tunnel's DNS record for `app` goes, `pnpm deploy:app` makes the
custom domain, and each church imports its zip. Passkeys made on apptest do not work here: their RP ID is apptest's.

**A trial on a real account (2026-10-28).** With Lars's go-ahead the Worker ran on
`https://gp-trial-gospel.lars-arvidsson.workers.dev`, with D1 `gp-trial-global` (region WEUR) and R2
`gp-trial-media`. It is kept for Lars to try, and deleted afterwards. The repo's `wrangler.toml` was not used:
the trial's own config named the real IDs and put every debug route behind a token. That config (as a
template), the token gate, the trial's tests and the setup and teardown scripts are in `scripts/cf-trial/` (its
README says how to run them). Measured from a Mac in Sweden
(Cloudflare's ARN), with the server suites' remote adapter (`SYNC_ADAPTERS=remote SYNC_REMOTE_URL=<url>`) and a few
trial-only tests:

- **Migrating an existing Durable Object and D1.** The Worker of commit `a383615` (organisation schema 2,
  global schema 2 with `users.password_hash`) was deployed, wrote a song, a part, a label, a presentation and
  an item, and a password hash was set in D1. Then the current Worker was deployed over it. Its first request
  (431 ms) brought D1 from 2 to 6 in one batch, `ALTER TABLE users DROP COLUMN password_hash` included: the
  column is gone, and the users, sessions and memberships stayed. The organisation's object went from schema 2
  to 10 on its first request: every row kept, the new columns null. A current client pulled the old rows, and its
  edits to an old table (`songs`) and a new one (`displays`) were logged by the triggers.
- **Ed25519 passkeys.** Setup with an Ed25519 passkey, then sign-in, both verified by WebCrypto in the Worker;
  invites accepted with ES256 (packed attestation), Ed25519 and RS256 passkeys; a spoiled signature, a counter
  that goes back, a wrong origin and a wrong RP ID refused. A ceremony's finish takes 270–320 ms.
- **R2 as the media storage.** `media.test.ts` passes on R2 (with `MEDIA_GRACE_MS=0` for that run, so the blobs
  of a purge go at once), except its two checks of `mediaKeys()`, which the remote harness cannot read; the
  bucket held the keys. A 10 MiB picture and a 20 MiB sound went up in 1.5–1.6 s and came back byte for byte in
  1.1 s; one byte more is a 413.
- **Live sockets in a hibernating Durable Object.** Two live sockets (an owner and a phone) and a poke socket,
  then 20 s and 70 s with nothing sent: the object was constructed again (it had hibernated), no socket closed,
  a command from the phone reached the owner in 41–46 ms (8–11 ms before the pause), the session was still
  there, and a push poked the poke socket in about 590 ms. With an open public output stream an object does
  not hibernate (see [Not done yet](not-done-yet.md)).
- **The suites.** `sync.test.ts` 32 passed (twice), and `live`, `screens`, `bibles` and `watch` passed. `watch`
  needs a clean D1 between runs: its output codes are fixed and unique across organisations, and its lockout
  test locks the address that runs it for 15 minutes.

| Measure (hosted, 2026-10-28) | |
|---|---|
| Sync push of 1 mutation, p50 / p90 (20 in a row) | 77–82 / 86–90 ms |
| Sync pull, p50 / p90 | 52–53 / 61–66 ms |
| A client's sync (push, pull, rebase), p50 / p90 | 127–131 / 137–152 ms |
| First request to a new organisation's object (created, schema made) | 487–575 ms |
| First request after a deploy (new isolate) | 431 ms with D1 migrated 2 → 6; 228 ms without |
| `/api/auth/state` after that (D1 only) | 66–230 ms |
| Poke latency, push → row in the other client | 598–788 ms |
| Push of 1,200 mutations in one request | 849–1,014 ms |
| First pull of 1,200 rows (3 pages) | 229–232 ms |
| Full-size Bible: upload; first pull + download and store | 1,343 ms; 54 + 383 ms |

The sync spike measured 588–677 ms, 824–955 ms and 194–248 ms for the last three on 2026-10-26. Wrangler
reported a startup time of 20–43 ms for the bundle.

**Not proven.** Google sign-in: it needs a real Google client, which only Lars can make. The grace period of
unused blobs on R2 (`media.test.ts` ran with none). Behaviour under load, and where the objects were placed.
The web app in a browser on Cloudflare was tried by hand only: Lars opened the trial, set it up with a passkey
and the setup token, signed in and found it working; no browser test runs against it.

**Deploys and restores (the review, 2026-11-09).** `pnpm deploy:test`, `pnpm deploy:apptest` and
`pnpm deploy:app` (`scripts/deploy.mjs`) refuse a working tree whose app files have changes, build with `GP_COMMIT` (the page's version is the commit) and
name the Worker version by the commit (`--tag`), so `wrangler rollback` finds the one before; the workflow does the
same and runs typecheck, lint and the tests first. A rollback works only for a deploy that changed no schema: the server
refuses a database newer than its code, so after a migration the way back is a fix forward. And a client whose schema
is not the server's stops syncing until it reloads (426), which the quiet swap does only away from live: so no deploy
from Saturday evening to Sunday afternoon, and a commit that bumps a schema says so. Restores: D1 has Time Travel
(`wrangler d1 time-travel restore <db> --timestamp …`, 30 days); a Durable Object's SQLite can be brought back to a
point in time with `ctx.storage.getBookmarkForTime` and `onNextSessionRestoreBookmark`, which no route calls yet; R2 has
no versions, so a purged file is gone, and so is an organisation deleted (`/internal/drop`). Until a scheduled export
exists, Exportera under Organisationen is a church's copy of its data.

**Logs (2026-11-04).** The Worker writes its events as JSON lines (`console.warn`; on Node, stderr): a refused
sign-in (`passkey-refused`), an error a client caught nothing for (`client-error`), and since 2026-11-09 one the server
caught nothing for (`server-error`, its method and path; `apps/server/src/server-error.ts`). `[observability] enabled`
in both wrangler configs keeps them in Workers Logs, searchable in the dashboard under the Worker's Observability,
or followed live with `wrangler tail --config wrangler.test.toml`. A client error is sent by the app itself
(`apps/web/src/clientErrors.ts`) when the yellow "Ett oväntat fel har inträffat." bar shows or a page crashes:
`POST /api/client-errors` with the message, the stack, the page's path (never its query or fragment) and the build's
commit, cut to `CLIENT_ERROR_LIMITS`; the server adds the organisation, the user, whether the device is paired and the
browser, and stores nothing. Only a signed-in device sends (the route asks for a session), each message once and at
most five in a page's life. Tested in `apps/server/test/client-errors.test.ts` and `apps/web/test/clientErrors.test.ts`.
