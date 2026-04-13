#!/usr/bin/env bash
# claude-buddy popup manager -- create/destroy tmux popup overlay
#
# Usage:
#   popup-manager.sh start   -- open buddy popup (bottom-right corner)
#   popup-manager.sh stop    -- close buddy popup
#   popup-manager.sh status  -- check if popup is running
#
# Called by SessionStart/SessionEnd hooks.
#
# Architecture: The "start" command runs a blocking reopen loop.
# tmux display-popup blocks until the popup closes. When ESC closes
# the popup (hardcoded tmux behavior), we forward ESC to CC and
# reopen. The loop exits when: stop flag is set, or CC pane dies.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUDDY_DIR="$HOME/.claude-buddy"

# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"

STOP_FLAG="$BUDDY_DIR/popup-stop.$SID"
REOPEN_PID_FILE="$BUDDY_DIR/popup-reopen-pid.$SID"
STATE_FILE="$BUDDY_DIR/status.json"

POPUP_W=12       # minimum / fallback
ART_W=12         # updated dynamically by compute_art_width
BUBBLE_EXTRA=3 # border top + border bottom + connector line
BORDER_EXTRA=0 # +2 on tmux < 3.3 (popup has a border)
REACTION_TTL=20 # seconds
REACTION_FILE="$BUDDY_DIR/reaction.$SID.json"
RESIZE_FLAG="$BUDDY_DIR/popup-resize.$SID"
CONFIG_FILE="$BUDDY_DIR/config.json"
LEFT_BUBBLE_W=22 # bubble box width in left mode (including frame chars)

# Read config early (needed for BASE_H calculation)
BUBBLE_POSITION="top"
SHOW_RARITY=1
if [ -f "$CONFIG_FILE" ]; then
  _bp=$(jq -r '.bubblePosition // "top"' "$CONFIG_FILE" 2>/dev/null || echo "top")
  case "$_bp" in top|left) BUBBLE_POSITION="$_bp" ;; esac
  _sr=$(jq -r 'if .showRarity == false then "false" else "true" end' "$CONFIG_FILE" 2>/dev/null || echo "true")
  [ "$_sr" = "false" ] && SHOW_RARITY=0
fi

BASE_H=8      # art(4) + blank(1) + name(1) + rarity(1) + padding(1)
[ "$SHOW_RARITY" -eq 0 ] && BASE_H=7

# ─── Helpers ─────────────────────────────────────────────────────────────────

is_tmux() {
  [ -n "${TMUX:-}" ]
}

tmux_version_ok() {
  local ver
  ver=$(tmux -V 2>/dev/null | grep -oE '[0-9]+\.[0-9a-z]+' | head -1)
  [ -z "$ver" ] && return 1
  local major minor
  major="${ver%%.*}"
  minor="${ver#*.}"
  minor="${minor%%[a-z]*}"
  [ "$major" -gt 3 ] 2>/dev/null && return 0
  [ "$major" -eq 3 ] && [ "$minor" -ge 2 ] 2>/dev/null && return 0
  return 1
}

# tmux 3.4+ supports -B (borderless), -e (env), and -x R/-y S positioning
tmux_has_borderless() {
  local ver
  ver=$(tmux -V 2>/dev/null | grep -oE '[0-9]+\.[0-9a-z]+' | head -1)
  [ -z "$ver" ] && return 1
  local major minor
  major="${ver%%.*}"
  minor="${ver#*.}"
  minor="${minor%%[a-z]*}"
  [ "$major" -gt 3 ] 2>/dev/null && return 0
  [ "$major" -eq 3 ] && [ "$minor" -ge 4 ] 2>/dev/null && return 0
  return 1
}

cc_pane_alive() {
  tmux list-panes -a -F '#{pane_id}' 2>/dev/null | grep -qF "$1"
}

