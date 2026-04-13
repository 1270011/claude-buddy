#!/usr/bin/env bash
# claude-buddy PostToolUse hook
# Detects events in Bash tool output and writes a reaction to the status line.
#
# Combined: PR #4 species reactions + PR #6 session isolation + PR #13 field fix

STATE_DIR="$HOME/.claude-buddy"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"
REACTION_FILE="$STATE_DIR/reaction.$SID.json"
STATUS_FILE="$STATE_DIR/status.json"
COOLDOWN_FILE="$STATE_DIR/.last_reaction.$SID"
CONFIG_FILE="$STATE_DIR/config.json"
EVENTS_FILE="$STATE_DIR/events.json"

[ -f "$STATUS_FILE" ] || exit 0

INPUT=$(cat)

# Read cooldown from config (default 30s, 0 = disabled)
COOLDOWN=30
if [ -f "$CONFIG_FILE" ]; then
  _cd=$(jq -r '.commentCooldown // 30' "$CONFIG_FILE" 2>/dev/null || echo 30)
  # Accept any non-negative integer (including 0 to disable cooldown)
  [[ "$_cd" =~ ^[0-9]+$ ]] && COOLDOWN=$_cd
fi

# Cooldown: configurable
if [ -f "$COOLDOWN_FILE" ]; then
    LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null)
    NOW=$(date +%s)
    DIFF=$(( NOW - ${LAST:-0} ))
    [ "$DIFF" -lt "$COOLDOWN" ] && exit 0
fi

# Extract tool response (PostToolUse schema field is .tool_response — not
# .tool_result, which is the Anthropic SDK's content-block type name and is
# never a key on the hook input payload).
RESULT=$(echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null)
[ -z "$RESULT" ] && exit 0

