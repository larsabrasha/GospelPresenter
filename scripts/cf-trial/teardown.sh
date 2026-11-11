#!/usr/bin/env bash
# Deletes the Cloudflare trial and nothing else: exactly these three resources by name, after a confirmation.
#   Worker     gp-trial-gospel   (with its Durable Objects, its secrets and its workers.dev route)
#   D1         gp-trial-global
#   R2 bucket  gp-trial-media    (emptied first: a bucket with objects cannot be deleted)
# Needs: `wrangler login` and CLOUDFLARE_ACCOUNT_ID. Leaves .local/ (config and tokens) on disk.
set -euo pipefail

WORKER=gp-trial-gospel
D1=gp-trial-global
BUCKET=gp-trial-media
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID (wrangler whoami shows it)}"
ACCOUNT=$CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID

here=$(cd "$(dirname "$0")" && pwd)
WRANGLER="$(cd "$here/../.." && pwd)/apps/server/node_modules/.bin/wrangler"
cd "$here"   # no wrangler.toml here: nothing but the names above is used

echo "This deletes, on account $ACCOUNT: Worker $WORKER, D1 $D1 and R2 bucket $BUCKET with all its objects."
read -r -p "Type $WORKER to go on: " answer
[ "$answer" = "$WORKER" ] || { echo "Stopped; nothing deleted."; exit 1; }

echo "Deleting Worker $WORKER"
"$WRANGLER" delete "$WORKER"   # asks before it deletes

echo "Deleting D1 $D1"
"$WRANGLER" d1 list --json | python3 -c "
import json, sys
dbs = [d for d in json.load(sys.stdin) if d['name'] == '$D1']
assert len(dbs) == 1, f'expected one D1 named $D1: {dbs}'
print('  id', dbs[0]['uuid'])
"
"$WRANGLER" d1 delete "$D1" --skip-confirmation

echo "Emptying and deleting R2 bucket $BUCKET"
"$WRANGLER" r2 bucket info "$BUCKET" >/dev/null   # refreshes the login, and stops here if the bucket is gone
# The OAuth token wrangler is logged in with, for the R2 object listing (wrangler cannot list objects).
config="$HOME/Library/Preferences/.wrangler/config/default.toml"
[ -f "$config" ] || config="${XDG_CONFIG_HOME:-$HOME/.config}/.wrangler/config/default.toml"
TOKEN=$(sed -n 's/^oauth_token *= *"\(.*\)"/\1/p' "$config")
api() { curl -sf -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT$1"; }

while :; do
  keys=$(api "/r2/buckets/$BUCKET/objects?per_page=1000" | python3 -c 'import json,sys; [print(o["key"]) for o in json.load(sys.stdin)["result"]]')
  [ -z "$keys" ] && break
  while IFS= read -r key; do
    "$WRANGLER" r2 object delete "$BUCKET/$key" --remote >/dev/null
  done <<<"$keys"
done
"$WRANGLER" r2 bucket delete "$BUCKET"

echo "Done. Left on disk: $here/.local (config and tokens)."
