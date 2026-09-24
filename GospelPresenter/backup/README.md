# Backup and restore

The server writes backups into a local directory. A NAS pulls from that directory over
SSH. Nothing on the server holds credentials to the NAS, so a compromised or failed
server cannot reach the history.

The local directory is **not** the backup — it is a staging area on the same disk as the
database. It becomes a backup once the NAS has pulled it.

## What is backed up

| | |
| --- | --- |
| `snapshots/<timestamp>/postgres.dump` | the database, `pg_dump -Fc`, verified with `pg_restore --list` |
| `snapshots/<timestamp>/data-protection-keys.tar.gz` | without these every session cookie is invalid and everyone signs in again |
| `snapshots/<timestamp>/env`, `garage.toml` | secrets that exist nowhere else — without them nothing else restores |
| `garage/` | an rclone mirror of the S3 bucket, updated in place |
| `LAST_SUCCESS` | timestamp of the last complete run |

The media mirror is shared by all snapshots instead of copied per run, so restoring an
older snapshot pairs an older database with current media. That is the right trade for a
few gigabytes of mostly-unchanging images; point-in-time for media comes from the
snapshots the NAS takes of its own copy.

Garage's own metadata — cluster layout, API keys, bucket definitions — is deliberately
not captured. The migration service recreates all three from `.env` on an empty Garage,
which is why `.env` is the file that matters most.

## Running it

Build once, then run from cron:

```shell
docker compose --profile backup build
```

```shell
0 2 * * * cd /srv/gospelpresenter && docker compose --profile backup run --rm backup >> /var/log/gp-backup.log 2>&1
```

The job is behind a compose profile, so `docker compose up -d` never starts it.

Each snapshot is written to `.incoming/` and renamed into `snapshots/` only when
complete. Rename is atomic within a filesystem, so a pull that runs mid-backup either
sees the whole snapshot or does not see it at all.

Set `BACKUP_HEALTHCHECK_URL` to a healthchecks.io check or an Uptime Kuma push monitor.
It is pinged on success and at `/fail` on failure. A backup job that silently stopped
months ago is the normal way this goes wrong, and this is the thing that catches it.

## Pulling from TrueNAS

Create an Rsync Task with direction **Pull**, pointing at `BACKUP_DIR` on the server,
with an SSH key stored under Credentials. Nothing needs to be opened on the NAS.

Give the receiving dataset a Periodic Snapshot Task. rsync plus ZFS snapshots is
versioned backup — restic or borg would add nothing here.

Check that `LAST_SUCCESS` actually moves. An rsync task that faithfully copies the same
stale dump every night looks perfectly healthy in its own log.

## Restoring

```shell
./backup/restore.sh /path/to/snapshots/20260906T020000Z
```

It stops the web app, provisions Garage and the schema, restores the dump, pushes the
media back and restarts the stack. `ASSUME_YES=1` skips the prompt.

Rehearse it. A monthly run against a throwaway stack on another port is the only way to
know the backups are real, and it is also how you find out that `.env` was missing before
the day it matters.
