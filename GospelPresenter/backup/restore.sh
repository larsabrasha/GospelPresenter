#!/bin/sh
#
# Restores a snapshot produced by backup.sh onto this compose stack.
#
#   ./backup/restore.sh /path/to/snapshots/20260906T020000Z
#
# The media mirror is taken from ../../garage relative to the snapshot unless a second
# argument overrides it. Run from the directory holding docker-compose.yml.
#
# This REPLACES the database, the object storage and the data protection keys. It is also
# the drill worth rehearsing on a throwaway stack every month or so — a backup nobody has
# restored is a guess.

set -eu

SNAPSHOT="${1:?usage: restore.sh <snapshot-dir> [garage-mirror-dir]}"
MIRROR="${2:-$(dirname "$(dirname "$SNAPSHOT")")/garage}"
COMPOSE="docker compose"

for required in "$SNAPSHOT/postgres.dump" "$MIRROR"; do
    [ -e "$required" ] || { echo "missing: $required" >&2; exit 1; }
done

SNAPSHOT="$(cd "$SNAPSHOT" && pwd)"
MIRROR="$(cd "$MIRROR" && pwd)"

echo "About to restore:"
echo "  snapshot      $SNAPSHOT"
echo "  media mirror  $MIRROR"
[ -f "$SNAPSHOT/MANIFEST" ] && sed 's/^/  | /' "$SNAPSHOT/MANIFEST"
echo
echo "This destroys the current database, object storage and keys in this stack."
if [ "${ASSUME_YES:-}" != "1" ]; then
    printf 'Type RESTORE to continue: '
    read -r answer
    [ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }
fi

echo
echo "==> stopping the web app so nothing writes during the restore"
$COMPOSE stop web || true

echo "==> starting database and object storage"
$COMPOSE up -d --wait postgres garage

# Garage keeps its keys, bucket and cluster layout in its own metadata, which this backup
# deliberately does not capture — the migration service recreates all three from .env, so
# the same access key in .env is what makes the restored media reachable again.
echo "==> provisioning schema, garage layout, key and bucket"
$COMPOSE run --rm migrations

echo "==> restoring the database"
$COMPOSE --profile backup run --rm --no-deps \
    -v "$SNAPSHOT:/restore:ro" \
    --entrypoint sh backup -c '
        set -eu
        pg_restore \
            --clean --if-exists \
            --no-owner --no-privileges \
            --dbname "$PGDATABASE" \
            /restore/postgres.dump
    '

echo "==> restoring object storage"
$COMPOSE --profile backup run --rm --no-deps \
    -v "$MIRROR:/restore-media:ro" \
    --entrypoint sh backup -c '
        set -eu
        RCLONE_CONFIG_GARAGE_TYPE=s3 \
        RCLONE_CONFIG_GARAGE_PROVIDER=Other \
        RCLONE_CONFIG_GARAGE_ENDPOINT="$S3_ENDPOINT" \
        RCLONE_CONFIG_GARAGE_REGION="$S3_REGION" \
        RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
        RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
        RCLONE_CONFIG_GARAGE_FORCE_PATH_STYLE=true \
            rclone sync --stats-one-line /restore-media "garage:$S3_BUCKET_NAME"
    '

if [ -f "$SNAPSHOT/data-protection-keys.tar.gz" ]; then
    echo "==> restoring data protection keys"
    $COMPOSE --profile backup run --rm --no-deps \
        -v "$SNAPSHOT:/restore:ro" \
        --entrypoint sh backup -c '
            set -eu
            find /keys-restore -mindepth 1 -delete
            tar -xzf /restore/data-protection-keys.tar.gz -C /keys-restore
        '
else
    echo "==> no data protection keys in the snapshot; everyone will have to sign in again"
fi

echo "==> starting the stack"
$COMPOSE up -d --wait

echo
echo "Restore finished. Check that the app answers and that songs, presentations and"
echo "images are all there before you trust this snapshot."
