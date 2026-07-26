#!/usr/bin/env bash
# Invoked from VHS tapes. Args: <cols> <fixture-relpath-from-repo-root>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cols="${1:?cols}"
fixture_rel="${2:?fixture}"
payload='{"session_id":"ci","model":{"display_name":"CI"},"workspace":{"current_dir":"."}}'
cd "$ROOT"
printf '%s' "$payload" \
  | COLUMNS="$cols" \
    BUDDY_FAKE_NOW=0 \
    CLAUDE_CONFIG_DIR="$ROOT/$fixture_rel" \
    CLAUDE_CODE_SESSION_ID= \
    TMUX_PANE= \
    BUDDY_SHELL= \
    bash statusline/buddy-status.sh
