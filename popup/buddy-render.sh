#!/usr/bin/env bash
# claude-buddy popup render loop -- draws buddy in the tmux popup
#
# Runs as BACKGROUND process inside the popup. Stdin is /dev/null.
# Only writes to stdout (popup display).
#
# Env vars:
#   BUDDY_DIR -- ~/.claude-buddy

set -uo pipefail

# Inner popup dimensions from env (set by popup-manager).
# POPUP_INNER_W/H account for border on tmux < 3.4.
PANE_W="${POPUP_INNER_W:-$(tput cols 2>/dev/null || echo 24)}"
PANE_H="${POPUP_INNER_H:-$(tput lines 2>/dev/null || echo 14)}"

BUDDY_STATE_DIR="${BUDDY_DIR:-$HOME/.claude-buddy}"
# Session ID from env (set by popup-manager via -e or env file)
_SID="${BUDDY_SID:-${CC_PANE#%}}"
_SID="${_SID:-default}"

STATE="$BUDDY_STATE_DIR/status.json"
COMPANION="$BUDDY_STATE_DIR/companion.json"
REACTION_FILE="$BUDDY_STATE_DIR/reaction.$_SID.json"
RESIZE_FLAG="$BUDDY_STATE_DIR/popup-resize.$_SID"
CONFIG_FILE="$BUDDY_STATE_DIR/config.json"
REACTION_TTL=0

# Bubble style: "classic" (pipes/dashes like status line) or "round" (parens/tildes)
BUBBLE_STYLE="classic"
BUBBLE_POSITION="top"
SHOW_RARITY=1
if [ -f "$CONFIG_FILE" ]; then
  _bs=$(jq -r '.bubbleStyle // "classic"' "$CONFIG_FILE" 2>/dev/null || echo "classic")
  case "$_bs" in classic|round) BUBBLE_STYLE="$_bs" ;; esac
  _bp=$(jq -r '.bubblePosition // "top"' "$CONFIG_FILE" 2>/dev/null || echo "top")
  case "$_bp" in top|left) BUBBLE_POSITION="$_bp" ;; esac
  _sr=$(jq -r 'if .showRarity == false then "false" else "true" end' "$CONFIG_FILE" 2>/dev/null || echo "true")
  [ "$_sr" = "false" ] && SHOW_RARITY=0
  _ttl=$(jq -r '.reactionTTL // 0' "$CONFIG_FILE" 2>/dev/null || echo 0)
  case "$_ttl" in ''|*[!0-9]*) ;; *) REACTION_TTL="$_ttl" ;; esac
fi

# Track whether we're currently showing a reaction bubble.
# Initialized after reaction_fresh() is defined (see below main loop).
SHOWING_REACTION=0

SEQ=(0 0 0 0 1 0 0 0 -1 0 0 2 0 0 0)
SEQ_LEN=${#SEQ[@]}
TICK=0

NC=$'\033[0m'
DIM=$'\033[2;3m'
BOLD=$'\033[1m'

rarity_color() {
  case "$1" in
    common)    echo -n $'\033[38;2;153;153;153m' ;;
    uncommon)  echo -n $'\033[38;2;78;186;101m'  ;;
    rare)      echo -n $'\033[38;2;177;185;249m' ;;
    epic)      echo -n $'\033[38;2;175;135;255m' ;;
    legendary) echo -n $'\033[38;2;255;193;7m'   ;;
    *)         echo -n "$NC" ;;
  esac
}

rarity_stars() {
  case "$1" in
    common)    echo -n "★☆☆☆☆" ;;
    uncommon)  echo -n "★★☆☆☆" ;;
    rare)      echo -n "★★★☆☆" ;;
    epic)      echo -n "★★★★☆" ;;
    legendary) echo -n "★★★★★" ;;
  esac
}

# ─── Check reaction TTL ─────────────────────────────────────────────────────

reaction_fresh() {
  [ -f "$REACTION_FILE" ] || return 1
  # TTL=0 means permanent (always fresh)
  [ "$REACTION_TTL" -eq 0 ] && return 0
  local ts now age
  ts=$(jq -r '.timestamp // 0' "$REACTION_FILE" 2>/dev/null || echo 0)
  [ "$ts" = "0" ] && return 1
  # timestamp is in milliseconds (JS Date.now())
  now=$(date +%s)
  age=$(( now - ts / 1000 ))
  [ "$age" -lt "$REACTION_TTL" ]
}

# ─── Species art ─────────────────────────────────────────────────────────────

