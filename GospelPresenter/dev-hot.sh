#!/usr/bin/env bash
# Replicate the Rider "GospelPresenter.Web: Hot reload" compound configuration in tmux.
# Runs three processes in separate panes:
#   1. dotnet watch (hot reload)
#   2. Tailwind CSS watcher
#   3. Hot reload helper (fswatch - triggers CSS rebuild on .razor changes)

set -euo pipefail

SESSION="gospel-dev"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$PROJECT_DIR/GospelPresenter.Web"
SHARED_DIR="$PROJECT_DIR/GospelPresenter.Shared"

# Kill existing session if running
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Pane 1: dotnet watch
tmux new-session -d -s "$SESSION" -n "dev" -c "$WEB_DIR"
tmux send-keys -t "$SESSION" \
  "ASPNETCORE_ENVIRONMENT=Development dotnet watch run --non-interactive --no-launch-profile --urls=https://0.0.0.0:7175 2>&1 | tee /tmp/dotnet-watch.log" Enter

# Pane 2: Tailwind CSS watcher
tmux split-window -h -t "$SESSION" -c "$SHARED_DIR"
tmux send-keys -t "$SESSION" \
  "./tailwindcss-4.1.13 -i tailwind-input.css -o wwwroot/tailwind-output.css -w" Enter

# Pane 3: Hot reload helper (fswatch)
tmux split-window -v -t "$SESSION" -c "$SHARED_DIR"
tmux send-keys -t "$SESSION" \
  "./hot_reload_helper.sh" Enter

tmux select-pane -t "$SESSION:.0"
tmux attach-session -t "$SESSION"
