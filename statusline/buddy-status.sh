#!/usr/bin/env bash
# claude-buddy status line — animated, right-aligned multi-line companion
#
# Animation matches the original:
#   - 500ms per tick, sequence: [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0]
#   - Frame -1 = blink (eyes replaced with "-")
#   - Frames 0,1,2 = the 3 idle art variants per species
#   - refreshInterval: 1s in settings.json cycles the animation
#
# Uses Braille Blank (U+2800) for padding — survives JS .trim()

STATE="$HOME/.claude-buddy/status.json"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"

[ -f "$STATE" ] || exit 0

MUTED=$(jq -r '.muted // false' "$STATE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

NAME=$(jq -r '.name // ""' "$STATE" 2>/dev/null)
[ -z "$NAME" ] && exit 0

REACTION=$(jq -r '.reaction // ""' "$STATE" 2>/dev/null)

# ─── Shared reaction freshness check ─────────────────────────────────────────
# Reads reactionTTL from ~/.claude-buddy/config.json; 0 means "permanent".
# Sets FRESH_REACTION to the reaction text if fresh, otherwise empty.
FRESH_REACTION=""
REACTION_FILE="$HOME/.claude-buddy/reaction.$SID.json"
REACTION_TTL=0
CONFIG_FILE="$HOME/.claude-buddy/config.json"
if [ -f "$CONFIG_FILE" ]; then
    _ttl=$(jq -r '.reactionTTL // 0' "$CONFIG_FILE" 2>/dev/null || echo 0)
    case "$_ttl" in ''|*[!0-9]*) ;; *) REACTION_TTL="$_ttl" ;; esac
fi
if [ -n "$REACTION" ] && [ "$REACTION" != "null" ]; then
    if [ "$REACTION_TTL" -eq 0 ]; then
        FRESH_REACTION="$REACTION"
    elif [ -f "$REACTION_FILE" ]; then
        TS=$(jq -r '.timestamp // 0' "$REACTION_FILE" 2>/dev/null || echo 0)
        if [ "$TS" != "0" ]; then
            NOW=$(date +%s)
            AGE=$(( NOW - TS / 1000 ))
            [ "$AGE" -lt "$REACTION_TTL" ] && FRESH_REACTION="$REACTION"
        fi
    fi
fi

# ─── TEMPORARY: status line capability probe (read before Windows check) ────
TEST_LEVEL_FILE="$HOME/.claude-buddy/status-test-level"
TEST_LEVEL=""
[ -f "$TEST_LEVEL_FILE" ] && TEST_LEVEL=$(cat "$TEST_LEVEL_FILE" 2>/dev/null | tr -cd '0-9' | head -c 2)

