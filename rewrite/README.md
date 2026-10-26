# Gospel Presenter, rewrite

The TypeScript, local-first rewrite decided in `adr/0007-rewrite-on-typescript-local-first.md`,
built from the behaviour spec in `spec/`. It runs beside the current .NET app until it has proved
itself.

This is milestone 1: one song, one presentation, output on a second screen, and sync between two
clients, in Electron with no internet.

| Package | What it is |
|---|---|
| `packages/core` | Schema, mutators with Zod-validated arguments, permissions, slides, live pointer |
| `packages/sync` | The sync engine: client (rebase, pokes) and server (push, pull, change log) |
| `apps/server` | Hono server on Node (one SQLite file per organisation) and on Workers (a Durable Object per organisation) |
| `apps/web` | React + Vite client: wa-sqlite on OPFS in a worker |
| `apps/desktop` | Electron: the embedded server, the main window and the output window |

```sh
pnpm install
pnpm build
pnpm lint && pnpm typecheck && pnpm test   # unit and sync tests, on Node, node:sqlite and local workerd
pnpm e2e                                   # milestone 1 in Electron: two desktop apps on this machine

pnpm --filter @gp/desktop start            # the desktop app
GP_SERVER=http://127.0.0.1:<port> GP_DATA_DIR=/tmp/gp-second pnpm --filter @gp/desktop start
                                           # a second client of the first
pnpm --filter @gp/desktop serve            # the server alone on :8787, then `pnpm --filter @gp/web dev`
```

Needs Node 22 or later and pnpm 12. The e2e opens real windows.

## Not in milestone 1

Sign-in (the user comes from the URL, and the server only checks the membership), pairing and the
LAN, arrangements, song history, Bible, images, themes, templates, the trash UI, English text,
mobile, and deploying to Cloudflare. The Workers adapter is tested in local workerd only.