get_art() {
  local species="$1" frame="$2" E="$3"
  case "$species" in
    duck)
      case $frame in
        0) L1="   __";      L2=" <(${E} )___"; L3="  (  ._>";   L4="   \`--'" ;;
        1) L1="   __";      L2=" <(${E} )___"; L3="  (  ._>";   L4="   \`--'~" ;;
        2) L1="   __";      L2=" <(${E} )___"; L3="  (  .__>";  L4="   \`--'" ;;
      esac ;;
    goose)
      case $frame in
        0) L1="  (${E}>";    L2="   ||";       L3=" _(__)_";   L4="  ^^^^" ;;
        1) L1=" (${E}>";     L2="   ||";       L3=" _(__)_";   L4="  ^^^^" ;;
        2) L1="  (${E}>>";   L2="   ||";       L3=" _(__)_";   L4="  ^^^^" ;;
      esac ;;
    blob)
      case $frame in
        0) L1=" .----.";    L2="( ${E}  ${E} )"; L3="(      )";  L4=" \`----'" ;;
        1) L1=".------.";   L2="( ${E}  ${E} )"; L3="(       )"; L4="\`------'" ;;
        2) L1="  .--.";     L2=" (${E}  ${E})";  L3=" (    )";   L4="  \`--'" ;;
      esac ;;
    cat)
      case $frame in
        0) L1=" /\\_/\\";   L2="( ${E}   ${E})"; L3="(  w  )";  L4="(\")_(\")" ;;
        1) L1=" /\\_/\\";   L2="( ${E}   ${E})"; L3="(  w  )";  L4="(\")_(\")~" ;;
        2) L1=" /\\-/\\";   L2="( ${E}   ${E})"; L3="(  w  )";  L4="(\")_(\")" ;;
      esac ;;
    dragon)
      case $frame in
        0) L1="/^\\  /^\\"; L2="< ${E}  ${E} >"; L3="(  ~~  )"; L4=" \`-vvvv-'" ;;
        1) L1="/^\\  /^\\"; L2="< ${E}  ${E} >"; L3="(      )"; L4=" \`-vvvv-'" ;;
        2) L1="/^\\  /^\\"; L2="< ${E}  ${E} >"; L3="(  ~~  )"; L4=" \`-vvvv-'" ;;
      esac ;;
    octopus)
      case $frame in
        0) L1=" .----.";   L2="( ${E}  ${E} )"; L3="(______)"; L4="/\\/\\/\\/\\" ;;
        1) L1=" .----.";   L2="( ${E}  ${E} )"; L3="(______)"; L4="\\/\\/\\/\\/" ;;
        2) L1=" .----.";   L2="( ${E}  ${E} )"; L3="(______)"; L4="/\\/\\/\\/\\" ;;
      esac ;;
    owl)
      case $frame in
        0) L1=" /\\  /\\";  L2="((${E})(${E}))"; L3="(  ><  )"; L4=" \`----'" ;;
        1) L1=" /\\  /\\";  L2="((${E})(${E}))"; L3="(  ><  )"; L4=" .----." ;;
        2) L1=" /\\  /\\";  L2="((${E})(-))";    L3="(  ><  )"; L4=" \`----'" ;;
      esac ;;
    penguin)
      case $frame in
        0) L1=" .---.";    L2=" (${E}>${E})";   L3="/(   )\\"; L4=" \`---'" ;;
        1) L1=" .---.";    L2=" (${E}>${E})";   L3="|(   )|";  L4=" \`---'" ;;
        2) L1=" .---.";    L2=" (${E}>${E})";   L3="/(   )\\"; L4=" \`---'" ;;
      esac ;;
    turtle)
      case $frame in
        0) L1=" _,--._";   L2="( ${E}  ${E} )"; L3="[______]"; L4="\`\`    \`\`" ;;
        1) L1=" _,--._";   L2="( ${E}  ${E} )"; L3="[______]"; L4=" \`\`  \`\`" ;;
        2) L1=" _,--._";   L2="( ${E}  ${E} )"; L3="[======]"; L4="\`\`    \`\`" ;;
      esac ;;
    snail)
      case $frame in
        0) L1="${E}   .--."; L2="\\  ( @ )";   L3=" \\_\`--'"; L4="~~~~~~~" ;;
        1) L1=" ${E}  .--."; L2="|  ( @ )";   L3=" \\_\`--'"; L4="~~~~~~~" ;;
        2) L1="${E}   .--."; L2="\\  ( @ )";   L3=" \\_\`--'"; L4=" ~~~~~~" ;;
      esac ;;
    ghost)
      case $frame in
        0) L1=" .----.";   L2="/ ${E}  ${E} \\"; L3="|      |"; L4="~\`~\`\`~\`~" ;;
        1) L1=" .----.";   L2="/ ${E}  ${E} \\"; L3="|      |"; L4="\`~\`~~\`~\`" ;;
        2) L1=" .----.";   L2="/ ${E}  ${E} \\"; L3="|      |"; L4="~~\`~~\`~~" ;;
      esac ;;
    axolotl)
      case $frame in
        0) L1="}~(____)~{"; L2="}~(${E}..${E})~{"; L3=" (.--.)";  L4=" (_/\\_)" ;;
        1) L1="~}(____){~"; L2="~}(${E}..${E}){~"; L3=" (.--.)";  L4=" (_/\\_)" ;;
        2) L1="}~(____)~{"; L2="}~(${E}..${E})~{"; L3=" ( -- )";  L4=" ~_/\\_~" ;;
      esac ;;
    capybara)
      case $frame in
        0) L1="n______n";  L2="( ${E}    ${E} )"; L3="(  oo  )"; L4="\`------'" ;;
        1) L1="n______n";  L2="( ${E}    ${E} )"; L3="(  Oo  )"; L4="\`------'" ;;
        2) L1="u______n";  L2="( ${E}    ${E} )"; L3="(  oo  )"; L4="\`------'" ;;
      esac ;;
    cactus)
      case $frame in
        0) L1="n ____ n";  L2="||${E}  ${E}||"; L3="|_|  |_|"; L4="  |  |" ;;
        1) L1="  ____";    L2="n|${E}  ${E}|n"; L3="|_|  |_|"; L4="  |  |" ;;
        2) L1="n ____ n";  L2="||${E}  ${E}||"; L3="|_|  |_|"; L4="  |  |" ;;
      esac ;;
    robot)
      case $frame in
        0) L1=" .[||].";   L2="[ ${E}  ${E} ]"; L3="[ ==== ]"; L4="\`------'" ;;
        1) L1=" .[||].";   L2="[ ${E}  ${E} ]"; L3="[ -==- ]"; L4="\`------'" ;;
        2) L1=" .[||].";   L2="[ ${E}  ${E} ]"; L3="[ ==== ]"; L4="\`------'" ;;
      esac ;;
    rabbit)
      case $frame in
        0) L1=" (\\__/)";  L2="( ${E}  ${E} )"; L3="=(  ..  )="; L4="(\")__(\")" ;;
        1) L1=" (|__/)";   L2="( ${E}  ${E} )"; L3="=(  ..  )="; L4="(\")__(\")" ;;
        2) L1=" (\\__/)";  L2="( ${E}  ${E} )"; L3="=( .  . )="; L4="(\")__(\")" ;;
      esac ;;
    mushroom)
      case $frame in
        0) L1="-o-OO-o-";  L2="(________)";  L3="  |${E}${E}|"; L4="  |__|" ;;
        1) L1="-O-oo-O-";  L2="(________)";  L3="  |${E}${E}|"; L4="  |__|" ;;
        2) L1="-o-OO-o-";  L2="(________)";  L3="  |${E}${E}|"; L4="  |__|" ;;
      esac ;;
    chonk)
      case $frame in
        0) L1="/\\    /\\"; L2="( ${E}    ${E} )"; L3="(  ..  )"; L4="\`------'" ;;
        1) L1="/\\    /|";  L2="( ${E}    ${E} )"; L3="(  ..  )"; L4="\`------'" ;;
        2) L1="/\\    /\\"; L2="( ${E}    ${E} )"; L3="(  ..  )"; L4="\`------'~" ;;
      esac ;;
    *)
      L1="(${E}${E})"; L2="(  )"; L3=""; L4="" ;;
  esac
}