# ─── Windows fallback ────────────────────────────────────────────────────────
# Claude Code's status line on Windows strips leading whitespace, rejects a
# range of Unicode codepoints, and mangles multi-line ASCII art in ways we
# can't work around from a shell script. Render a minimal single-line
# "Name: (reaction)" so the companion's voice still comes through.
# Test level 19 bypasses this entire branch so the full non-Windows art
# path runs and we can see what Claude Code does with it.
if { [ -n "$MSYSTEM" ] || [ -n "$WINDIR" ] || [ -n "$SYSTEMROOT" ]; } \
   && [ "$TEST_LEVEL" != "19" ]; then
        case "$TEST_LEVEL" in
            1)
                # Single line, ASCII only, ANSI color
                printf '\033[38;2;153;153;153mBiscuit:\033[0m (hello)\n'
                exit 0 ;;
            2)
                # Single line, ASCII + one Unicode codepoint (non-CJK, non-emoji)
                # U+2726 Black Four Pointed Star — same codepoint as the eye
                printf 'Biscuit \xe2\x9c\xa6: (hello)\n'
                exit 0 ;;
            3)
                # Single line, Unicode + ANSI color combined
                printf '\033[38;2;153;153;153mBiscuit \xe2\x9c\xa6:\033[0m (hello)\n'
                exit 0 ;;
            4)
                # Two lines, plain ASCII, no leading whitespace
                printf 'Biscuit\n(hello)\n'
                exit 0 ;;
            5)
                # Two lines, plain ASCII, with FOUR leading spaces on second
                # line — enough to stand out from Claude's default 2-space pad.
                printf 'Biscuit\n    (hello)\n'
                exit 0 ;;
            6)
                # Four lines, plain ASCII art (no color, no Unicode, no padding)
                printf '.----.\n( oo )\n(    )\n`----'\''\n'
                exit 0 ;;
            7)
                # Four lines of ASCII art with ANSI color
                printf '\033[38;2;153;153;153m.----.\n( oo )\n(    )\n`----'\''\033[0m\n'
                exit 0 ;;
            8)
                # Four lines of real species art with Unicode eyes + ANSI color
                printf '\033[38;2;153;153;153m.----.\n( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n(      )\n`----'\''\033[0m\n'
                exit 0 ;;
            9)
                # Markdown bold
                printf '**Biscuit**: (hello)\n'
                exit 0 ;;
            10)
                # Markdown italic (single asterisks)
                printf '*Biscuit*: (hello)\n'
                exit 0 ;;
            11)
                # Markdown inline code (backticks)
                printf '`Biscuit`: (hello)\n'
                exit 0 ;;
            12)
                # Markdown heading — probably too structural for a status line
                printf '# Biscuit\n(hello)\n'
                exit 0 ;;
            13)
                # Braille Blank U+2800 as leading padding (4 of them)
                printf 'Biscuit\n\xe2\xa0\x80\xe2\xa0\x80\xe2\xa0\x80\xe2\xa0\x80(hello)\n'
                exit 0 ;;
            14)
                # Non-breaking space U+00A0 as leading padding (4 of them, UTF-8)
                printf 'Biscuit\n\xc2\xa0\xc2\xa0\xc2\xa0\xc2\xa0(hello)\n'
                exit 0 ;;
            15)
                # Em space U+2003 as leading padding (4 of them)
                printf 'Biscuit\n\xe2\x80\x83\xe2\x80\x83\xe2\x80\x83\xe2\x80\x83(hello)\n'
                exit 0 ;;
            16)
                # Ideographic space U+3000 as leading padding (4 of them)
                printf 'Biscuit\n\xe3\x80\x80\xe3\x80\x80\xe3\x80\x80\xe3\x80\x80(hello)\n'
                exit 0 ;;
            17)
                # One Braille Blank followed by 3 ASCII spaces — matches the
                # exact pattern the Linux/macOS art path uses for its SPACER.
                printf 'Biscuit\n\xe2\xa0\x80   (hello)\n'
                exit 0 ;;
            18)
                # One Braille Blank followed by an ASCII space, then
                # text, then more ASCII space in the middle — tests whether
                # internal whitespace survives once the line starts with
                # non-whitespace.
                printf 'Biscuit\n\xe2\xa0\x80 a   b   c\n'
                exit 0 ;;
            20)
                # 4 lines of right-aligned art. Each line = Braille Blank +
                # 20 ASCII spaces + art. No ANSI, no speech bubble.
                P='\xe2\xa0\x80                    '
                printf "${P}.----.\n${P}( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n${P}(      )\n${P}\`----'\n"
                exit 0 ;;
            21)
                # 5 lines: same as 20 plus a name line below.
                P='\xe2\xa0\x80                    '
                printf "${P}.----.\n${P}( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n${P}(      )\n${P}\`----'\n${P}Biscuit\n"
                exit 0 ;;
            22)
                # 4 lines, right-aligned art, WITH ANSI color codes.
                P='\xe2\xa0\x80                    '
                C='\033[38;2;153;153;153m'
                R='\033[0m'
                printf "${P}${C}.----.${R}\n${P}${C}( \xe2\x9c\xa6  \xe2\x9c\xa6 )${R}\n${P}${C}(      )${R}\n${P}${C}\`----'${R}\n"
                exit 0 ;;
            23)
                # Dynamic right-alignment: compute padding from tput cols.
                # Art is 8 chars wide; target right margin = 4 columns from
                # the right edge. Padding = cols - art_width - margin.
                COLS=$(tput cols 2>/dev/null || echo 100)
                PAD=$(( COLS - 8 - 4 ))
                [ "$PAD" -lt 1 ] && PAD=1
                SPACER=$(printf '\xe2\xa0\x80%*s' "$PAD" '')
                printf "%s.----.\n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s\`----'\n" \
                    "$SPACER" "$SPACER" "$SPACER" "$SPACER"
                exit 0 ;;
            24)
                # Same as 23 but uses the COLUMNS env var as a fallback if
                # tput cols returns garbage (which it might in a Claude Code
                # subprocess without a real tty).
                COLS=$(tput cols 2>/dev/null)
                [ -z "$COLS" ] || [ "$COLS" -lt 20 ] 2>/dev/null && COLS="${COLUMNS:-100}"
                [ "$COLS" -lt 20 ] 2>/dev/null && COLS=100
                PAD=$(( COLS - 8 - 4 ))
                [ "$PAD" -lt 1 ] && PAD=1
                SPACER=$(printf '\xe2\xa0\x80%*s' "$PAD" '')
                # Also print the detected COLS for debugging
                printf "%sCOLS=%s\n%s.----.\n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s\`----'\n" \
                    "$SPACER" "$COLS" "$SPACER" "$SPACER" "$SPACER" "$SPACER"
                exit 0 ;;
            25)
                # Like 23, but art lines are pre-padded on the LEFT to 8
                # chars so narrow lines line up with wide lines. The narrow
                # lines get 2 leading ASCII spaces — those are internal
                # (after the SPACER) so they should survive the stripping.
                COLS=$(tput cols 2>/dev/null || echo 100)
                PAD=$(( COLS - 8 - 4 ))
                [ "$PAD" -lt 1 ] && PAD=1
                SPACER=$(printf '\xe2\xa0\x80%*s' "$PAD" '')
                printf "%s  .----.\n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s  \`----'\n" \
                    "$SPACER" "$SPACER" "$SPACER" "$SPACER"
                exit 0 ;;
            26)
                # Capture whatever Claude Code writes to stdin and dump it to
                # ~/.claude-buddy/stdin-capture.txt. Then emit the raw bytes
                # inline so we can see them without leaving the status line.
                STDIN_CAPTURE="$HOME/.claude-buddy/stdin-capture.txt"
                cat > "$STDIN_CAPTURE"
                # Show the raw capture, truncated to fit a status line.
                CAPTURE=$(tr -d '\n' < "$STDIN_CAPTURE" | head -c 200)
                printf '\xe2\xa0\x80stdin: %s\n' "$CAPTURE"
                exit 0 ;;
            27)
                # Probe terminal width from many sources. Print each one on
                # its own line so we can see which (if any) gives a real
                # number. Then render art pre-padded to pad=40 (arbitrary).
                STTY_TTY=$(stty size < /dev/tty 2>&1 | head -1)
                [ -z "$STTY_TTY" ] && STTY_TTY="(empty)"
                COLUMNS_VAR="${COLUMNS:-(unset)}"
                TPUT_COLS=$(tput cols 2>&1)
                [ -z "$TPUT_COLS" ] && TPUT_COLS="(empty)"
                MODE_CON=$(cmd //c "mode con" 2>&1 | grep -i column | tr -d '\r' | head -1)
                [ -z "$MODE_CON" ] && MODE_CON="(none)"
                printf '\xe2\xa0\x80stty: %s\n' "$STTY_TTY"
                printf '\xe2\xa0\x80$COLUMNS: %s\n' "$COLUMNS_VAR"
                printf '\xe2\xa0\x80tput: %s\n' "$TPUT_COLS"
                printf '\xe2\xa0\x80modecon: %s\n' "$MODE_CON"
                exit 0 ;;
            28)
                # Same as 25 but with PAD hardcoded to 30 (not 80 - 12).
                # If the art is still flush right with a smaller pad, that
                # tells us Claude Code is doing its own right-alignment.
                SPACER=$(printf '\xe2\xa0\x80%*s' 30 '')
                printf "%s  .----.\n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s  \`----'\n" \
                    "$SPACER" "$SPACER" "$SPACER" "$SPACER"
                exit 0 ;;
            29)
                # Same as 25 but with PAD hardcoded to 120. If the art stays
                # flush right like level 25, Claude Code truncates. If it
                # overflows or wraps, Claude Code renders from column 0.
                SPACER=$(printf '\xe2\xa0\x80%*s' 120 '')
                printf "%s  .----.\n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s  \`----'\n" \
                    "$SPACER" "$SPACER" "$SPACER" "$SPACER"
                exit 0 ;;
            30)
                # Real deal: use mode con for width, render the blob art
                # right-aligned with a sensible margin, include the name
                # line below. No ANSI (silently stripped anyway).
                COLS=$(cmd //c "mode con" 2>/dev/null \
                    | grep -i column | tr -d '\r' \
                    | awk '{print $NF}')
                case "$COLS" in ''|*[!0-9]*) COLS=120 ;; esac
                # Art bounding box = 10 chars wide; leave 4 col right margin
                ART_W=10
                MARGIN=4
                PAD=$(( COLS - ART_W - MARGIN ))
                [ "$PAD" -lt 1 ] && PAD=1
                SPACER=$(printf '\xe2\xa0\x80%*s' "$PAD" '')
                printf "%s  .----.  \n%s( \xe2\x9c\xa6  \xe2\x9c\xa6 )\n%s(      )\n%s  \`----'  \n%s Biscuit\n" \
                    "$SPACER" "$SPACER" "$SPACER" "$SPACER" "$SPACER"
                exit 0 ;;
        esac
    # ─── Normal Windows fallback ────────────────────────────────────────────
    if [ -n "$FRESH_REACTION" ]; then
        # Strip any non-ASCII so the renderer doesn't reject the whole line.
        BUBBLE=$(printf '%s' "$FRESH_REACTION" | LC_ALL=C tr -cd '\11\40-\176')
        printf '%s: (%s)\n' "$NAME" "$BUBBLE"
    else
        printf '%s: ()\n' "$NAME"
    fi
    exit 0
