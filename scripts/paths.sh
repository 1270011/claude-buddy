#!/usr/bin/env bash
# Path resolvers for claude-buddy shell scripts.
#
# Must stay in sync with server/path.ts. Source this file early:
#   source "$(dirname "$0")/../scripts/paths.sh"
# …and consumers get BUDDY_STATE_DIR, CLAUDE_CFG_DIR, CLAUDE_SETTINGS_FILE,
# and CLAUDE_USER_CONFIG.
#
# Resolution rules (must match server/path.ts):
#   - If CLAUDE_CONFIG_DIR is set → everything lives under it
#     (settings.json, skills/, .claude.json inside the config dir, and
#      buddy state at $CLAUDE_CONFIG_DIR/buddy-state).
#   - Else (single-profile default) → $HOME/.claude, $HOME/.claude.json,
#     $HOME/.claude-buddy.

if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
  CLAUDE_CFG_DIR="$CLAUDE_CONFIG_DIR"
else
  CLAUDE_CFG_DIR="$HOME/.claude"
fi

CLAUDE_SETTINGS_FILE="$CLAUDE_CFG_DIR/settings.json"

# .claude.json: inside CLAUDE_CONFIG_DIR when set, else $HOME. We never
# fall back to $HOME when CLAUDE_CONFIG_DIR is set — doing so would break
# profile isolation (enabling buddy in one profile could mutate the
# home-level file that a different profile reads).
if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
  CLAUDE_USER_CONFIG="$CLAUDE_CONFIG_DIR/.claude.json"
else
  CLAUDE_USER_CONFIG="$HOME/.claude.json"
fi

if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
  BUDDY_STATE_DIR="$CLAUDE_CONFIG_DIR/buddy-state"
else
  BUDDY_STATE_DIR="$HOME/.claude-buddy"
fi

export CLAUDE_CFG_DIR CLAUDE_SETTINGS_FILE CLAUDE_USER_CONFIG BUDDY_STATE_DIR

# Windows: Chocolatey installs a PowerShell shim for jq that doesn't work in
# Git Bash. If jq is not found on PATH, check the real Chocolatey binary path
# and common Windows locations, then prepend to PATH so all scripts find it.
if ! command -v jq >/dev/null 2>&1; then
    for _jq_candidate in \
        "/c/ProgramData/chocolatey/lib/jq/tools/jq.exe" \
        "/c/tools/jq/jq.exe" \
        "$HOME/bin/jq.exe" \
        "/usr/local/bin/jq.exe"; do
        if [ -x "$_jq_candidate" ]; then
            export PATH="$(dirname "$_jq_candidate"):$PATH"
            break
        fi
    done
fi
