#!/usr/bin/env bash
# claude-buddy MCP server launcher — preflight checks bun, then execs the server.
# Failing here with a clear stderr message is much easier to debug than a silent
# "MCP tools not available" from Claude Code.

set -eu

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[claude-buddy] ERROR: 'bun' was not found on PATH.

claude-buddy's MCP server runs on bun. Install it with:

    curl -fsSL https://bun.sh/install | bash

Then open a new shell (so PATH picks up bun) and restart Claude Code.
EOF
  exit 127
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bun "$SCRIPT_DIR/index.ts"
