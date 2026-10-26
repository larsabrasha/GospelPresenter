# Sync engine spike

The two-day spike from `research/sync-engine-evaluation.md` ("Next step: a two-day spike"): a
Replicache-style push/pull mutation log on Drizzle and SQLite, run on Node, on a Cloudflare Durable
Object (locally, in workerd), and embedded in Electron. **Results: [RESULTS.md](RESULTS.md).**

This is throwaway spike code. Its core (`packages/core` sync SQL, `apps/server/src/sync-server.ts`,
`packages/client/src/client.ts`) is meant to seed `packages/sync`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Drizzle schema, mutators (one async signature for client and server), `can()` policy, wire protocol types, trigger SQL generated from the schema |
| `apps/server/src/sync-server.ts` | Push, pull, cookie, "update required", poke coalescing, over an `OrgStore` interface |
| `apps/server/src/app.ts` | Hono routes shared by both runtimes |
| `apps/server/src/node.ts` | Node adapter: one SQLite file per organisation plus `global.sqlite`; better-sqlite3 or node:sqlite; `ws` pokes |
| `apps/server/src/worker.ts` | Workers adapter: a SQLite Durable Object per organisation, D1 for memberships, hibernatable WebSockets |
| `packages/client` | Local SQLite behind an async interface (wa-sqlite, better-sqlite3, node:sqlite), pending queue, undo log, rebase, poke listener |
| `apps/desktop` | Electron main process embedding the Node server, plus a LAN check that plays a tablet |
| `test/sync.test.ts` | The shared test file, run against every server adapter |

## Commands

Requires Node 22 and pnpm 10. Nothing talks to Cloudflare; no account is needed.

```sh
pnpm install
pnpm test                       # all adapters: node, node-sqlite, workers
pnpm test:node                  # one adapter: also test:node-sqlite, test:workers
pnpm typecheck

pnpm --filter @spike/server dev:worker      # wrangler dev, local only

cd apps/desktop
pnpm lan-check:node             # embedded server under plain Node, tablet over the LAN address
pnpm lan-check:electron         # the same inside Electron 45, needs xvfb-run on a headless Linux
DESKTOP_DRIVER=node:sqlite pnpm lan-check:electron
```

If Electron's postinstall download fails behind a proxy, fetch
`electron-v45.0.0-linux-x64.zip` from the Electron GitHub release yourself, unzip it into
`node_modules/electron/dist`, and write `electron` into `node_modules/electron/path.txt`.

The repository root `.gitignore` ignores `**/packages/*` (a NuGet rule); `spike/sync/.gitignore`
re-includes them.
