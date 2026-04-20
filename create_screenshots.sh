#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

dotnet run \
  --project "$SCRIPT_DIR/GospelPresenter/GospelPresenter.Screenshots" \
  -- \
  --output "$SCRIPT_DIR/docs/src/screenshots"
