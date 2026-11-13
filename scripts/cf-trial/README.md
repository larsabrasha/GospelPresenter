# The Cloudflare trial

The repo's Worker on a real Cloudflare account, as tried on 2026-10-28 (docs/cloudflare.md): Worker
`gp-trial-gospel`, D1 `gp-trial-global`, R2 `gp-trial-media`. Nothing here holds an ID or a secret: `setup.sh`
writes the filled config and the tokens to `.local/` (git-ignored).

- `entry.ts` — the Worker the trial deploys: the repo's `apps/server/src/worker.ts` behind `gate.ts`, plus
  `/api/debug/trial-born?org=<id>` (when that organisation's Durable Object was last constructed).
- `gate.ts` — every path with "debug" in it is a 404 unless the `x-trial-token` header is the secret
  `TRIAL_DEBUG_TOKEN`. The trial has `SPIKE_DEBUG=1`, so the server suites' debug routes work, for the token only.
- `wrangler.trial.template.toml` — the config, with `__D1_ID__` and `__SUBDOMAIN__` for `setup.sh` to fill.
- `setup.sh` — makes D1 and R2 by exact name if missing, fills the config, makes the tokens once
  (`.local/tokens.env`), runs `pnpm build` and deploys with the tokens as secrets. Run it again to redeploy.
- `teardown.sh` — deletes exactly those three names, after you type the Worker's name; empties the bucket first.
- `vitest.remote.config.ts`, `remote-setup.ts`, `tests/` — the server suites and the trial's own tests
  (latency, hibernation, media sizes, passkeys) against the deployed Worker; the debug token is added to debug
  requests.

```sh
wrangler login                                   # apps/server/node_modules/.bin/wrangler
export CLOUDFLARE_ACCOUNT_ID=<id> CF_WORKERS_SUBDOMAIN=<x>   # <x>.workers.dev
bash scripts/cf-trial/setup.sh
cd apps/server && SYNC_ADAPTERS=remote SYNC_REMOTE_URL=https://gp-trial-gospel.<x>.workers.dev \
  pnpm exec vitest run --config ../../scripts/cf-trial/vitest.remote.config.ts sync ../../scripts/cf-trial/tests
bash scripts/cf-trial/teardown.sh
pnpm --filter @gp/server exec tsc --noEmit -p ../../scripts/cf-trial   # typecheck this folder
```

Notes. `passkey-remote.test.ts` sets the trial up, so it passes only on a fresh D1. `watch.test.ts` needs a clean
D1 between runs, and locks the address that runs it out for 15 minutes. `media.test.ts` fails its two
`mediaKeys()` checks remotely, and needs `MEDIA_GRACE_MS=0` in `[vars]` for its purge checks. Not kept from the
first trial: the step that deployed commit `a383615` first to try the migration (its seed and its test).
