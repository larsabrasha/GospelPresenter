#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

trap 'docker compose -f docker-compose.screenshots.yml down --remove-orphans' EXIT

docker compose -f docker-compose.screenshots.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from screenshots