fi

SPECIES=$(jq -r '.species // ""' "$STATE" 2>/dev/null)
HAT=$(jq -r '.hat // "none"' "$STATE" 2>/dev/null)
RARITY=$(jq -r '.rarity // "common"' "$STATE" 2>/dev/null)
# eye is written to status.json by writeStatusState (v2+); fall back to "°"
E=$(jq -r '.eye // "°"' "$STATE" 2>/dev/null)

cat > /dev/null  # drain stdin

# ─── Animation: frame from timestamp ─────────────────────────────────────────
# Original sequence: [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0] with 500ms ticks
# Since refreshInterval=1s, each call = 2 ticks. We use seconds as index.
SEQ=(0 0 0 0 1 0 0 0 -1 0 0 2 0 0 0)
SEQ_LEN=${#SEQ[@]}
NOW=$(date +%s)
FRAME_IDX=$(( NOW % SEQ_LEN ))
FRAME=${SEQ[$FRAME_IDX]}

BLINK=0
if [ "$FRAME" -eq -1 ]; then
    BLINK=1
    FRAME=0
fi

# ─── Rarity color (pC4 = dark theme, the default) ────────────────────────────
NC=$'\033[0m'
case "$RARITY" in
  common)    C=$'\033[38;2;153;153;153m' ;;
  uncommon)  C=$'\033[38;2;78;186;101m'  ;;
  rare)      C=$'\033[38;2;177;185;249m' ;;
  epic)      C=$'\033[38;2;175;135;255m' ;;
  legendary) C=$'\033[38;2;255;193;7m'   ;;
  *)         C=$'\033[0m' ;;
