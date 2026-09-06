# Based on the same postgres image the stack runs, so pg_dump can never end up older than
# the server it dumps — bumping postgres in docker-compose.yml bumps the dump tool with it.
FROM postgres:17

# The postgres image ships no HTTP client at all, so the healthcheck ping needs one.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# rclone is not packaged for this base and the image should not depend on apt for it;
# the official image publishes a static binary that works as-is.
COPY --from=rclone/rclone:1 /usr/local/bin/rclone /usr/local/bin/rclone

COPY backup.sh /usr/local/bin/backup
RUN chmod 755 /usr/local/bin/backup /usr/local/bin/rclone

ENTRYPOINT ["/usr/local/bin/backup"]
