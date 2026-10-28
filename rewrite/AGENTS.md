# Agent guide: the rewrite

The TypeScript, local-first rewrite of Gospel Presenter (pnpm + turbo: `apps/web`, `apps/server`, `apps/desktop`,
`packages/core`, `packages/sync`). Read `README.md` here first (packages, "Look", "Assumptions"). The decision is
`../adr/0007-rewrite-on-typescript-local-first.md`; the behaviour spec is `../spec/` at the repo root (not here).

## Commands (from `rewrite/`)

```sh
pnpm install
pnpm check:quick                       # typecheck + lint + core/web/server unit tests (server on the node adapter only)
pnpm check:quick -- e2e/drag.spec.ts   # the same, then builds and runs the named e2e specs
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e    # the full checks; run them before saying done
pnpm build
pnpm e2e -- drag watch                 # only these e2e specs (by file name), built through turbo
pnpm --filter @gp/desktop exec playwright test drag     # the same without turbo; its global setup builds first
SYNC_ADAPTERS=node pnpm --filter @gp/server test        # server tests on one adapter (default node,node-sqlite,workers)
GP_E2E_WORKERS=1 pnpm e2e              # e2e workers (default: half the CPU cores); GP_E2E_VISIBLE=1 shows windows
pnpm --filter @gp/desktop start        # the desktop host on 127.0.0.1:47800 (Google client: README "Sign-in")
GP_LAN=1 GP_TLS=self-signed pnpm --filter @gp/desktop start   # on the LAN, over https (README "https on the LAN")
GP_CAPTURE=/tmp/new pnpm --filter @gp/desktop exec playwright test capture   # pictures of every page
GP_CAPTURE_ONLY=setup,login pnpm …     # only the named pictures (README "Look", last paragraph)
node scripts/compare-old-app.mjs /tmp/cmp home,songs   # old app and new, same names, into /tmp/cmp/{old,new}
```

e2e runs the BUILT app (`apps/desktop/dist`, `apps/web/dist`), windows hidden, files side by side: each test
starts its own hosts with their own data dir and port (`testPort()` in `e2e/apps.ts`; use it for any new port).
`pnpm e2e` builds through turbo; outside turbo, `e2e/global-setup.ts` runs turbo's build (0.3 s when unchanged).
Unit/server tests and typecheck are cached by turbo: an unchanged package shows "cached", not a rerun.

## UI rules

- `AppButton` (`apps/web/src/ui/AppButton.tsx`) is the only place a `<button>` is made; the lint enforces it.
- Never `cursor-not-allowed`; use `cursor-default`.
- Every screen works light and dark, desktop and phone (390 px wide).
- Take the old app's Tailwind classes; the look follows the old app (README "Look").
- UI strings are Swedish, in `apps/web/src/i18n.ts`.

## Code rules

- No `_` prefix on fields (`verses`, not `_verses`).
- Comments in English, as dense as the code around them.
- Tests follow Microsoft's unit testing best practices: Arrange-Act-Assert, one behaviour per test, names that
  say the behaviour.

## The old app: the reference

The Blazor app on `origin/main` is what the rewrite must match. A reference worktree is at
`../../GospelPresenter-main-ref` (next to this checkout). If missing:
`git worktree add --detach ../GospelPresenter-main-ref origin/main` (from the repo root).
Mock mode, from its `GospelPresenter/GospelPresenter.Web`:
`ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --urls=http://127.0.0.1:5299`.
Pictures of it: `node scripts/capture-old-app.mjs http://127.0.0.1:5299 /tmp/old [name,…]`.
Never build the MAUI iOS/Android targets.

## Workflow

- Ask before changing behaviour; the spec and README say what the app does.
- A spec change is committed together with the code it describes.
- Commit only after the full checks pass, and only when asked.
