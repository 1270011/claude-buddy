#!/usr/bin/env bash
# buddy-comment Stop hook
# Extracts hidden buddy comment from Claude's response.
# Claude writes: <!-- buddy: *adjusts tophat* nice code -->
# This hook extracts it and updates the status line bubble.
# The HTML comment is invisible in rendered markdown output.

STATE_DIR="$HOME/.claude-buddy"
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

# Increment achievement event counters
if command -v jq >/dev/null 2>&1; then
    if [ ! -f "$EVENTS_FILE" ]; then
        echo '{}' > "$EVENTS_FILE"
    fi
    TMP=$(mktemp)
    jq '.turns = (.turns // 0 + 1)' "$EVENTS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$EVENTS_FILE"
fi

exit 0