esac

B=$'\xe2\xa0\x80'  # Braille Blank U+2800

# ─── Terminal width ──────────────────────────────────────────────────────────
COLS=0
PID=$$
for _ in 1 2 3 4 5; do
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
    [ -z "$PID" ] || [ "$PID" = "1" ] && break
    PTY=$(readlink "/proc/${PID}/fd/0" 2>/dev/null)
    if [ -c "$PTY" ] 2>/dev/null; then
        COLS=$(stty size < "$PTY" 2>/dev/null | awk '{print $2}')
        [ "${COLS:-0}" -gt 40 ] 2>/dev/null && break
    fi
done
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=${COLUMNS:-0}
# Git Bash on Windows: /proc fd walking above doesn't work, but tput does.
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=$(tput cols 2>/dev/null || echo 0)
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=125

# ─── Species art: 3 frames each (F0, F1, F2) ────────────────────────────────
# Each frame = 4 lines (L1..L4). Selected by $FRAME.
case "$SPECIES" in
  duck)
    case $FRAME in
      0) L1="   __";      L2=" <(${E} )___"; L3="  (  ._>";   L4="   \`--'" ;;
      1) L1="   __";      L2=" <(${E} )___"; L3="  (  ._>";   L4="   \`--'~" ;;
      2) L1="   __";      L2=" <(${E} )___"; L3="  (  .__>";  L4="   \`--'" ;;
    esac ;;
  goose)
    case $FRAME in
      0) L1="  (${E}>";    L2="   ||";       L3=" _(__)_";   L4="  ^^^^" ;;
      1) L1=" (${E}>";     L2="   ||";       L3=" _(__)_";   L4="  ^^^^" ;;
      2) L1="  (${E}>>";   L2="   ||";       L3=" _(__)_";   L4="  ^^^^" ;;
    esac ;;
  blob)
    case $FRAME in
      0) L1=" .----.";    L2="( ${E}  ${E} )"; L3="(      )";  L4=" \`----'" ;;
      1) L1=".------.";   L2="( ${E}  ${E} )"; L3="(       )"; L4="\`------'" ;;
      2) L1="  .--.";     L2=" (${E}  ${E})";  L3=" (    )";   L4="  \`--'" ;;
    esac ;;
  cat)
    case $FRAME in
      0) L1=" /\\_/\\";   L2="( ${E}   ${E})"; L3="(  ω  )";  L4="(\")_(\")" ;;
      1) L1=" /\\_/\\";   L2="( ${E}   ${E})"; L3="(  ω  )";  L4="(\")_(\")~" ;;
      2) L1=" /\\-/\\";   L2="( ${E}   ${E})"; L3="(  ω  )";  L4="(\")_(\")" ;;
    esac ;;
  dragon)
    case $FRAME in
      0) L1="/^\\  /^\\"; L2="< ${E}  ${E} >"; L3="(  ~~  )"; L4=" \`-vvvv-'" ;;
      1) L1="/^\\  /^\\"; L2="< ${E}  ${E} >"; L3="(      )"; L4=" \`-vvvv-'" ;;
      2) L1="/^\\  /^\\"; L2="< ${E}  ${E} >"; L3="(  ~~  )"; L4=" \`-vvvv-'" ;;
    esac ;;
  octopus)
    case $FRAME in
      0) L1=" .----.";   L2="( ${E}  ${E} )"; L3="(______)"; L4="/\\/\\/\\/\\" ;;
      1) L1=" .----.";   L2="( ${E}  ${E} )"; L3="(______)"; L4="\\/\\/\\/\\/" ;;
      2) L1=" .----.";   L2="( ${E}  ${E} )"; L3="(______)"; L4="/\\/\\/\\/\\" ;;
    esac ;;
  owl)
    case $FRAME in
      0) L1=" /\\  /\\";  L2="((${E})(${E}))"; L3="(  ><  )"; L4=" \`----'" ;;
      1) L1=" /\\  /\\";  L2="((${E})(${E}))"; L3="(  ><  )"; L4=" .----." ;;
      2) L1=" /\\  /\\";  L2="((${E})(-))";    L3="(  ><  )"; L4=" \`----'" ;;
    esac ;;
  penguin)
    case $FRAME in
      0) L1=" .---.";    L2=" (${E}>${E})";   L3="/(   )\\"; L4=" \`---'" ;;
      1) L1=" .---.";    L2=" (${E}>${E})";   L3="|(   )|";  L4=" \`---'" ;;
      2) L1=" .---.";    L2=" (${E}>${E})";   L3="/(   )\\"; L4=" \`---'" ;;
    esac ;;
  turtle)
    case $FRAME in
      0) L1=" _,--._";   L2="( ${E}  ${E} )"; L3="[______]"; L4="\`\`    \`\`" ;;
      1) L1=" _,--._";   L2="( ${E}  ${E} )"; L3="[______]"; L4=" \`\`  \`\`" ;;
      2) L1=" _,--._";   L2="( ${E}  ${E} )"; L3="[======]"; L4="\`\`    \`\`" ;;
    esac ;;
  snail)
    case $FRAME in
      0) L1="${E}   .--."; L2="\\  ( @ )";   L3=" \\_\`--'"; L4="~~~~~~~" ;;
      1) L1=" ${E}  .--."; L2="|  ( @ )";   L3=" \\_\`--'"; L4="~~~~~~~" ;;
      2) L1="${E}   .--."; L2="\\  ( @ )";   L3=" \\_\`--'"; L4=" ~~~~~~" ;;
    esac ;;
  ghost)
    case $FRAME in
      0) L1=" .----.";   L2="/ ${E}  ${E} \\"; L3="|      |"; L4="~\`~\`\`~\`~" ;;
      1) L1=" .----.";   L2="/ ${E}  ${E} \\"; L3="|      |"; L4="\`~\`~~\`~\`" ;;
      2) L1=" .----.";   L2="/ ${E}  ${E} \\"; L3="|      |"; L4="~~\`~~\`~~" ;;
    esac ;;
  axolotl)
    case $FRAME in
      0) L1="}~(____)~{"; L2="}~(${E}..${E})~{"; L3=" (.--.)";  L4=" (_/\\_)" ;;
      1) L1="~}(____){~"; L2="~}(${E}..${E}){~"; L3=" (.--.)";  L4=" (_/\\_)" ;;
      2) L1="}~(____)~{"; L2="}~(${E}..${E})~{"; L3=" ( -- )";  L4=" ~_/\\_~" ;;
    esac ;;
  capybara)
    case $FRAME in
      0) L1="n______n";  L2="( ${E}    ${E} )"; L3="(  oo  )"; L4="\`------'" ;;
      1) L1="n______n";  L2="( ${E}    ${E} )"; L3="(  Oo  )"; L4="\`------'" ;;
      2) L1="u______n";  L2="( ${E}    ${E} )"; L3="(  oo  )"; L4="\`------'" ;;
    esac ;;
  cactus)
    case $FRAME in
      0) L1="n ____ n";  L2="||${E}  ${E}||"; L3="|_|  |_|"; L4="  |  |" ;;
      1) L1="  ____";    L2="n|${E}  ${E}|n"; L3="|_|  |_|"; L4="  |  |" ;;
      2) L1="n ____ n";  L2="||${E}  ${E}||"; L3="|_|  |_|"; L4="  |  |" ;;
    esac ;;
  robot)
    case $FRAME in
      0) L1=" .[||].";   L2="[ ${E}  ${E} ]"; L3="[ ==== ]"; L4="\`------'" ;;
      1) L1=" .[||].";   L2="[ ${E}  ${E} ]"; L3="[ -==- ]"; L4="\`------'" ;;
      2) L1=" .[||].";   L2="[ ${E}  ${E} ]"; L3="[ ==== ]"; L4="\`------'" ;;
    esac ;;
  rabbit)
    case $FRAME in
      0) L1=" (\\__/)";  L2="( ${E}  ${E} )"; L3="=(  ..  )="; L4="(\")__(\")" ;;
      1) L1=" (|__/)";   L2="( ${E}  ${E} )"; L3="=(  ..  )="; L4="(\")__(\")" ;;
      2) L1=" (\\__/)";  L2="( ${E}  ${E} )"; L3="=( .  . )="; L4="(\")__(\")" ;;
    esac ;;
  mushroom)
    case $FRAME in
      0) L1="-o-OO-o-";  L2="(________)";  L3="  |${E}${E}|"; L4="  |__|" ;;
      1) L1="-O-oo-O-";  L2="(________)";  L3="  |${E}${E}|"; L4="  |__|" ;;
      2) L1="-o-OO-o-";  L2="(________)";  L3="  |${E}${E}|"; L4="  |__|" ;;
    esac ;;
  chonk)
    case $FRAME in
      0) L1="/\\    /\\"; L2="( ${E}    ${E} )"; L3="(  ..  )"; L4="\`------'" ;;
      1) L1="/\\    /|";  L2="( ${E}    ${E} )"; L3="(  ..  )"; L4="\`------'" ;;
      2) L1="/\\    /\\"; L2="( ${E}    ${E} )"; L3="(  ..  )"; L4="\`------'~" ;;
    esac ;;
  *)
    L1="(${E}${E})"; L2="(  )"; L3=""; L4="" ;;