# Compute popup width from buddy data (widest of: art, name, stars+rarity)
compute_art_width() {
  [ -f "$STATE_FILE" ] || return
  local name rarity
  name=$(jq -r '.name // ""' "$STATE_FILE" 2>/dev/null)
  rarity=$(jq -r '.rarity // "common"' "$STATE_FILE" 2>/dev/null)
  local w=10  # minimum art width
  # Name length
  [ ${#name} -gt "$w" ] && w=${#name}
  # Stars + rarity line (only if enabled)
  if [ "$SHOW_RARITY" -eq 1 ]; then
    local stars_w=$(( 6 + ${#rarity} ))
    [ "$stars_w" -gt "$w" ] && w=$stars_w
  fi
  # Add 2 for padding
  w=$(( w + 2 ))
  POPUP_W=$w
  ART_W=$w
}

# Compute popup dimensions based on reaction state and bubble position
# Sets COMPUTED_W and COMPUTED_H
compute_dimensions() {
  compute_art_width
  local h=$BASE_H
  local w=$POPUP_W
  h=$(( h + BORDER_EXTRA ))
  w=$(( w + BORDER_EXTRA ))

  # Account for hat (adds 1 art row beyond the 4 in BASE_H)
  local art_rows=4
  if [ -f "$STATE_FILE" ]; then
    local _hat
    _hat=$(jq -r '.hat // "none"' "$STATE_FILE" 2>/dev/null || echo "none")
    if [ "$_hat" != "none" ]; then
      h=$(( h + 1 ))
      art_rows=5
    fi
  fi

  local fresh=0
  if [ -f "$STATE_FILE" ]; then
    local reaction
    reaction=$(jq -r '.reaction // ""' "$STATE_FILE" 2>/dev/null || true)
    if [ -n "$reaction" ] && [ "$reaction" != "null" ]; then
      if [ -f "$REACTION_FILE" ]; then
        local ts now age
        ts=$(jq -r '.timestamp // 0' "$REACTION_FILE" 2>/dev/null || echo 0)
        if [ "$ts" != "0" ]; then
          now=$(date +%s)
          age=$(( now - ts / 1000 ))
          [ "$age" -lt "$REACTION_TTL" ] && fresh=1
        fi
      fi
      if [ "$fresh" -eq 1 ]; then
        if [ "$BUBBLE_POSITION" = "top" ]; then
          # Top mode: bubble adds rows above the art
          local bubble_w=$(( POPUP_W - BORDER_EXTRA - 5 ))
          [ "$bubble_w" -lt 20 ] && bubble_w=20
          # Widen popup if bubble needs more room than art
          local needed_w=$(( bubble_w + 5 + BORDER_EXTRA ))
          [ "$needed_w" -gt "$w" ] && w=$needed_w
          local len=${#reaction}
          local lines=$(( (len + bubble_w - 1) / bubble_w ))
          [ "$lines" -lt 1 ] && lines=1
          h=$(( h + lines + BUBBLE_EXTRA ))
        else
          # Left mode: dynamic bubble width to fit text within art height
          local max_text_lines=$(( art_rows - 2 ))  # subtract top/bottom borders
          [ "$max_text_lines" -lt 1 ] && max_text_lines=1
          local len=${#reaction}
          local left_inner=$(( (len + max_text_lines - 1) / max_text_lines + 5 ))
          [ "$left_inner" -lt 10 ] && left_inner=10
          [ "$left_inner" -gt 50 ] && left_inner=50
          local left_box=$(( left_inner + 4 ))  # "| " + text + " |"
          w=$(( w + left_box + 2 ))  # +2 for connector gap
        fi
      fi
    fi
  fi
  COMPUTED_W=$w
  COMPUTED_H=$h
}

is_reopen_running() {
  [ -f "$REOPEN_PID_FILE" ] || return 1
  local pid
  pid=$(cat "$REOPEN_PID_FILE")
  kill -0 "$pid" 2>/dev/null
}

# ─── Start ───────────────────────────────────────────────────────────────────

start_popup() {
  is_tmux || { echo "Not in tmux" >&2; return 1; }
  tmux_version_ok || { echo "tmux >= 3.2 required for popup" >&2; return 1; }

  # Kill stale reopen loop for THIS session (e.g., CC restarted in same pane)
  if [ -f "$REOPEN_PID_FILE" ]; then
    local old_pid
    old_pid=$(cat "$REOPEN_PID_FILE" 2>/dev/null)
    if [ -n "$old_pid" ]; then
      kill "$old_pid" 2>/dev/null || true
    fi
    rm -f "$REOPEN_PID_FILE"
    tmux display-popup -C 2>/dev/null || true
    sleep 0.2
  fi

  # Clean up orphaned per-session files (from crashed sessions)
  for pidfile in "$BUDDY_DIR"/popup-reopen-pid.*; do
    [ -f "$pidfile" ] || continue
    local orphan_sid="${pidfile##*.}"
    local orphan_pane="%${orphan_sid}"
    if ! cc_pane_alive "$orphan_pane"; then
      local orphan_pid
      orphan_pid=$(cat "$pidfile" 2>/dev/null)
      [ -n "$orphan_pid" ] && kill "$orphan_pid" 2>/dev/null || true
      rm -f "$pidfile" "$BUDDY_DIR/popup-stop.$orphan_sid" "$BUDDY_DIR/popup-resize.$orphan_sid"
      rm -f "$BUDDY_DIR/popup-env.$orphan_sid" "$BUDDY_DIR/popup-scroll.$orphan_sid"
      rm -f "$BUDDY_DIR/reaction.$orphan_sid.json" "$BUDDY_DIR/.last_reaction.$orphan_sid" "$BUDDY_DIR/.last_comment.$orphan_sid"
    fi
  done

  mkdir -p "$BUDDY_DIR"
  rm -f "$STOP_FLAG" "$RESIZE_FLAG"

  # tmux < 3.4 popups have a border (+2 rows, +2 cols); 3.4+ supports -B borderless
  if ! tmux_has_borderless; then
    BORDER_EXTRA=2
    POPUP_W=$(( POPUP_W + 2 ))
  fi

  # Capture CC's pane ID before creating the popup
  local cc_pane
  cc_pane=$(tmux display-message -p '#{pane_id}')

  # Run the reopen loop in background so the hook returns immediately.
  # CRITICAL: Redirect stdio to /dev/null so the subshell doesn't inherit
  # the parent's stdout pipe. CC's hook executor waits for ALL stdio writers
  # to close before resolving -- without this redirect, the hook hangs forever
  # because the long-lived subshell keeps the pipe open.
  (
    # Write the subshell PID. $BASHPID gives the subshell's PID on bash 4+.
    # On macOS bash 3.2, $BASHPID doesn't exist, so we use sh -c 'echo $PPID'
    # which prints the PID of the parent (this subshell) from a child process.
    echo "${BASHPID:-$(sh -c 'echo $PPID')}" > "$REOPEN_PID_FILE"

    while true; do
      # Check stop conditions before (re)opening
      [ -f "$STOP_FLAG" ] && break
      cc_pane_alive "$cc_pane" || break

      compute_dimensions

      # Build popup args. tmux 3.4+ supports -B (borderless), -x R/-y S,
      # and -e (env passing). On 3.2-3.3, we fall back to absolute positioning
      # and pass env vars via a file.
      local popup_args=()
      if tmux_has_borderless; then
        local tw th
        tw=$(tmux display-message -p '#{window_width}' 2>/dev/null || echo 80)
        th=$(tmux display-message -p '#{window_height}' 2>/dev/null || echo 24)
        popup_args+=(-B -s 'bg=default')
        popup_args+=(-x $(( tw - COMPUTED_W )) -y $(( th )))
        popup_args+=(-e "CC_PANE=$cc_pane" -e "BUDDY_DIR=$BUDDY_DIR" -e "BUDDY_SID=$SID")
        popup_args+=(-e "POPUP_INNER_W=$COMPUTED_W" -e "POPUP_INNER_H=$COMPUTED_H")
        popup_args+=(-e "POPUP_ART_W=$ART_W")
      else
        # Fallback: position at bottom-right using absolute coords
        local tw th
        tw=$(tmux display-message -p '#{window_width}' 2>/dev/null || echo 80)
        th=$(tmux display-message -p '#{window_height}' 2>/dev/null || echo 24)
        popup_args+=(-x $(( tw - COMPUTED_W )) -y $(( th - COMPUTED_H )))
        # Inner dimensions = outer - 2 (border takes 1 on each side)
        local inner_w=$(( COMPUTED_W - 2 ))
        local inner_h=$(( COMPUTED_H - 2 ))
        # Write env vars to file (tmux 3.2-3.3 lack -e flag)
        cat > "$BUDDY_DIR/popup-env.$SID" <<ENVEOF
CC_PANE=$cc_pane
BUDDY_DIR=$BUDDY_DIR
BUDDY_SID=$SID
POPUP_INNER_W=$inner_w
POPUP_INNER_H=$inner_h
POPUP_ART_W=$ART_W
ENVEOF
      fi

      # display-popup blocks until popup closes (ESC or command exit)
      # -E = close when command exits
      tmux display-popup \
        "${popup_args[@]}" \
        -w "$COMPUTED_W" -h "$COMPUTED_H" \
        -E \
        "$SCRIPT_DIR/buddy-popup.sh" "$SID" \
        2>/dev/null || true

      # Popup closed. Check why.
      [ -f "$STOP_FLAG" ] && break
      cc_pane_alive "$cc_pane" || break

      # Scroll flag = F12 pressed, enter copy-mode and wait
      if [ -f "$BUDDY_DIR/popup-scroll.$SID" ]; then
        rm -f "$BUDDY_DIR/popup-scroll.$SID"
        tmux copy-mode -t "$cc_pane" 2>/dev/null || true
        # Wait until copy-mode ends before reopening popup
        while tmux display-message -t "$cc_pane" -p '#{pane_in_mode}' 2>/dev/null | grep -q '^1$'; do
          [ -f "$STOP_FLAG" ] && break 2
          cc_pane_alive "$cc_pane" || break 2
          sleep 0.3
        done
      # Resize flag = render loop requested a resize, not an ESC press
      elif [ -f "$RESIZE_FLAG" ]; then
        rm -f "$RESIZE_FLAG"
      else
        # ESC closed the popup -- forward ESC to CC
        tmux send-keys -t "$cc_pane" Escape 2>/dev/null || true
      fi
      sleep 0.1
    done

    rm -f "$REOPEN_PID_FILE"
  ) </dev/null &>/dev/null &
  disown

  return 0
}

# ─── Stop ────────────────────────────────────────────────────────────────────

stop_popup() {
  mkdir -p "$BUDDY_DIR"
  # Set stop flag so reopen loop exits
  touch "$STOP_FLAG"
  # Close any open popup on the current client
  tmux display-popup -C 2>/dev/null || true
  # Kill reopen loop if still running
  if [ -f "$REOPEN_PID_FILE" ]; then
    local pid
    pid=$(cat "$REOPEN_PID_FILE")
    kill "$pid" 2>/dev/null || true
    rm -f "$REOPEN_PID_FILE"
  fi
  # Clean up per-session files
  rm -f "$BUDDY_DIR/popup-stop.$SID" "$BUDDY_DIR/popup-resize.$SID"
  rm -f "$BUDDY_DIR/popup-env.$SID" "$BUDDY_DIR/popup-scroll.$SID"
  rm -f "$BUDDY_DIR/reaction.$SID.json" "$BUDDY_DIR/.last_reaction.$SID" "$BUDDY_DIR/.last_comment.$SID"
}

# ─── Status ──────────────────────────────────────────────────────────────────

popup_status() {
  if is_reopen_running; then
    echo "running"
  else
    echo "stopped"
  fi
}

# ─── Dispatch ────────────────────────────────────────────────────────────────

case "${1:-status}" in
  start)  start_popup ;;
  stop)   stop_popup ;;
  status) popup_status ;;
  *)      echo "Usage: $0 {start|stop|status}" >&2; exit 1 ;;
esac