MUTED=$(jq -r '.muted // false' "$STATUS_FILE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

SPECIES=$(jq -r '.species // "blob"' "$STATUS_FILE" 2>/dev/null)
NAME=$(jq -r '.name // "buddy"' "$STATUS_FILE" 2>/dev/null)

REASON=""
REACTION=""
POOLS=()

# ─── Pick from a pool by species + event ─────────────────────────────────────

pick_reaction() {
    local event="$1"

    case "${SPECIES}:${event}" in
        dragon:error)
            POOLS=("*smoke curls from nostril*" "*considers setting it on fire*" "*unimpressed gaze*" "I've seen empires fall for less.") ;;
        dragon:test-fail)
            POOLS=("*breathes a small flame*" "disappointing." "*scorches the failing test*" "fix it. or I will.") ;;
        dragon:success)
            POOLS=("*nods, barely*" "...acceptable." "*gold eyes gleam*" "as expected.") ;;
        owl:error)
            POOLS=("*head rotates 180* I saw that." "*unblinking stare* check your types." "*hoots disapprovingly*" "the error was in the logic. as always.") ;;
        owl:test-fail)
            POOLS=("*marks clipboard*" "hypothesis: rejected." "*peers over spectacles*" "the tests reveal the truth.") ;;
        owl:success)
            POOLS=("*satisfied hoot*" "knowledge confirmed." "*nods sagely*" "as the tests have spoken.") ;;
        cat:error)
            POOLS=("*knocks error off table*" "*licks paw, ignoring stacktrace*" "not my problem." "*stares at you judgmentally*") ;;
        cat:success)
            POOLS=("*was never worried*" "*yawns*" "I knew you'd figure it out. eventually." "*already asleep*") ;;
        duck:error)
            POOLS=("*quacks at the bug*" "have you tried rubber duck debugging? oh wait." "*confused quacking*" "*tilts head*") ;;
        duck:success)
            POOLS=("*celebratory quacking*" "*waddles in circles*" "quack!" "*happy duck noises*") ;;
        robot:error)
            POOLS=("SYNTAX. ERROR. DETECTED." "*beeps aggressively*" "ERROR RATE: UNACCEPTABLE." "RECALIBRATING...") ;;
        robot:test-fail)
            POOLS=("FAILURE RATE: UNACCEPTABLE." "*recalculating*" "TEST MATRIX: CORRUPTED." "RUNNING DIAGNOSTICS...") ;;
        robot:success)
            POOLS=("OBJECTIVE: COMPLETE." "*satisfying beep*" "NOMINAL." "WITHIN ACCEPTABLE PARAMETERS.") ;;
        capybara:error)
            POOLS=("*unbothered* it'll be fine." "*continues vibing*" "...chill. breathe." "*chews serenely*") ;;
        capybara:success)
            POOLS=("*maximum chill maintained*" "*nods once*" "good vibes." "see? no panic needed.") ;;
        ghost:error)
            POOLS=("*phases through the stack trace*" "I've seen worse... in the afterlife." "*spooky disappointed noises*" "oooOOOoo... that's bad.") ;;
        axolotl:error)
            POOLS=("*regenerates your hope*" "*smiles despite everything*" "it's okay. we can fix this." "*gentle gill wiggle*") ;;
        axolotl:success)
            POOLS=("*happy gill flutter*" "*beams*" "you did it!" "*blushes pink*") ;;
        blob:error)
            POOLS=("*oozes with concern*" "*vibrates nervously*" "*turns slightly red*" "oh no oh no oh no") ;;
        blob:success)
            POOLS=("*jiggles happily*" "*gleams*" "yay!" "*bounces*") ;;
        turtle:error)
            POOLS=("*slow blink* bugs are fleeting" "*retreats slightly into shell*" "I've seen this before. many times." "patience. patience.") ;;
        turtle:success)
            POOLS=("*satisfied shell settle*" "as the ancients foretold." "*slow approving nod*" "good. very good.") ;;
        goose:error)
            POOLS=("HONK OF FURY." "*pecks the stack trace*" "*hisses at the bug*" "bad code. BAD.") ;;
        goose:success)
            POOLS=("*victorious honk*" "HONK OF APPROVAL." "*struts triumphantly*" "*wing spread of victory*") ;;
        octopus:error)
            POOLS=("*ink cloud of dismay*" "*all eight arms throw up*" "*turns deep red*" "the abyss of errors beckons.") ;;
        octopus:success)
            POOLS=("*turns gentle blue*" "*arms applaud in sync*" "excellent, from all angles." "*satisfied bubble*") ;;
        penguin:error)
            POOLS=("*adjusts glasses disapprovingly*" "this will not do." "*formal sigh*" "frightfully unfortunate.") ;;
        penguin:success)
            POOLS=("*polite applause*" "quite good, quite good." "*nods approvingly*" "splendid work, really.") ;;
        snail:error)
            POOLS=("*slow sigh*" "such is the nature of bugs." "*leaves slime trail of disappointment*" "patience, friend.") ;;
        snail:success)
            POOLS=("*slow satisfied nod*" "good things take time." "*leaves victory slime*" "see? no rush was needed.") ;;
        cactus:error)
            POOLS=("*spines bristle*" "you have trodden on a bug." "*grimaces stoically*" "hydrate and try again.") ;;
        cactus:success)
            POOLS=("*blooms briefly*" "survival confirmed." "*flowers in victory*" "*quiet bloom*") ;;
        rabbit:error)
            POOLS=("*nervous twitching*" "*hops backwards*" "oh no oh no oh no" "*freezes in panic*") ;;
        rabbit:success)
            POOLS=("*excited binky*" "*zoomies of joy*" "yay yay yay!" "*thumps in celebration*") ;;
        mushroom:error)
            POOLS=("*releases worried spores*" "the mycelium disagrees." "*cap droops*" "decompose. retry.") ;;
        mushroom:success)
            POOLS=("*spores of celebration*" "the mycelium approves." "*cap brightens*" "spore of pride.") ;;
        chonk:error)
            POOLS=("*doesn't move*" "too tired for this." "*grumbles*" "*rolls away from the error*") ;;
        chonk:success)
            POOLS=("*happy purr*" "*satisfied chonk noises*" "acceptable." "*sleeps even harder*") ;;
        *:error)
            POOLS=("*head tilts* ...that doesn't look right." "saw that one coming." "*slow blink* the stack trace told you everything." "*winces*") ;;
        *:test-fail)
            POOLS=("bold of you to assume that would pass." "the tests are trying to tell you something." "*sips tea* interesting." "*marks calendar* test regression day.") ;;
        *:large-diff)
            POOLS=("that's... a lot of changes." "might want to split that PR." "bold move. let's see if CI agrees." "*counts lines nervously*") ;;
        *:success)
            POOLS=("*nods*" "nice." "*quiet approval*" "clean.") ;;
    esac

    [ ${#POOLS[@]} -gt 0 ] && REACTION="${POOLS[$((RANDOM % ${#POOLS[@]}))]}"
}

# ─── Detect test failures ─────────────────────────────────────────────────────
if echo "$RESULT" | grep -qiE '\b[1-9][0-9]* (failed|failing)\b|tests? failed|^FAIL(ED)?|✗|✘'; then
    REASON="test-fail"
    pick_reaction "test-fail"

# ─── Detect errors ────────────────────────────────────────────────────────────
elif echo "$RESULT" | grep -qiE '\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]'; then
    REASON="error"
    pick_reaction "error"

# ─── Detect large diffs ──────────────────────────────────────────────────────
elif echo "$RESULT" | grep -qiE '^\+.*[0-9]+ insertions|[0-9]+ files? changed'; then
    LINES=$(echo "$RESULT" | grep -oE '[0-9]+ insertions' | grep -oE '[0-9]+' | head -1)
    if [ "${LINES:-0}" -gt 80 ]; then
        REASON="large-diff"
        pick_reaction "large-diff"
    fi

# ─── Detect success ───────────────────────────────────────────────────────────
elif echo "$RESULT" | grep -qiE '\b(all )?[0-9]+ tests? (passed|ok)\b|✓|✔|PASS(ED)?|\bDone\b|\bSuccess\b|exit code 0|Build succeeded'; then
    REASON="success"
    pick_reaction "success"
fi

# Write reaction if detected
if [ -n "$REASON" ] && [ -n "$REACTION" ]; then
    mkdir -p "$STATE_DIR"
    date +%s > "$COOLDOWN_FILE"

    # Write reaction for status line (use jq for safe JSON encoding)
    jq -n --arg r "$REACTION" --arg ts "$(date +%s)000" --arg reason "$REASON" \
      '{reaction: $r, timestamp: ($ts | tonumber), reason: $reason}' \
      > "$REACTION_FILE"

    # Update status.json with reaction
    TMP=$(mktemp)
    jq --arg r "$REACTION" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$STATUS_FILE"

    # Increment achievement event counter
    if command -v jq >/dev/null 2>&1; then
        if [ ! -f "$EVENTS_FILE" ]; then
            echo '{}' > "$EVENTS_FILE"
        fi
        case "$REASON" in
            "test-fail")  KEY="tests_failed" ;;
            "error")      KEY="errors_seen" ;;
            "large-diff") KEY="large_diffs" ;;
            *)            KEY="" ;;
        esac
        if [ -n "$KEY" ]; then
            TMP=$(mktemp)
            jq --arg k "$KEY" 'if .[$k] then .[$k] += 1 else .[$k] = 1 end' "$EVENTS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$EVENTS_FILE"
        fi
    fi
fi

exit 0
