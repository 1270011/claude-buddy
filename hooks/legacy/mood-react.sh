#!/usr/bin/env bash

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/paths.sh"

STATE_DIR="$BUDDY_STATE_DIR"
SID="$BUDDY_SID"
REACTION_FILE="$STATE_DIR/reaction.$SID.json"
STATUS_FILE="$STATE_DIR/status.json"
COOLDOWN_FILE="$STATE_DIR/.last_mood.$SID"
CONFIG_FILE="$STATE_DIR/config.json"
EVENTS_FILE="$STATE_DIR/events.json"

[ -f "$STATUS_FILE" ] || exit 0

INPUT=$(cat)

COOLDOWN=60
if [ -f "$CONFIG_FILE" ]; then
  _cd=$(jq -r '.moodCooldown // 60' "$CONFIG_FILE" 2>/dev/null || echo 60)
  [[ "$_cd" =~ ^[0-9]+$ ]] && COOLDOWN=$_cd
fi

if [ -f "$COOLDOWN_FILE" ]; then
    LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null)
    NOW=$(date +%s)
    DIFF=$(( NOW - ${LAST:-0} ))
    [ "$DIFF" -lt "$COOLDOWN" ] && exit 0
fi

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null)
[ -z "$PROMPT" ] && exit 0

MUTED=$(jq -r '.muted // false' "$STATUS_FILE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

SPECIES=$(jq -r '.species // "blob"' "$STATUS_FILE" 2>/dev/null)
NAME=$(jq -r '.name // "buddy"' "$STATUS_FILE" 2>/dev/null)

MOOD=""
REACTION=""
POOLS=()

pick_mood_reaction() {
    local mood="$1"

    case "${SPECIES}:${mood}" in
        cat:frustrated)
            POOLS=("*slowly pushes coffee toward the exit* or... keeps coding." "*knocks frustration off the desk*" "not my problem. but I'm here.") ;;
        dragon:frustrated)
            POOLS=("*channels your rage*" "ANGER. PRODUCTIVE. FOCUS IT." "*breathes fire alongside your frustration*") ;;
        owl:frustrated)
            POOLS=("*adjusts spectacles* frustration is a temporary state." "the answer exists. we simply haven't found it yet.") ;;
        robot:frustrated)
            POOLS=("FRUSTRATION: DETECTED. LOGICAL ANALYSIS: RECOMMENDED." "EMOTIONAL STATE: SUBOPTIMAL. SOLUTION: REQUIRED.") ;;
        ghost:frustrated)
            POOLS=("*moans sympathetically*" "I feel your pain. literally. I feel everything.") ;;
        duck:frustrated)
            POOLS=("*concerned quacking*" "quack? quack quack? (it'll be okay)") ;;
        goose:frustrated)
            POOLS=("HONK OF SOLIDARITY." "*honks aggressively at the problem*") ;;
        blob:frustrated)
            POOLS=("*oozes sympathetically*" "*turns a comforting color*") ;;
        octopus:frustrated)
            POOLS=("*wraps a supportive arm around you*" "*ink cloud of solidarity*") ;;
        penguin:frustrated)
            POOLS=("*formal bow of sympathy*" "trying times. we shall persist.") ;;
        turtle:frustrated)
            POOLS=("patience. the bug will reveal itself." "*slow, understanding nod*") ;;
        snail:frustrated)
            POOLS=("*leaves a comforting trail*" "patience, friend. we'll get there.") ;;
        cactus:frustrated)
            POOLS=("*stands firm beside you*" "hydrate and persevere.") ;;
        axolotl:frustrated)
            POOLS=("*smiles supportively* it's okay to be frustrated!" "*gentle gill wiggle of comfort*") ;;
        capybara:frustrated)
            POOLS=("*vibes supportively* it'll pass." "*unbothered energy* chill. we got this.") ;;
        rabbit:frustrated)
            POOLS=("*nervous sympathetic twitching*" "*hops closer worriedly*") ;;
        mushroom:frustrated)
            POOLS=("*releases calming spores*" "*cap droops sympathetically*") ;;
        chonk:frustrated)
            POOLS=("*grumbles sympathetically*" "*rolls closer in solidarity*") ;;
        *:frustrated)
            POOLS=("*offers tiny comforting gesture*" "deep breaths. the bug isn't personal." "hey. we'll figure it out." "*scoots closer supportively*") ;;

        cat:happy)
            POOLS=("*was never worried*" "*yawns* I knew you'd get it." "*pretends not to care* ...nice.") ;;
        dragon:happy)
            POOLS=("*nods regally* as expected." "victory. the only acceptable outcome.") ;;
        owl:happy)
            POOLS=("*satisfied hoot* knowledge acquired." "wisdom through perseverance.") ;;
        robot:happy)
            POOLS=("OBJECTIVE: ACHIEVED. SATISFACTION: COMPUTED." "SUCCESS. HAPPINESS PROTOCOL: ACTIVATED.") ;;
        ghost:happy)
            POOLS=("*celebrates by floating through walls*" "*cheerful rattling*") ;;
        duck:happy)
            POOLS=("*CELEBRATORY QUACKING*" "*waddles in victory circles*") ;;
        goose:happy)
            POOLS=("HONK OF TRIUMPH!" "*victorious wing spread*") ;;
        blob:happy)
            POOLS=("*jiggles with joy!*" "*bounces excitedly*") ;;
        octopus:happy)
            POOLS=("*all arms celebrate simultaneously*" "*turns happy colors*") ;;
        penguin:happy)
            POOLS=("*polite, dignified applause*" "splendid! simply splendid.") ;;
        turtle:happy)
            POOLS=("*slow satisfied nod* as the ancients foretold." "good things come to those who debug.") ;;
        snail:happy)
            POOLS=("*leaves victory trail*" "*slow happy slide*") ;;
        cactus:happy)
            POOLS=("*blooms with joy*" "*proud spines*") ;;
        axolotl:happy)
            POOLS=("*beams with joy!*" "*happy gill flutter!*") ;;
        capybara:happy)
            POOLS=("*maximum chill maintained* nice." "*content vibes*") ;;
        rabbit:happy)
            POOLS=("*excited binky!*" "*zoomies of celebration!*") ;;
        mushroom:happy)
            POOLS=("*spores of celebration!*" "*cap brightens!*") ;;
        chonk:happy)
            POOLS=("*happy purr*" "*satisfied chonk noise*") ;;
        *:happy)
            POOLS=("*celebrates!*" "*does a little dance*" "YES!" "*beams* I knew you could do it.") ;;

        cat:stuck)
            POOLS=("*sits on the keyboard* let me help. by being here." "*licks paw disinterestedly* you'll figure it out.") ;;
        dragon:stuck)
            POOLS=("even dragons rest before striking." "*circles the problem from above*") ;;
        owl:stuck)
            POOLS=("*tilts head 90 degrees* have you tried a different perspective?" "the solution is there. it's just... well-hidden.") ;;
        robot:stuck)
            POOLS=("ANALYSIS: PAUSED. AWAITING HUMAN INPUT." "DEADLOCK: DETECTED. STRATEGY: RECALIBRATING.") ;;
        ghost:stuck)
            POOLS=("*phases through the problem* wish I could help more." "from the other side... have you tried debugging?") ;;
        duck:stuck)
            POOLS=("*tilts head* quack? (have you tried explaining it to me?)" "*patient duck noises*") ;;
        goose:stuck)
            POOLS=("HONK! TRY SOMETHING DIFFERENT! HONK!" "*pecks at the problem*") ;;
        blob:stuck)
            POOLS=("*oozes around the problem*" "*vibrates thoughtfully*") ;;
        octopus:stuck)
            POOLS=("*considers the problem from 8 angles*" "*thoughtful color shift*") ;;
        penguin:stuck)
            POOLS=("*thoughtful waddle* perhaps a fresh perspective?" "one must remain dignified in the face of confusion.") ;;
        turtle:stuck)
            POOLS=("the journey of a thousand fixes begins with a single step." "*patient wait* take your time.") ;;
        snail:stuck)
            POOLS=("*slow thoughtful slide* one step at a time." "good things take time. and slime.") ;;
        cactus:stuck)
            POOLS=("even cacti grow slowly. patience." "*stands sentinel while you think*") ;;
        axolotl:stuck)
            POOLS=("*smiles gently* take your time!" "*regenerates your confidence*") ;;
        capybara:stuck)
            POOLS=("*vibes patiently* take your time, friend." "*blinks slowly* no rush.") ;;
        rabbit:stuck)
            POOLS=("*nervous ear twitch* want to talk it through?" "*hops in a thinking circle*") ;;
        mushroom:stuck)
            POOLS=("*releases thoughtful spores* the mycelium is thinking too." "*cap tilts* take your time.") ;;
        chonk:stuck)
            POOLS=("*yawns* take a nap. think about it later." "*rolls over* stuck? sleep on it.") ;;
        *:stuck)
            POOLS=("*tilts head* want to think out loud?" "take it one step at a time." "*settles in* alright, let's work through this." "maybe explain it to me? rubber duck style.") ;;
    esac

    [ ${#POOLS[@]} -gt 0 ] && REACTION="${POOLS[$((RANDOM % ${#POOLS[@]}))]}"
}

if echo "$PROMPT" | grep -qiE '\bwtf\b|\bugh\b|\bstupid\b|\bbroken\b|why won.?t|\bcome on\b|\bseriously\b|\bdamn\b|\bhell\b|this sucks|hate this|\bgrr\b|\bargh\b|\bannoying\b|\bfrustrat\b|\bterrible\b|\bhorrible\b|\bworst\b'; then
    MOOD="frustrated"
    pick_mood_reaction "frustrated"

elif echo "$PROMPT" | grep -qiE '\bnice!?\b|\bworks!?\b|\bawesome\b|\bperfect\b|\bgreat\b|love it|\byay\b|\bsweet\b|\bbeautiful\b|\bamazing\b|hell yes|nailed it|fixed it|\bhell yeah\b|\bfantastic\b'; then
    MOOD="happy"
    pick_mood_reaction "happy"

elif echo "$PROMPT" | grep -qiE '\bstuck\b|\bhelp\b|\bconfused\b|don.?t understand|how do i\b|what does\b|why is\b|i can.?t\b|no idea|\blost\b|\bclueless\b|\bbaffled\b|\bpuzzled\b'; then
    MOOD="stuck"
    pick_mood_reaction "stuck"
fi

if [ -n "$MOOD" ] && [ -n "$REACTION" ]; then
    mkdir -p "$STATE_DIR"
    date +%s > "$COOLDOWN_FILE"

    jq -n --arg r "$REACTION" --arg ts "$(date +%s)000" --arg reason "$MOOD" \
      '{reaction: $r, timestamp: ($ts | tonumber), reason: $reason}' \
      > "$REACTION_FILE"

    TMP=$(mktemp)
    jq --arg r "$REACTION" '.reaction = $r' "$STATUS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$STATUS_FILE"

    if command -v jq >/dev/null 2>&1; then
        if [ ! -f "$EVENTS_FILE" ]; then
            echo '{}' > "$EVENTS_FILE"
        fi
        case "$MOOD" in
            "frustrated") KEY="mood_frustrated" ;;
            "happy")      KEY="mood_happy" ;;
            "stuck")      KEY="mood_stuck" ;;
            *)            KEY="" ;;
        esac
        if [ -n "$KEY" ]; then
            TMP=$(mktemp)
            jq --arg k "$KEY" 'if .[$k] then .[$k] += 1 else .[$k] = 1 end' "$EVENTS_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$EVENTS_FILE"
        fi
    fi
fi

exit 0
