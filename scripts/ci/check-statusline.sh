#!/usr/bin/env bash
# CI golden check for the Claude Code statusline: renders buddy-status.sh
# against the committed fixture state and asserts the output shape.
# Run from the repo root: bash scripts/ci/check-statusline.sh
set -euo pipefail

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/statusline-fixture" && pwd)"
payload='{"session_id":"ci","model":{"display_name":"CI"},"workspace":{"current_dir":"."}}'

start=$(date +%s)
output="$(printf '%s' "$payload" | CLAUDE_CONFIG_DIR="$fixture_dir" bash statusline/buddy-status.sh)"
elapsed=$(( $(date +%s) - start ))

plain="$(printf '%s' "$output" | sed $'s/\x1b\[[0-9;]*m//g')"
lines=$(printf '%s\n' "$plain" | wc -l | tr -d ' ')

fail() { echo "FAIL: $1" >&2; printf '%s\n' "$plain" >&2; exit 1; }

name="$(jq -r .name "$fixture_dir/buddy-state/status.json")"
printf '%s' "$plain" | grep -q "$name" || fail "pet name '$name' missing from output"
[ "$lines" -ge 4 ] || fail "expected >=4 output lines, got $lines"
[ "$elapsed" -le 10 ] || fail "statusline took ${elapsed}s (budget 10s)"

echo "OK: statusline rendered $lines lines with '$name' in ${elapsed}s"
