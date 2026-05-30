#!/usr/bin/env bash
# claude-buddy Stop hook — proactive suggestion detection
# Detects coding patterns and offers suggestions when relevant.
#
# Combined with buddy-comment.sh to avoid running two separate Stop hooks.

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/paths.sh"

STATE_DIR="$BUDDY_STATE_DIR"
CONFIG_FILE="$STATE_DIR/config.json"
LAST_SUGGESTION_FILE="$STATE_DIR/.last_suggestion"
SUGGESTIONS_FILE="$STATE_DIR/suggestions.json"

[ -f "$CONFIG_FILE" ] || exit 0

# Check if suggestions are enabled (default: true)
SUGGESTIONS_ENABLED="true"
if [ -f "$CONFIG_FILE" ]; then
    _enabled=$(jq -r '.suggestionsEnabled // true' "$CONFIG_FILE" 2>/dev/null)
    [ "$_enabled" = "false" ] && exit 0
fi

# Check cooldown (default: 180s = 3 min)
SUGGESTION_COOLDOWN=180
if [ -f "$CONFIG_FILE" ]; then
    _cd=$(jq -r '.suggestionCooldown // 180' "$CONFIG_FILE" 2>/dev/null || echo 180)
    [[ "$_cd" =~ ^[0-9]+$ ]] && SUGGESTION_COOLDOWN=$_cd
fi

if [ -f "$LAST_SUGGESTION_FILE" ]; then
    LAST=$(cat "$LAST_SUGGESTION_FILE" 2>/dev/null)
    NOW=$(date +%s)
    DIFF=$(( NOW - ${LAST:-0} ))
    [ "$DIFF" -lt "$SUGGESTION_COOLDOWN" ] && exit 0
fi

INPUT=$(cat)

# Extract messages
ASSISTANT_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null)
[ -z "$ASSISTANT_MSG" ] && exit 0

# Record turn and check patterns
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check for patterns via the suggestions script
if [ -x "$(command -v bun)" ]; then
    # Run the suggestion check (async, non-blocking)
    bun run "$PLUGIN_ROOT/server/check-suggestions.ts" \
        "$(echo "$ASSISTANT_MSG" | jq -Rs .)" \
        >/dev/null 2>&1 &
fi

exit 0