# ─── Center text, pad to full width ──────────────────────────────────────────

center_pad() {
  local text="$1" width="$2"
  local len=${#text}
  local lpad=$(( (width - len) / 2 ))
  [ "$lpad" -lt 0 ] && lpad=0
  local rpad=$(( width - len - lpad ))
  [ "$rpad" -lt 0 ] && rpad=0
  printf '%*s%s%*s' "$lpad" '' "$text" "$rpad" ''
}

# Center a line within a block of known max_width, then center the block in pane
center_block_line() {
  local text="$1" max_w="$2" pane="$3"
  local len=${#text}
  # Left-pad within the block to center each line relative to block width
  local inner_lpad=$(( (max_w - len) / 2 ))
  [ "$inner_lpad" -lt 0 ] && inner_lpad=0
  local inner_rpad=$(( max_w - len - inner_lpad ))
  [ "$inner_rpad" -lt 0 ] && inner_rpad=0
  local block_line
  block_line=$(printf '%*s%s%*s' "$inner_lpad" '' "$text" "$inner_rpad" '')
  # Now center the block within the pane
  center_pad "$block_line" "$pane"
}

# ─── Word wrap ───────────────────────────────────────────────────────────────

word_wrap() {
  local text="$1" max_w="$2"
  local -a words=($text)
  local line=""
  WRAPPED_LINES=()
  for word in "${words[@]}"; do
    if [ -z "$line" ]; then
      line="$word"
    elif [ $(( ${#line} + 1 + ${#word} )) -le "$max_w" ]; then
      line="$line $word"
    else
      WRAPPED_LINES+=("$line")
      line="$word"
    fi
  done
  [ -n "$line" ] && WRAPPED_LINES+=("$line")
}

# ─── Render one frame ────────────────────────────────────────────────────────
# Uses cursor positioning (\033[row;1H) for each line.
# No clear screen, no newlines -- overwrites in place for flicker-free updates.

render() {
  local frame_idx="$1"
  local pane_w="$PANE_W"

  [ -f "$STATE" ] || return
  local name species hat rarity reaction eye
  name=$(jq -r '.name // ""' "$STATE" 2>/dev/null)
  [ -z "$name" ] && return
  species=$(jq -r '.species // ""' "$STATE" 2>/dev/null)
  hat=$(jq -r '.hat // "none"' "$STATE" 2>/dev/null)
  rarity=$(jq -r '.rarity // "common"' "$STATE" 2>/dev/null)
  reaction=$(jq -r '.reaction // ""' "$STATE" 2>/dev/null)
  # Enforce TTL -- clear stale reactions
  if [ -n "$reaction" ] && [ "$reaction" != "null" ] && ! reaction_fresh; then
    reaction=""
  fi
  [ -f "$COMPANION" ] && eye=$(jq -r '.bones.eye // "o"' "$COMPANION" 2>/dev/null) || eye="o"

  local C
  C=$(rarity_color "$rarity")

  local frame=$frame_idx blink=0
  if [ "$frame" -eq -1 ]; then
    blink=1
    frame=0
  fi

  L1="" L2="" L3="" L4=""
  get_art "$species" "$frame" "$eye"

  if [ "$blink" -eq 1 ]; then
    L1="${L1//$eye/-}"; L2="${L2//$eye/-}"
    L3="${L3//$eye/-}"; L4="${L4//$eye/-}"
  fi

  # Build all output lines into an array, then write in one shot
  local -a OUT=()
  local row=1

  # Bubble style chars
  local bchar lside rside
  if [ "$BUBBLE_STYLE" = "round" ]; then
    bchar='~'; lside='('; rside=')'
  else
    bchar='-'; lside='|'; rside='|'
  fi

  # Collect art lines (hat + species art)
  local -a ART_LINES=()
  local hat_line=""
  case "$hat" in
    crown)     hat_line="\\^^^/" ;;
    tophat)    hat_line="[___]" ;;
    propeller) hat_line="-+-" ;;
    halo)      hat_line="(   )" ;;
    wizard)    hat_line="/^\\" ;;
    beanie)    hat_line="(___)" ;;
    tinyduck)  hat_line=",>" ;;
  esac
  [ -n "$hat_line" ] && ART_LINES+=("$hat_line")
  for line in "$L1" "$L2" "$L3" "$L4"; do
    [ -n "$line" ] && ART_LINES+=("$line")
  done

  # Find widest art line for block centering
  local art_max_w=0
  for al in "${ART_LINES[@]}"; do
    [ ${#al} -gt "$art_max_w" ] && art_max_w=${#al}
  done

  # Determine if we have a reaction to show
  local has_reaction=0
  local -a BUBBLE_LINES_ARR=()
  local -a BUBBLE_TYPES=()
  if [ -n "$reaction" ] && [ "$reaction" != "null" ]; then
    has_reaction=1
  fi

  if [ "$has_reaction" -eq 1 ] && [ "$BUBBLE_POSITION" = "left" ]; then
    # ─── Left bubble: art stays in fixed right section, bubble on left ──
    local art_w="${POPUP_ART_W:-$pane_w}"  # art area = base popup width
    local bubble_area=$(( pane_w - art_w ))  # 0 when no extra width

    if [ "$bubble_area" -gt 6 ]; then
      local inner_w=$(( bubble_area - 6 ))  # lside(1)+space(1)+text+space(1)+rside(1) + gap(2)
      [ "$inner_w" -lt 4 ] && inner_w=4
      local box_w=$(( inner_w + 4 ))  # "| " + text + " |"
      local gap=1

      word_wrap "$reaction" "$inner_w"

      # Build bubble box lines
      local border
      border=$(printf '%*s' "$((inner_w + 2))" '' | tr ' ' "$bchar")
      BUBBLE_LINES_ARR+=(".${border}.")
      BUBBLE_TYPES+=("border")
      for tl in "${WRAPPED_LINES[@]}"; do
        local tpad=$(( inner_w - ${#tl} ))
        [ "$tpad" -lt 0 ] && tpad=0
        local padding
        padding=$(printf '%*s' "$tpad" '')
        BUBBLE_LINES_ARR+=("${lside} ${tl}${padding} ${rside}")
        BUBBLE_TYPES+=("text")
      done
      BUBBLE_LINES_ARR+=("\`${border}'")
      BUBBLE_TYPES+=("border")

      local bubble_count=${#BUBBLE_LINES_ARR[@]}
      local art_count=${#ART_LINES[@]}

      # Find connector line (middle text row)
      local connector_bi=-1
      if [ "$bubble_count" -gt 2 ]; then
        connector_bi=$(( (1 + bubble_count - 2) / 2 ))
      fi

      # Vertically center bubble on art
      local bubble_start=0
      if [ "$bubble_count" -lt "$art_count" ]; then
        bubble_start=$(( (art_count - bubble_count) / 2 ))
      fi

      local total_rows=$art_count
      [ "$((bubble_start + bubble_count))" -gt "$total_rows" ] && total_rows=$((bubble_start + bubble_count))
      local gap_str
      for (( i=0; i<total_rows; i++ )); do
        local bi=$(( i - bubble_start ))
        local art_part=""
        if [ "$i" -lt "$art_count" ]; then
          art_part="${ART_LINES[$i]}"
        fi

        if [ "$bi" -ge 0 ] && [ "$bi" -lt "$bubble_count" ]; then
          local bline="${BUBBLE_LINES_ARR[$bi]}"
          local btype="${BUBBLE_TYPES[$bi]}"
          # Pad bubble line to box_w
          local bline_padded
          bline_padded=$(printf '%-*s' "$box_w" "$bline")
          if [ "$bi" -eq "$connector_bi" ]; then
            gap_str="${C}--${NC}"
          else
            gap_str="  "
          fi
          if [ "$btype" = "border" ]; then
            OUT+=("$(printf '\033[%d;1H' "$row")${DIM}${bline_padded}${NC}${gap_str}${C}$(center_block_line "$art_part" "$art_max_w" "$art_w")${NC}")
          else
            OUT+=("$(printf '\033[%d;1H' "$row")${DIM}${bline_padded}${NC}${gap_str}${C}$(center_block_line "$art_part" "$art_max_w" "$art_w")${NC}")
          fi
        else
          local empty
          empty=$(printf '%*s' "$((box_w + 2))" '')
          OUT+=("$(printf '\033[%d;1H' "$row")${empty}${C}$(center_block_line "$art_part" "$art_max_w" "$art_w")${NC}")
        fi
        row=$((row + 1))
      done
    else
      # Bubble area too narrow, fall back to art-only
      for line in "${ART_LINES[@]}"; do
        OUT+=("$(printf '\033[%d;1H%s%s%s' "$row" "$C" "$(center_pad "$line" "$pane_w")" "$NC")")
        row=$((row + 1))
      done
    fi

  else
    # ─── Top bubble (or no bubble): original layout ─────────────────────
    local bubble_w=$(( pane_w - 5 ))
    [ "$bubble_w" -lt 8 ] && bubble_w=8

    if [ "$has_reaction" -eq 1 ]; then
      word_wrap "$reaction" "$bubble_w"
      if [ ${#WRAPPED_LINES[@]} -gt 0 ]; then
        local border
        border=$(printf '%*s' "$((bubble_w + 2))" '' | tr ' ' "$bchar")
        OUT+=("$(printf '\033[%d;1H%-*s' "$row" "$pane_w" " ${DIM}.${border}.${NC}")")
        row=$((row + 1))
        for tl in "${WRAPPED_LINES[@]}"; do
          local tpad=$(( bubble_w - ${#tl} ))
          [ "$tpad" -lt 0 ] && tpad=0
          local padding
          padding=$(printf '%*s' "$tpad" '')
          OUT+=("$(printf '\033[%d;1H%-*s' "$row" "$pane_w" " ${DIM}${lside}${NC} ${tl}${padding} ${DIM}${rside}${NC}")")
          row=$((row + 1))
        done
        OUT+=("$(printf '\033[%d;1H%-*s' "$row" "$pane_w" " ${DIM}\`${border}'${NC}")")
        row=$((row + 1))
        OUT+=("$(printf '\033[%d;1H%-*s' "$row" "$pane_w" "$(center_pad '\' "$pane_w")")")
        row=$((row + 1))
      fi
    fi

    # Art lines (hat + species) -- centered as a block
    for line in "${ART_LINES[@]}"; do
      OUT+=("$(printf '\033[%d;1H%s%s%s' "$row" "$C" "$(center_block_line "$line" "$art_max_w" "$pane_w")" "$NC")")
      row=$((row + 1))
    done
  fi

  # Width for name/stars: in left mode, keep them under the art area (right side)
  local label_w="$pane_w"
  local label_offset=""
  local art_base="${POPUP_ART_W:-$pane_w}"
  if [ "$BUBBLE_POSITION" = "left" ] && [ "$pane_w" -gt "$art_base" ]; then
    label_w=$art_base
    local offset_cols=$(( pane_w - art_base ))
    label_offset=$(printf '%*s' "$offset_cols" '')
  fi

  # Blank line
  OUT+=("$(printf '\033[%d;1H%*s' "$row" "$pane_w" '')")
  row=$((row + 1))

  # Name
  OUT+=("$(printf '\033[%d;1H%s%s%s%s' "$row" "$label_offset" "${BOLD}${C}" "$(center_pad "$name" "$label_w")" "$NC")")
  row=$((row + 1))

  # Stars + rarity (uses SHOW_RARITY from startup config)
  if [ "$SHOW_RARITY" -eq 1 ]; then
    local stars
    stars=$(rarity_stars "$rarity")
    OUT+=("$(printf '\033[%d;1H%s%s%s%s' "$row" "$label_offset" "$DIM" "$(center_pad "$stars $rarity" "$label_w")" "$NC")")
    row=$((row + 1))
  fi

  # Clear remaining rows
  while [ "$row" -le "$PANE_H" ]; do
    OUT+=("$(printf '\033[%d;1H%*s' "$row" "$pane_w" '')")
    row=$((row + 1))
  done

  # Write everything at once (minimize flicker)
  printf '%s' "${OUT[@]}"
}

# ─── Resize trigger ─────────────────────────────────────────────────────────
# When reaction state changes (appears/disappears), request a popup resize
# by writing a flag and killing the parent (perl forwarder). The reopen loop
# sees the flag and reopens with the new height without forwarding ESC.

request_resize() {
  touch "$RESIZE_FLAG"
  kill $PPID 2>/dev/null
  exit 0
}

# ─── Main loop ───────────────────────────────────────────────────────────────

# Initialize SHOWING_REACTION to match current state so we don't
# trigger a spurious resize on startup (which causes flicker loops).
if [ -f "$REACTION_FILE" ] && [ -f "$STATE" ]; then
  _init_reaction=$(jq -r '.reaction // ""' "$STATE" 2>/dev/null || true)
  if [ -n "$_init_reaction" ] && [ "$_init_reaction" != "null" ] && reaction_fresh; then
    SHOWING_REACTION=1
  fi
fi

# Initial clear
printf '\033[2J'

while true; do
  [ -f "$STATE" ] || { sleep 0.5; continue; }

  # Check if reaction state changed (need resize)
  HAS_REACTION=0
  if [ -f "$REACTION_FILE" ] && [ -f "$STATE" ]; then
    local_reaction=$(jq -r '.reaction // ""' "$STATE" 2>/dev/null || true)
    if [ -n "$local_reaction" ] && [ "$local_reaction" != "null" ] && reaction_fresh; then
      HAS_REACTION=1
    fi
  fi

  if [ "$HAS_REACTION" -ne "$SHOWING_REACTION" ]; then
    SHOWING_REACTION=$HAS_REACTION
    request_resize
  fi

  FRAME_IDX=${SEQ[$((TICK % SEQ_LEN))]}
  render "$FRAME_IDX"
  TICK=$((TICK + 1))
  sleep 0.5
done
