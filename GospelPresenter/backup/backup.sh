#!/bin/sh
#
# Writes a backup of the Gospel Presenter stack into /backup, which a NAS pulls from.
# Nothing here reaches out to the NAS: the server never holds credentials to the backup
# store, so losing the server does not lose the history.
#
# Layout under /backup:
#
#   garage/                    rclone mirror of the S3 bucket, updated in place
#   snapshots/<timestamp>/     postgres dump, data protection keys, config
#   LAST_SUCCESS               timestamp of the last complete run
#
# The media mirror is shared by every snapshot rather than copied per run. Restoring an
# older snapshot therefore pairs an older database with the current media. Point-in-time
# for media comes from the snapshots the NAS takes of its own copy, not from here.

set -eu

BACKUP_ROOT=/backup
KEEP="${BACKUP_KEEP:-7}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
INCOMING="$BACKUP_ROOT/.incoming/$TIMESTAMP"
FINAL="$BACKUP_ROOT/snapshots/$TIMESTAMP"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

ping_healthcheck() {
    [ -n "${HEALTHCHECK_URL:-}" ] || return 0
    curl -fsS -m 15 --retry 3 "$HEALTHCHECK_URL$1" -o /dev/null || \
        log "warning: could not reach healthcheck url"
}

on_failure() {
    status=$?
    log "FAILED with exit code $status"
    rm -rf "$INCOMING"
    ping_healthcheck "/fail"
    exit "$status"
}
trap on_failure EXIT INT TERM

umask 077

: "${PGHOST:?PGHOST is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

mkdir -p "$BACKUP_ROOT/snapshots" "$BACKUP_ROOT/garage" "$INCOMING"
chmod 700 "$BACKUP_ROOT" "$BACKUP_ROOT/snapshots" "$BACKUP_ROOT/.incoming" "$INCOMING"

# ---------------------------------------------------------------- object storage
# Sync first: it is the slow part, and a snapshot is only published once everything
# before it succeeded.
log "syncing object storage from $S3_ENDPOINT"

RCLONE_CONFIG_GARAGE_TYPE=s3 \
RCLONE_CONFIG_GARAGE_PROVIDER=Other \
RCLONE_CONFIG_GARAGE_ENDPOINT="$S3_ENDPOINT" \
RCLONE_CONFIG_GARAGE_REGION="${S3_REGION:-garage}" \
RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
RCLONE_CONFIG_GARAGE_FORCE_PATH_STYLE=true \
    rclone sync \
        --stats-one-line \
        --stats 30s \
        --transfers 4 \
        "garage:${S3_BUCKET_NAME:-gospelpresenter}" \
        "$BACKUP_ROOT/garage"

garage_files="$(find "$BACKUP_ROOT/garage" -type f | wc -l | tr -d ' ')"
log "object storage mirror holds $garage_files files"

# ---------------------------------------------------------------- database
log "dumping database ${PGDATABASE:-gospelpresenter}"
pg_dump \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --file="$INCOMING/postgres.dump"

# A dump that cannot be listed cannot be restored. Catch that now, not in an emergency.
pg_restore --list "$INCOMING/postgres.dump" > "$INCOMING/postgres.toc"
log "dump verified, $(wc -l < "$INCOMING/postgres.toc" | tr -d ' ') entries"

# ---------------------------------------------------------------- keys and config
# Without these the database and the media are not restorable: the keys decrypt
# authentication cookies, and the config holds every secret the stack needs.
if [ -d /keys ]; then
    tar -czf "$INCOMING/data-protection-keys.tar.gz" -C /keys .
    log "packed data protection keys"
else
    log "warning: /keys is not mounted, skipping data protection keys"
fi

for config in /config/env /config/garage.toml; do
    if [ -f "$config" ]; then
        cp "$config" "$INCOMING/$(basename "$config")"
    else
        log "warning: $config is not mounted, skipping"
    fi
done

# ---------------------------------------------------------------- manifest
cat > "$INCOMING/MANIFEST" <<EOF
timestamp=$TIMESTAMP
gp_version=${GP_VERSION:-unset}
postgres_database=${PGDATABASE:-gospelpresenter}
postgres_server=$(psql -tAc 'show server_version' 2>/dev/null || echo unknown)
s3_bucket=${S3_BUCKET_NAME:-gospelpresenter}
s3_files=$garage_files
pg_dump_version=$(pg_dump --version)
EOF

chmod 600 "$INCOMING"/*

# ---------------------------------------------------------------- publish
# rename is atomic within a filesystem, so the NAS never sees a half-written snapshot.
mv "$INCOMING" "$FINAL"
log "published snapshot $TIMESTAMP"

# ---------------------------------------------------------------- rotate
# Only a short local tail. The real history lives on the NAS, and dumps that pile up
# here would fill the same disk the database runs on.
ls -1 "$BACKUP_ROOT/snapshots" | sort -r | tail -n "+$((KEEP + 1))" | while read -r old; do
    log "removing old snapshot $old"
    rm -rf "${BACKUP_ROOT:?}/snapshots/${old:?}"
done

date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_ROOT/LAST_SUCCESS"
echo "$TIMESTAMP" >> "$BACKUP_ROOT/LAST_SUCCESS"

trap - EXIT
ping_healthcheck ""
log "done"
