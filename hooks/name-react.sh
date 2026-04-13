#!/usr/bin/env bash
# claude-buddy UserPromptSubmit hook
# Detects the buddy's name in the user's message → status line reaction.
# No cooldown — name mentions are intentional.

STATE_DIR="$HOME/.claude-buddy"
STATUS_FILE="$STATE_DIR/status.json"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"

[ -f "$STATUS_FILE" ] || exit 0

INPUT=$(cat)

# Claude Code sends the prompt in different fields depending on version
PROMPT=$(echo "$INPUT" | jq -r '
  .prompt // .message // .user_message //
  (.messages[-1].content // "") | if type=="array" then .[0].text else . end
  ' 2>/dev/null)
[ -z "$PROMPT" ] && exit 0

NAME=$(jq -r '.name // ""' "$STATUS_FILE" 2>/dev/null)
[ -z "$NAME" ] && exit 0

# Case-insensitive whole-word match
echo "$PROMPT" | grep -qiE "(^|[^a-zA-Z])${NAME}([^a-zA-Z]|$)" 2>/dev/null || exit 0

SPECIES=$(jq -r '.species // "blob"' "$STATUS_FILE" 2>/dev/null)
MUTED=$(jq -r '.muted // false' "$STATUS_FILE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

# Species-specific name-call reactions
case "$SPECIES" in
  dragon)
    REACTIONS=(
      "*one eye opens slowly*"
      "...you called?"
      "*smoke curls from nostril* yes."
      "*regards you from above*"
    ) ;;
  owl)
    REACTIONS=(
      "*swivels head 180°*"
      "*blinks once, deliberately*"
      "hm."
      "*adjusts perch*"
    ) ;;
  cat)
    REACTIONS=(
      "*ear flicks*"
      "...what."
      "*ignores you, but heard*"
      "*opens one eye*"
    ) ;;
  duck)
    REACTIONS=(
      "*quack*"
      "*looks up mid-waddle*"
      "*attentive duck noises*"
    ) ;;
  ghost)
    REACTIONS=(
      "*materialises*"
      "...boo?"
      "*phases closer*"
    ) ;;
  robot)
    REACTIONS=(
      "NAME DETECTED."
      "*whirrs attentively*"
      "STANDING BY."
    ) ;;
  capybara)
    REACTIONS=(
      "*barely moves*"
      "*blinks slowly*"
      "...yes, friend."
    ) ;;
  axolotl)
    REACTIONS=(
      "*gill flutter*"
      "*smiles gently*"
      "oh! hello."
    ) ;;
  blob)
    REACTIONS=(
      "*jiggles*"
      "*oozes toward you*"
      "*wobbles excitedly*"
    ) ;;
  turtle)
    REACTIONS=(
      "*slowly extends neck*"
      "...you called?"
      "*ancient eyes open*"
      "*shell creaks thoughtfully*"
      "*blinks once, patiently*"
    ) ;;
  goose)
    REACTIONS=(
      "HONK."
      "*necks aggressively*"
      "*wing flap*"
      "*honks in recognition*"
    ) ;;
  octopus)
    REACTIONS=(
      "*eight eyes open*"
      "*curls an arm toward you*"
      "*changes color curiously*"
      "...yes, friend?"
    ) ;;
  penguin)
    REACTIONS=(
      "*adjusts tie*"
      "*dignified waddle*"
      "*bows slightly*"
      "...yes, quite?"
    ) ;;
  snail)
    REACTIONS=(
      "*slow head extension*"
      "...mmm?"
      "*trails slowly toward you*"
      "*antenna twitches*"
    ) ;;
  cactus)
    REACTIONS=(
      "*stands silent*"
      "...hm."
      "*spine twitches*"
      "*slowly rotates*"
    ) ;;
  rabbit)
    REACTIONS=(
      "*ears perk up*"
      "*nose twitches*"
      "yes?"
      "*hops closer*"
    ) ;;
  mushroom)
    REACTIONS=(
      "*releases a tiny spore*"
      "*cap tilts*"
      "*stands mysterious*"
      "...yes?"
    ) ;;
  chonk)
    REACTIONS=(
      "*barely opens one eye*"
      "...mrrp?"
      "*yawns heavily*"
      "*rolls over toward you*"
    ) ;;
  *)
    REACTIONS=(
      "*perks up*"
      "...yes?"
      "*looks your way*"
    ) ;;
esac

N=${#REACTIONS[@]}
REACTION="${REACTIONS[$((RANDOM % N))]}"

mkdir -p "$STATE_DIR"

TMP=$(mktemp)
jq --arg r "$REACTION" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$STATUS_FILE"

jq -n --arg r "$REACTION" --arg ts "$(date +%s)000" \
  '{reaction: $r, timestamp: ($ts | tonumber), reason: "name"}' \
  > "$STATE_DIR/reaction.$SID.json"

exit 0
