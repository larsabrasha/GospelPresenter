#!/usr/bin/env bash
# Puts the trial on Cloudflare: D1 gp-trial-global and R2 gp-trial-media (made only if missing, by exact name),
# the filled config in .local/wrangler.trial.toml, the tokens in .local/tokens.env (made once, kept after),
# then `pnpm build` and a deploy of Worker gp-trial-gospel with the tokens as secrets. Run again to redeploy.
# Needs: `wrangler login`, CLOUDFLARE_ACCOUNT_ID, and CF_WORKERS_SUBDOMAIN (the <x> in <x>.workers.dev).
set -euo pipefail

WORKER=gp-trial-gospel
D1=gp-trial-global
BUCKET=gp-trial-media
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID (wrangler whoami shows it)}"
: "${CF_WORKERS_SUBDOMAIN:?set CF_WORKERS_SUBDOMAIN, the <x> in <x>.workers.dev}"
export CLOUDFLARE_ACCOUNT_ID

here=$(cd "$(dirname "$0")" && pwd)
rewrite=$(cd "$here/../.." && pwd)
WRANGLER="$rewrite/apps/server/node_modules/.bin/wrangler"
local_dir="$here/.local"
umask 077
mkdir -p "$local_dir"

d1_id() {
  "$WRANGLER" d1 list --json | python3 -c "
import json, sys
dbs = [d for d in json.load(sys.stdin) if d['name'] == '$D1']
print(dbs[0]['uuid'] if len(dbs) == 1 else '')
"
}

id=$(d1_id)
if [ -z "$id" ]; then
  echo "Creating D1 $D1"
  "$WRANGLER" d1 create "$D1" --location weur
  id=$(d1_id)
fi
[ -n "$id" ] || { echo "D1 $D1 not found after create" >&2; exit 1; }
echo "D1 $D1: $id"

if "$WRANGLER" r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "R2 $BUCKET: there"
else
  echo "Creating R2 bucket $BUCKET"
  "$WRANGLER" r2 bucket create "$BUCKET"
fi

sed -e "s/__D1_ID__/$id/g" -e "s/__SUBDOMAIN__/$CF_WORKERS_SUBDOMAIN/g" \
  "$here/wrangler.trial.template.toml" >"$local_dir/wrangler.trial.toml"

if [ ! -f "$local_dir/tokens.env" ]; then
  {
    echo "SETUP_TOKEN=gpst_$(openssl rand -hex 24)"   # as the Node host makes one (src/node.ts)
    echo "TRIAL_DEBUG_TOKEN=$(openssl rand -hex 32)"
  } >"$local_dir/tokens.env"
  echo "New tokens in $local_dir/tokens.env"
fi

(cd "$rewrite" && pnpm build)
"$WRANGLER" deploy --config "$local_dir/wrangler.trial.toml" --secrets-file "$local_dir/tokens.env"
echo "Deployed: https://$WORKER.$CF_WORKERS_SUBDOMAIN.workers.dev (setup token: SETUP_TOKEN in $local_dir/tokens.env)"