esac

# ─── Blink: replace eyes with "-" ────────────────────────────────────────────
if [ "$BLINK" -eq 1 ]; then
    L1="${L1//${E}/-}"
    L2="${L2//${E}/-}"
    L3="${L3//${E}/-}"
    L4="${L4//${E}/-}"
fi

# ─── Hat ──────────────────────────────────────────────────────────────────────
HAT_LINE=""
case "$HAT" in
  crown)     HAT_LINE=" \\^^^/" ;;
  tophat)    HAT_LINE=" [___]" ;;
  propeller) HAT_LINE="  -+-" ;;
  halo)      HAT_LINE=" (   )" ;;
  wizard)    HAT_LINE="  /^\\" ;;
  beanie)    HAT_LINE=" (___)" ;;
  tinyduck)  HAT_LINE="  ,>" ;;
esac

# ─── Reaction bubble ─────────────────────────────────────────────────────────
# FRESH_REACTION was computed above (shared with the Windows fallback).
BUBBLE=""
[ -n "$FRESH_REACTION" ] && BUBBLE="\"${FRESH_REACTION}\""

# ─── Build art lines ─────────────────────────────────────────────────────────
ART_LINES=("$L1" "$L2" "$L3")
[ -n "$L4" ] && ART_LINES+=("$L4")

