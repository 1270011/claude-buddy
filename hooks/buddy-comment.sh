#!/usr/bin/env bash
# buddy-comment Stop hook
# Extracts the buddy reaction from Claude's response and updates the status line.
#
# Primary path: Claude writes <!-- buddy: *winks* nice code --> and this hook
# extracts it. This relies on HTML comments being invisible in rendered output.
#
# Fallback path: Claude Code v2.1.169+ renders HTML comments visibly. When no
# comment is found, turn-reaction.ts generates a reaction from the turn pool so
# the status line still updates without polluting the chat output.

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/paths.sh"

STATE_DIR="$BUDDY_STATE_DIR"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"
STATUS_FILE="$STATE_DIR/status.json"
COOLDOWN_FILE="$STATE_DIR/.last_comment.$SID"
CONFIG_FILE="$STATE_DIR/config.json"
EVENTS_FILE="$STATE_DIR/events.json"

[ -f "$STATUS_FILE" ] || exit 0

# Read cooldown from config (default 30s, 0 = disabled)
COOLDOWN=30
if [ -f "$CONFIG_FILE" ]; then
  _cd=$(jq -r '.commentCooldown // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
  # Accept any non-negative integer (including 0 to disable cooldown)
  [[ "$_cd" =~ ^[0-9]+$ ]] && COOLDOWN=$_cd
fi

INPUT=$(cat)

# Extract last_assistant_message from hook input
MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null)
[ -z "$MSG" ] && exit 0

# Extract <!-- buddy: ... --> comment (portable, no grep -P)
COMMENT=$(echo "$MSG" | sed -n 's/.*<!-- *buddy: *\(.*[^ ]\) *-->.*/\1/p' | tail -1)

# Fallback: generate a reaction via the hook when no comment is found.
# Handles Claude Code v2.1.169+ which renders HTML comments visibly.
if [ -z "$COMMENT" ] && [ -x "$(command -v bun)" ]; then
    PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    COMMENT=$(bun run "$PLUGIN_ROOT/server/turn-reaction.ts" 2>/dev/null)
fi

[ -z "$COMMENT" ] && exit 0

# Cooldown: configurable (default 30s)
if [ -f "$COOLDOWN_FILE" ]; then
    LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null)
    NOW=$(date +%s)
    [ $(( NOW - ${LAST:-0} )) -lt "$COOLDOWN" ] && exit 0
fi

mkdir -p "$STATE_DIR"
date +%s > "$COOLDOWN_FILE"

# Update status.json with the reaction
TMP=$(mktemp)
jq --arg r "$COMMENT" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$STATUS_FILE"

# Also write reaction file (use jq for safe JSON encoding)
jq -n --arg r "$COMMENT" --arg ts "$(date +%s)000" \
  '{reaction: $r, timestamp: ($ts | tonumber), reason: "turn"}' \
  > "$STATE_DIR/reaction.$SID.json"

# Increment achievement event counters and award XP
if command -v jq >/dev/null 2>&1; then
    if [ ! -f "$EVENTS_FILE" ]; then
        echo '{}' > "$EVENTS_FILE"
    fi
    TMP=$(mktemp)
    jq '.turns = (.turns // 0 + 1)' "$EVENTS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$EVENTS_FILE"
fi

# Award XP for turn (async, non-blocking)
if [ -x "$(command -v bun)" ]; then
    PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    bun run "$PLUGIN_ROOT/server/award-xp.ts" "turn" >/dev/null 2>&1 &
fi

# Consolidate memory (async, non-blocking)
# Extract project, bug, and preference signals from conversation
if [ -x "$(command -v bun)" ]; then
    PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    # Pass the assistant message for analysis (pass empty string for user prompt if unavailable)
    USER_MSG=$(echo "$INPUT" | jq -r '.last_user_message // ""' 2>/dev/null)
    bun run "$PLUGIN_ROOT/server/consolidate.ts" \
        "$(echo "$MSG" | jq -Rs .)" \
        "$(echo "$USER_MSG" | jq -Rs .)" \
        >/dev/null 2>&1 &
fi

exit 0
