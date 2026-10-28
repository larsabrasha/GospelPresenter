# On Cloudflare

**The Worker serves the web app** from Workers static assets: `[assets]` in `wrangler.toml` points at
`apps/web/dist`, so `pnpm build` comes before `wrangler deploy`. With `run_worker_first` every request reaches
the Worker, which leaves `/api/…` alone and otherwise asks the `ASSETS` binding: a path with no file extension
gets `index.html`, as on Node. It adds the same headers as the Node server (`apps/server/src/static.ts`): the CSP
on every file, and `no-cache` on everything outside `/assets/`, so `index.html` and `/sw.js` are asked again
every time. `html_handling = "none"`, because the default redirects `/index.html` to `/`, and the service worker
keeps `/index.html` under that name: a kept redirect would break a navigation offline.
`apps/server/test/static.test.ts` checks this on Node and in local workerd (Miniflare's assets).

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