# Center the name
NAME_LEN=${#NAME}
ART_CENTER=4
NAME_PAD=$(( ART_CENTER - NAME_LEN / 2 ))
[ "$NAME_PAD" -lt 0 ] && NAME_PAD=0
NAME_LINE="$(printf '%*s%s' "$NAME_PAD" '' "$NAME")"

# ─── Build all art lines ──────────────────────────────────────────────────────
DIM=$'\033[2;3m'

ALL_LINES=()
ALL_COLORS=()
[ -n "$HAT_LINE" ] && { ALL_LINES+=("$HAT_LINE"); ALL_COLORS+=("$C"); }
for line in "${ART_LINES[@]}"; do
    ALL_LINES+=("$line"); ALL_COLORS+=("$C")
done
ALL_LINES+=("$NAME_LINE"); ALL_COLORS+=("$DIM")

ART_W=14
ART_COUNT=${#ALL_LINES[@]}

# ─── Speech bubble (left of art, word-wrapped) ──────────────────────────────
# Strip the quotes we added earlier
BUBBLE_TEXT=""
if [ -n "$BUBBLE" ]; then
    BUBBLE_TEXT="${BUBBLE%\"}"
    BUBBLE_TEXT="${BUBBLE_TEXT#\"}"
fi

# ─── Word-wrap bubble text ────────────────────────────────────────────────────
INNER_W=28
TEXT_LINES=()
if [ -n "$BUBBLE_TEXT" ]; then
    WORDS=($BUBBLE_TEXT)
    CUR_LINE=""
    for word in "${WORDS[@]}"; do
        if [ -z "$CUR_LINE" ]; then
            CUR_LINE="$word"
        elif [ $(( ${#CUR_LINE} + 1 + ${#word} )) -le $INNER_W ]; then
            CUR_LINE="$CUR_LINE $word"
        else
            TEXT_LINES+=("$CUR_LINE")
            CUR_LINE="$word"
        fi
    done
    [ -n "$CUR_LINE" ] && TEXT_LINES+=("$CUR_LINE")
fi

TEXT_COUNT=${#TEXT_LINES[@]}

# Build box as plain strings (no ANSI). Color applied at output time.
# Box display width = INNER_W + 4:  "| " + text(INNER_W) + " |"
BOX_W=$(( INNER_W + 4 ))
BUBBLE_LINES=()
BUBBLE_TYPES=()  # "border" or "text" — determines coloring
if [ $TEXT_COUNT -gt 0 ]; then
    # Top border
    BORDER=$(printf '%*s' "$(( BOX_W - 2 ))" '' | tr ' ' '-')
    BUBBLE_LINES+=(".${BORDER}.")
    BUBBLE_TYPES+=("border")
    # Text rows: "| text padded |"
    for tl in "${TEXT_LINES[@]}"; do
        tpad=$(( INNER_W - ${#tl} ))
        [ "$tpad" -lt 0 ] && tpad=0
        padding=$(printf '%*s' "$tpad" '')
        BUBBLE_LINES+=("| ${tl}${padding} |")
        BUBBLE_TYPES+=("text")
    done
    # Bottom border
    BUBBLE_LINES+=("\`${BORDER}'")
    BUBBLE_TYPES+=("border")
fi

BUBBLE_COUNT=${#BUBBLE_LINES[@]}

# ─── Right-align with bubble box to the left ─────────────────────────────────
GAP=2
if [ $BUBBLE_COUNT -gt 0 ]; then
    TOTAL_W=$(( BOX_W + GAP + ART_W ))
else
    TOTAL_W=$ART_W
fi
MARGIN=8
PAD=$(( COLS - TOTAL_W - MARGIN ))
[ "$PAD" -lt 0 ] && PAD=0

SPACER=$(printf "${B}%${PAD}s" "")
GAP_STR=$(printf '%*s' "$GAP" '')

# Vertically center bubble box on the art
BUBBLE_START=0
if [ $BUBBLE_COUNT -gt 0 ] && [ $BUBBLE_COUNT -lt $ART_COUNT ]; then
    BUBBLE_START=$(( (ART_COUNT - BUBBLE_COUNT) / 2 ))
fi

# ─── Find the connector line (middle text line → points to buddy's mouth) ─────
# The connector goes on the middle text row of the bubble
CONNECTOR_BI=-1
if [ $BUBBLE_COUNT -gt 2 ]; then
    # text rows are indices 1..(BUBBLE_COUNT-2), pick the middle one
    FIRST_TEXT=1
    LAST_TEXT=$(( BUBBLE_COUNT - 2 ))
    CONNECTOR_BI=$(( (FIRST_TEXT + LAST_TEXT) / 2 ))
fi

# ─── Output: merged bubble box + connector + art per line ─────────────────────
for (( i=0; i<ART_COUNT; i++ )); do
    art_part="${ALL_COLORS[$i]}${ALL_LINES[$i]}${NC}"

    if [ $BUBBLE_COUNT -gt 0 ]; then
        bi=$(( i - BUBBLE_START ))
        if [ $bi -ge 0 ] && [ $bi -lt $BUBBLE_COUNT ]; then
            bline="${BUBBLE_LINES[$bi]}"
            btype="${BUBBLE_TYPES[$bi]}"

            # Connector: "-- " on the middle text line, spaces otherwise
            if [ $bi -eq $CONNECTOR_BI ]; then
                gap="${C}--${NC} "
            else
                gap="   "
            fi

            if [ "$btype" = "border" ]; then
                echo "${SPACER}${C}${bline}${NC}${gap}${art_part}"
            else
                pipe_l="${bline:0:1}"
                pipe_r="${bline: -1}"
                inner="${bline:1:$(( ${#bline} - 2 ))}"
                echo "${SPACER}${C}${pipe_l}${NC}${DIM}${inner}${NC}${C}${pipe_r}${NC}${gap}${art_part}"
            fi
        else
            empty=$(printf '%*s' "$BOX_W" '')
            echo "${SPACER}${empty}   ${art_part}"
        fi
    else
        echo "${SPACER}${art_part}"
    fi
done

exit 0
