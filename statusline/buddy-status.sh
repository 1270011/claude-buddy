#!/usr/bin/env bash
# claude-buddy status line — animated, right-aligned multi-line companion
#
# Art rendering: the server (writeStatusState in server/state.ts) pre-bakes
# every frame with eye, hat overlay, and blink resolved, and writes them into
# status.json along with the frame-index sequence. This script is a dumb
# cycler — one jq call per tick picks the current frame body.
#
# BUDDY_FAKE_NOW env var: override wall clock for snapshot tests.
#
# Uses Braille Blank (U+2800) for padding — survives JS .trim()
#
# When running inside buddy-shell (the PTY wrapper), skip status line rendering
# so the buddy doesn't show up twice (once in status line, once in wrapper panel).
[ "$BUDDY_SHELL" = "1" ] && exit 0

# shellcheck source=../scripts/paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/paths.sh"

STATE="$BUDDY_STATE_DIR/status.json"
CONFIG_FILE="$BUDDY_STATE_DIR/config.json"
# Session ID: sanitized tmux pane number, or "default" outside tmux
SID="${TMUX_PANE#%}"
SID="${SID:-default}"

[ -f "$STATE" ] || exit 0

MUTED=$(jq -r '.muted // false' "$STATE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

NAME=$(jq -r '.name // ""' "$STATE" 2>/dev/null)
[ -z "$NAME" ] && exit 0

RARITY=$(jq -r '.rarity // "common"' "$STATE" 2>/dev/null)
SHINY=$(jq -r '.shiny // false' "$STATE" 2>/dev/null)
REACTION=$(jq -r '.reaction // ""' "$STATE" 2>/dev/null)
ACHIEVEMENT=$(jq -r '.achievement // ""' "$STATE" 2>/dev/null)
LEVEL=$(jq -r '.level // 1' "$STATE" 2>/dev/null)
MOOD=$(jq -r '.mood // "focused"' "$STATE" 2>/dev/null)
TITLE=$(jq -r '.title // ""' "$STATE" 2>/dev/null)
# Prestige tier + streak for the optional badge (default 0 on older status.json).
PRESTIGE=$(jq -r '.prestigeLevel // 0' "$STATE" 2>/dev/null)
STREAK=$(jq -r '.streak // 0' "$STATE" 2>/dev/null)
# Stats panel data: 5 values + peak/dump as a single TSV line. Empty when
# status.json predates the stats field (older server) — the panel is skipped.
STATS_TSV=$(jq -r '[.stats.DEBUGGING, .stats.PATIENCE, .stats.CHAOS, .stats.WISDOM, .stats.SNARK, .peak, .dump] | @tsv' "$STATE" 2>/dev/null)
# XP progress bar row + transient gain toast. Defaults to 0/null on older
# status.json so the row renders as an empty bar instead of erroring.
XP_PCT=$(jq -r '.xpPct // 0' "$STATE" 2>/dev/null)
XP_GAIN_TSV=$(jq -r '[(.lastXpGain.amount // 0), (.lastXpGain.at // 0)] | @tsv' "$STATE" 2>/dev/null)
# Celebration channel (game-feel §2): text + epoch-ms timestamp. Empty/0 on
# older status.json so the bubble falls back to the normal reaction.
CELEB_TSV=$(jq -r '[(.celebration.text // ""), (.celebration.at // 0)] | @tsv' "$STATE" 2>/dev/null)

CC_INPUT=$(cat)  # capture stdin JSON (model/context/rate-limit data)

# ─── Animation: pick current frame from server-rendered frames ──────────────
NOW=${BUDDY_FAKE_NOW:-$(date +%s)}

# Game-feel intensity (game-feel FR-E1) + celebration freshness, computed once
# here so they gate BOTH the frame flourish (just below) and the bubble toast
# (later). off suppresses celebrations entirely; subtle/full differ only in the
# toast's dwell time.
GAME_FEEL="subtle"
if [ -f "$CONFIG_FILE" ]; then
    _gf=$(jq -r '.gameFeel // "subtle"' "$CONFIG_FILE" 2>/dev/null || echo subtle)
    case "$_gf" in off|subtle|full) GAME_FEEL="$_gf" ;; esac
fi
_CELEB_FRESH=0
if [ "$GAME_FEEL" != "off" ]; then
    IFS=$'\t' read -r _CELEB_TEXT _CELEB_AT <<< "$CELEB_TSV"
    case "$_CELEB_AT" in ''|*[!0-9]*) _CELEB_AT=0 ;; esac
    if [ -n "$_CELEB_TEXT" ] && [ "$_CELEB_TEXT" != "null" ] && [ "$_CELEB_AT" -gt 0 ]; then
        _CELEB_TTL=10
        [ "$GAME_FEEL" = "subtle" ] && _CELEB_TTL=6
        _CELEB_AGE=$(( NOW - _CELEB_AT / 1000 ))
        [ "$_CELEB_AGE" -ge 0 ] && [ "$_CELEB_AGE" -le "$_CELEB_TTL" ] && _CELEB_FRESH=1
    fi
fi

# Frame source (game-feel FR-A3): while a celebration is fresh AND the server
# wrote a flourish set, animate the flourish; otherwise the neutral idle frames.
# Stale flourishFrames left in the file after the window are simply never picked,
# so the flourish self-reverts on the celebration's own TTL — no second write.
_HAS_FLOURISH=$(jq -r 'if ((.flourishFrames | type) == "array") and ((.flourishFrames | length) > 0) then 1 else 0 end' "$STATE" 2>/dev/null || echo 0)
FRAME_SRC_FRAMES='.frames'
FRAME_SRC_SEQ='.frameSequence'
if [ "$_CELEB_FRESH" = 1 ] && [ "$_HAS_FLOURISH" = 1 ]; then
    FRAME_SRC_FRAMES='.flourishFrames'
    FRAME_SRC_SEQ='.flourishSequence'
fi
FRAME_BODY=$(jq -r --argjson now "$NOW" "
    ${FRAME_SRC_SEQ}[\$now % (${FRAME_SRC_SEQ} | length)] as \$idx
    | ${FRAME_SRC_FRAMES}[\$idx] // \"\"
" "$STATE" 2>/dev/null)

# ─── Idle wander (movement design-movement §5a) ─────────────────────────────
# Per-tick horizontal (and, with hop, vertical) offsets picked from the server-
# baked sequences exactly like the frame index. Gated to gameFeel=full and
# parked while a celebration is fresh (the buddy comes home to talk). WANDER_ROW
# is read/plumbed here but stays 0 in the render until the hop mode (P4).
WANDER_OFF=0
WANDER_ROW=0
WANDER_ROW_MAX=0
if [ "$GAME_FEEL" = "full" ] && [ "$_CELEB_FRESH" != 1 ]; then
    WANDER_OFF=$(jq -r --argjson now "$NOW" '
        (.wanderSequence // []) as $w
        | if ($w|length) > 0 then ($w[$now % ($w|length)] // 0) else 0 end
    ' "$STATE" 2>/dev/null || echo 0)
    WANDER_ROW=$(jq -r --argjson now "$NOW" '
        (.wanderRowSequence // []) as $w
        | if ($w|length) > 0 then ($w[$now % ($w|length)] // 0) else 0 end
    ' "$STATE" 2>/dev/null || echo 0)
    # Max hop height across the whole sequence → constant headroom (P4); reading
    # the max (not the live row) keeps the block height fixed so it can't bob.
    WANDER_ROW_MAX=$(jq -r '(.wanderRowSequence // []) | max // 0' "$STATE" 2>/dev/null || echo 0)
    case "$WANDER_OFF" in ''|*[!0-9]*) WANDER_OFF=0 ;; esac
    case "$WANDER_ROW" in ''|*[!0-9]*) WANDER_ROW=0 ;; esac
    case "$WANDER_ROW_MAX" in ''|*[!0-9]*) WANDER_ROW_MAX=0 ;; esac
fi

# Fallback when status.json lacks .frames — e.g. server/bash version skew
# during install or while the MCP server hasn't rewritten the file yet. Keep
# the buddy visible in a degraded form instead of emitting an empty block.
if [ -z "$FRAME_BODY" ]; then
    FRAME_BODY=$'            \n    (°°)    \n    (  )    \n            \n            '
fi

ART_LINES=()
while IFS= read -r line; do
    ART_LINES+=("$line")
done <<< "$FRAME_BODY"

# ─── Rarity color (theme-aware) ─────────────────────────────────────────────
_THEME="dark"
if [ -f "$CONFIG_FILE" ]; then
    _cfg_theme=$(jq -r '.theme // "auto"' "$CONFIG_FILE" 2>/dev/null)
    [ "$_cfg_theme" = "light" ] && _THEME="light"
fi

NC=$'\033[0m'
case "$RARITY" in
  common)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;90;90;90m' || C=$'\033[38;2;153;153;153m' ;;
  uncommon)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;22;115;55m' || C=$'\033[38;2;78;186;101m' ;;
  rare)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;55;85;210m' || C=$'\033[38;2;177;185;249m' ;;
  epic)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;110;55;200m' || C=$'\033[38;2;175;135;255m' ;;
  legendary)
    [ "$_THEME" = "light" ] && C=$'\033[38;2;180;120;0m' || C=$'\033[38;2;255;193;7m' ;;
  *)         C=$'\033[0m' ;;
esac

B=$'\xe2\xa0\x80'  # Braille Blank U+2800

# ─── Rainbow colors for shiny buddies ────────────────────────────────────────
# Default ROYGBIV palette; overridden by rainbowColors in config.json
_hex_to_ansi() {
    local hex="${1#\#}"
    printf '\033[38;2;%d;%d;%dm' "$(( 16#${hex:0:2} ))" "$(( 16#${hex:2:2} ))" "$(( 16#${hex:4:2} ))"
}

RAINBOW=(
  $'\033[38;2;255;50;50m'
  $'\033[38;2;255;140;0m'
  $'\033[38;2;255;220;0m'
  $'\033[38;2;50;210;50m'
  $'\033[38;2;50;120;255m'
  $'\033[38;2;100;50;220m'
  $'\033[38;2;180;50;220m'
)

if [ -f "$CONFIG_FILE" ]; then
    _custom=$(jq -r '(.rainbowColors // []) | @tsv' "$CONFIG_FILE" 2>/dev/null)
    if [ -n "$_custom" ]; then
        RAINBOW=()
        for _hex in $_custom; do
            RAINBOW+=("$(_hex_to_ansi "$_hex")")
        done
    fi
fi

RAINBOW_LEN=${#RAINBOW[@]}
RAINBOW_OFFSET=$(( NOW % RAINBOW_LEN ))

# ─── Terminal width ──────────────────────────────────────────────────────────
COLS=0
PID=$$
for _ in 1 2 3 4 5; do
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
    [ -z "$PID" ] || [ "$PID" = "1" ] && break

    # Linux: read PTY device from /proc
    PTY=$(readlink "/proc/${PID}/fd/0" 2>/dev/null)
    if [ -c "$PTY" ] 2>/dev/null; then
        COLS=$(stty size < "$PTY" 2>/dev/null | awk '{print $2}')
        [ "${COLS:-0}" -gt 40 ] 2>/dev/null && break
    fi

    # macOS: /proc doesn't exist — get TTY name from process table
    TTY_NAME=$(ps -o tty= -p "$PID" 2>/dev/null | tr -d ' ')
    if [ -n "$TTY_NAME" ] && [ "$TTY_NAME" != "??" ] && [ "$TTY_NAME" != "?" ]; then
        TTY_DEV="/dev/$TTY_NAME"
        if [ -c "$TTY_DEV" ] 2>/dev/null; then
            COLS=$(stty size < "$TTY_DEV" 2>/dev/null | awk '{print $2}')
            [ "${COLS:-0}" -gt 40 ] 2>/dev/null && break
        fi
    fi
done
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=${COLUMNS:-0}
# Windows: /proc and TTY device detection don't exist; use PowerShell as fallback
if [ "${COLS:-0}" -lt 40 ] 2>/dev/null; then
    _ps_cols=$(powershell.exe -NoProfile -Command "(Get-Host).UI.RawUI.WindowSize.Width" 2>/dev/null | tr -d '\r\n')
    case "$_ps_cols" in ''|*[!0-9]*) ;; *) [ "$_ps_cols" -gt 40 ] 2>/dev/null && COLS=$_ps_cols ;; esac
fi
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=125

# ─── Reaction bubble (with TTL check) ────────────────────────────────────────
BUBBLE=""
if [ -n "$ACHIEVEMENT" ] && [ "$ACHIEVEMENT" != "null" ] && [ "$ACHIEVEMENT" != "" ]; then
    BUBBLE=$'\xf0\x9f\x8f\x86'" $ACHIEVEMENT"
fi
REACTION_FILE="$BUDDY_STATE_DIR/reaction.$SID.json"
REACTION_TTL=0
INNER_W=44
MARGIN=8
if [ -f "$CONFIG_FILE" ]; then
    _ttl=$(jq -r '.reactionTTL // 0' "$CONFIG_FILE" 2>/dev/null || echo 0)
    case "$_ttl" in ''|*[!0-9]*) ;; *) REACTION_TTL="$_ttl" ;; esac
    _bw=$(jq -r '.bubbleWidth // 44' "$CONFIG_FILE" 2>/dev/null || echo 44)
    case "$_bw" in ''|*[!0-9]*) ;; *) INNER_W="$_bw" ;; esac
    _bm=$(jq -r '.bubbleMargin // 8' "$CONFIG_FILE" 2>/dev/null || echo 8)
    case "$_bm" in ''|*[!0-9]*) ;; *) MARGIN="$_bm" ;; esac
fi

# ─── Idle wander clamp (movement design-movement §5b / §7.B / §7.C) ─────────
# The corridor is reclaimed from the right MARGIN; bash owns the clamp because
# only it knows MARGIN/COLS (the baked sequence carries raw offsets). §7.C
# resize robustness is automatic — MARGIN/COLS are recomputed every tick, so a
# shrink caps WANDER_OFF on the next tick and the buddy never clips. §7.B wide
# mode (flag wanderWide, full-gated) opens a left lane: it shifts the whole
# bubble+art block left by a CONSTANT WANDER_LEFT (folded into PAD below, once)
# so the corridor can span WANDER_RANGE_WIDE without the per-tick offset moving
# anything. WANDER_PAD is plain spaces (never trimmed). WANDER_MAX=0 ⇒ park.
WANDER_WIDE="false"
# wanderBubble (design-movement §5e): when true, the bubble+connector travel WITH
# the buddy as one rigid block (connector stays attached) instead of the bubble
# staying pinned + connector retracting. Pure render flag, read live here.
WANDER_BUBBLE="false"
if [ -f "$CONFIG_FILE" ]; then
    _ww=$(jq -r '.wanderWide // false' "$CONFIG_FILE" 2>/dev/null || echo false)
    [ "$_ww" = "true" ] && WANDER_WIDE="true"
    _wb=$(jq -r '.wanderBubble // false' "$CONFIG_FILE" 2>/dev/null || echo false)
    [ "$_wb" = "true" ] && WANDER_BUBBLE="true"
fi
WANDER_RANGE=6
WANDER_RANGE_WIDE=10
WANDER_SAFETY=2
WANDER_LEFT=0
WANDER_RANGE_EFF=$WANDER_RANGE
if [ "$GAME_FEEL" = "full" ] && [ "$WANDER_WIDE" = "true" ]; then
    WANDER_RANGE_EFF=$WANDER_RANGE_WIDE
    WANDER_LEFT=$(( WANDER_RANGE_WIDE - (MARGIN - WANDER_SAFETY) ))
    [ "$WANDER_LEFT" -lt 0 ] && WANDER_LEFT=0
fi
WANDER_MAX=$(( MARGIN + WANDER_LEFT - WANDER_SAFETY ))
[ "$WANDER_MAX" -lt 0 ] && WANDER_MAX=0
[ "$WANDER_MAX" -gt "$WANDER_RANGE_EFF" ] && WANDER_MAX=$WANDER_RANGE_EFF
[ "$WANDER_OFF" -gt "$WANDER_MAX" ] && WANDER_OFF=$WANDER_MAX
WANDER_PAD=$(printf '%*s' "$WANDER_OFF" '')
# Where the horizontal offset is inserted (§5e). Default: before the art only, so
# the buddy slides right and the bubble stays pinned (connector retracts). With
# wanderBubble on: before the whole bubble cluster, so bubble+connector+art
# translate together as one block (connector stays attached). Exactly one of
# these two pads is non-empty per tick; both modes shift the art's right edge by
# the same WANDER_OFF, so the corridor budget (WANDER_MAX) is unchanged.
if [ "$WANDER_BUBBLE" = "true" ]; then
    WANDER_PAD_BUBBLE="$WANDER_PAD"
    WANDER_PAD_ART=""
else
    WANDER_PAD_BUBBLE=""
    WANDER_PAD_ART="$WANDER_PAD"
fi

# Stats panel toggle (config.json, read live each tick → no restart on toggle).
SHOW_STATS="false"
if [ -f "$CONFIG_FILE" ]; then
    _ss=$(jq -r '.showStats // false' "$CONFIG_FILE" 2>/dev/null || echo false)
    [ "$_ss" = "true" ] && SHOW_STATS="true"
fi

# Prestige/streak badge toggle (config.json, read live each tick).
SHOW_PRESTIGE_BADGE="false"
if [ -f "$CONFIG_FILE" ]; then
    _spb=$(jq -r '.showPrestigeBadge // false' "$CONFIG_FILE" 2>/dev/null || echo false)
    [ "$_spb" = "true" ] && SHOW_PRESTIGE_BADGE="true"
fi

# Combined-mode toggle (config.json) — adds a model/context/usage/reset row
# to the stats column below. Independent of SHOW_STATS so it works whether
# or not the game-stats bars are on.
USE_COMBINED="false"
if [ -f "$CONFIG_FILE" ]; then
    _uc=$(jq -r '.useCombinedStatus // false' "$CONFIG_FILE" 2>/dev/null || echo false)
    [ "$_uc" = "true" ] && USE_COMBINED="true"
fi
# Celebration channel (game-feel §2): a transient message that overrides the
# normal reaction in the bubble while fresh. Freshness (_CELEB_FRESH) and the
# text (_CELEB_TEXT) were computed once up in the animation block, so the toast
# and the frame flourish share a single TTL evaluation.
CELEB_SHOWN=0
if [ "$_CELEB_FRESH" = 1 ]; then
    if [ -n "$BUBBLE" ]; then
        BUBBLE="$BUBBLE | ${_CELEB_TEXT}"
    else
        BUBBLE="${_CELEB_TEXT}"
    fi
    CELEB_SHOWN=1
fi

# Sticky bubble: status.json's .reaction is volatile — an incidental status
# refresh (writeStatusState with no reaction) clears it to "". The per-session
# reaction.$SID.json instead persists the LAST real reaction (hooks only ever
# write it with content), so fall back to it when the live field is empty. The
# bubble then stays until a new message replaces it. The TTL check below still
# uses this file's timestamp, so an opt-in reactionTTL>0 keeps expiring as before.
if { [ -z "$REACTION" ] || [ "$REACTION" = "null" ]; } && [ -f "$REACTION_FILE" ]; then
    REACTION=$(jq -r '.reaction // ""' "$REACTION_FILE" 2>/dev/null || echo "")
fi

if [ "$CELEB_SHOWN" -eq 0 ] && [ -n "$REACTION" ] && [ "$REACTION" != "null" ] && [ "$REACTION" != "" ]; then
    FRESH=0
    if [ "$REACTION_TTL" -eq 0 ]; then
        FRESH=1
    elif [ -f "$REACTION_FILE" ]; then
        TS=$(jq -r '.timestamp // 0' "$REACTION_FILE" 2>/dev/null || echo 0)
        if [ "$TS" != "0" ]; then
            # Use the top-level NOW (honors BUDDY_FAKE_NOW), consistent with the
            # celebration/xp age checks — don't re-fetch the real clock here.
            AGE=$(( NOW - TS / 1000 ))
            [ "$AGE" -lt "$REACTION_TTL" ] && FRESH=1
        fi
    fi
    if [ "$FRESH" -eq 1 ]; then
        if [ -n "$BUBBLE" ]; then
            BUBBLE="$BUBBLE | \"${REACTION}\""
        else
            BUBBLE="\"${REACTION}\""
        fi
    fi
fi

# ─── Build all art lines ──────────────────────────────────────────────────────
# ART_LINES comes from the pre-rendered frame (already includes hat + blink).
# Center the name under the art. Frames are 12 cols wide (see server/art.ts),
# so the geometric center sits at col 6.
NAME_WITH_LEVEL="$NAME"
[ "$LEVEL" -gt 1 ] 2>/dev/null && NAME_WITH_LEVEL="${NAME} [L${LEVEL}]"
case "$MOOD" in
    happy)       MOOD_EMOJI="" ;;
    focused)     MOOD_EMOJI="" ;;
    excited)     MOOD_EMOJI="" ;;
    tired)       MOOD_EMOJI="" ;;
    melancholy)  MOOD_EMOJI="" ;;
    chaotic)     MOOD_EMOJI="" ;;
    *)           MOOD_EMOJI="" ;;
esac
NAME_WITH_LEVEL="${NAME_WITH_LEVEL}${MOOD_EMOJI}"
NAME_LEN=${#NAME_WITH_LEVEL}
ART_CENTER=6
NAME_PAD=$(( ART_CENTER - NAME_LEN / 2 ))
[ "$NAME_PAD" -lt 0 ] && NAME_PAD=0
NAME_LINE="$(printf '%*s%s' "$NAME_PAD" '' "$NAME_WITH_LEVEL")"

DIM=$'\033[2;3m'

ALL_LINES=()
ALL_COLORS=()
_arc=0
for line in "${ART_LINES[@]}"; do
    ALL_LINES+=("$line")
    if [ "$SHINY" = "true" ]; then
        ALL_COLORS+=("${RAINBOW[$(( (_arc + RAINBOW_OFFSET) % RAINBOW_LEN ))]}")
    else
        ALL_COLORS+=("$C")
    fi
    _arc=$(( _arc + 1 ))
done
ALL_LINES+=("$NAME_LINE"); ALL_COLORS+=("$DIM")

# Prestige title (FR5.4): a dimmed, centered line under the name. Wrapped in
# guillemets to read as a title rather than a second name. Centered on the art
# the same way as the name — title names are short ASCII and fit within ART_W.
if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
    TITLE_TEXT="«${TITLE}»"
    TITLE_LEN=${#TITLE_TEXT}
    TITLE_PAD=$(( ART_CENTER - TITLE_LEN / 2 ))
    [ "$TITLE_PAD" -lt 0 ] && TITLE_PAD=0
    TITLE_LINE="$(printf '%*s%s' "$TITLE_PAD" '' "$TITLE_TEXT")"
    ALL_LINES+=("$TITLE_LINE"); ALL_COLORS+=("$DIM")
fi

# Prestige/streak badge (FR1.5): opt-in (default off), a compact centered line
# under the title. "P<tier>" appears once ascended; "🔥<streak>" while on a
# streak. Skipped entirely when both are zero, even if the badge is enabled, so
# the common case adds no clutter.
if [ "$SHOW_PRESTIGE_BADGE" = "true" ]; then
    case "$PRESTIGE" in ''|*[!0-9]*) PRESTIGE=0 ;; esac
    case "$STREAK" in ''|*[!0-9]*) STREAK=0 ;; esac
    BADGE=""
    [ "$PRESTIGE" -gt 0 ] && BADGE="P${PRESTIGE}"
    if [ "$STREAK" -gt 0 ]; then
        if [ -n "$BADGE" ]; then BADGE="$BADGE 🔥${STREAK}"; else BADGE="🔥${STREAK}"; fi
    fi
    if [ -n "$BADGE" ]; then
        BADGE_LEN=${#BADGE}
        BADGE_PAD=$(( ART_CENTER - BADGE_LEN / 2 ))
        [ "$BADGE_PAD" -lt 0 ] && BADGE_PAD=0
        BADGE_LINE="$(printf '%*s%s' "$BADGE_PAD" '' "$BADGE")"
        ALL_LINES+=("$BADGE_LINE"); ALL_COLORS+=("$DIM")
    fi
fi

ART_W=14
ART_COUNT=${#ALL_LINES[@]}

# ─── Stats panel (optional leftmost column) ─────────────────────────────────
# One line per stat: "LABEL(9) BAR(20) VAL(3) MARKER(2)" → 36 display cols.
# Bars are sliced from full 20-char templates (no multibyte tr, which is
# byte-oriented and would corrupt █/░). Peak gets ▲, dump gets ▼.
STATS_LINES=()
STATS_W=36
if [ "$SHOW_STATS" = "true" ] && [ -n "$STATS_TSV" ]; then
    IFS=$'\t' read -r _S_DBG _S_PAT _S_CHA _S_WIS _S_SNK _S_PEAK _S_DUMP <<< "$STATS_TSV"
    case "$_S_DBG" in
        ''|*[!0-9]*) ;;  # missing/non-numeric (old status.json) → skip panel
        *)
            _FULL_BAR='████████████████████'
            _EMPTY_BAR='░░░░░░░░░░░░░░░░░░░░'
            _GREEN=$'\033[32m'
            _RED=$'\033[31m'
            _SDIM=$'\033[2m'
            _stat_names=(DEBUGGING PATIENCE CHAOS WISDOM SNARK)
            _stat_vals=("$_S_DBG" "$_S_PAT" "$_S_CHA" "$_S_WIS" "$_S_SNK")
            _si=0
            for _sn in "${_stat_names[@]}"; do
                _val=${_stat_vals[$_si]}
                _si=$(( _si + 1 ))
                case "$_val" in ''|*[!0-9]*) _val=0 ;; esac
                _filled=$(( _val / 5 ))
                [ "$_filled" -gt 20 ] && _filled=20
                _bar="${_FULL_BAR:0:_filled}${_EMPTY_BAR:0:$(( 20 - _filled ))}"
                _label=$(printf '%-9s' "$_sn")
                _valstr=$(printf '%3d' "$_val")
                if [ "$_sn" = "$_S_PEAK" ]; then
                    _mark=" ${_GREEN}▲${NC}"
                elif [ "$_sn" = "$_S_DUMP" ]; then
                    _mark=" ${_RED}▼${NC}"
                else
                    _mark="  "
                fi
                STATS_LINES+=("${_SDIM}${_label}${NC} ${C}${_bar}${NC} ${_SDIM}${_valstr}${NC}${_mark}")
            done

            # XP progress row, below the 5 stat bars. Same bar style; shows a
            # transient blue "+N XP" toast for ~10s after an award.
            _BLUE=$'\033[34m'
            IFS=$'\t' read -r _XP_AMT _XP_AT <<< "$XP_GAIN_TSV"
            case "$_XP_AMT" in ''|*[!0-9]*) _XP_AMT=0 ;; esac
            case "$_XP_AT" in ''|*[!0-9]*) _XP_AT=0 ;; esac
            case "$XP_PCT" in ''|*[!0-9]*) XP_PCT=0 ;; esac
            _xp_filled=$(( XP_PCT / 5 ))
            [ "$_xp_filled" -gt 20 ] && _xp_filled=20
            [ "$_xp_filled" -lt 0 ] && _xp_filled=0
            _xp_bar="${_FULL_BAR:0:_xp_filled}${_EMPTY_BAR:0:$(( 20 - _xp_filled ))}"
            _xp_label=$(printf '%-9s' "Lv${LEVEL}")
            _xp_pctstr=$(printf '%3d%%' "$XP_PCT")
            # The transient toast adds width to this one row. Fold that width
            # into STATS_W (and backfill the rows already built) so every row in
            # the stats column shares one width — otherwise the toast pushes the
            # gap/bubble/art right on the Lv row alone and the buddy's name
            # "shifts" (and can truncate). Growing STATS_W keeps the art pinned:
            # its position is independent of STATS_W (the extra width is absorbed
            # from the mid-line slack), so the buddy stays put. Plain (ANSI-free)
            # widths: Lv row is label 9 + 1 + bar 20 + 1 + pct 4 = 35 cols; the
            # toast " +N XP" is 5 + len(N).
            _xp_toast=""
            _xp_row_w=35
            if [ "$_XP_AMT" -gt 0 ] && [ "$_XP_AT" -gt 0 ]; then
                _xp_at_s=$(( _XP_AT / 1000 ))
                _xp_age=$(( NOW - _xp_at_s ))
                if [ "$_xp_age" -ge 0 ] && [ "$_xp_age" -le 10 ]; then
                    _xp_toast=" ${_BLUE}+${_XP_AMT} XP${NC}"
                    _xp_row_w=$(( 35 + 5 + ${#_XP_AMT} ))
                fi
            fi
            if [ "$_xp_row_w" -gt "$STATS_W" ]; then
                _XP_EXTRA_PAD=$(printf '%*s' "$(( _xp_row_w - STATS_W ))" '')
                for _bi in "${!STATS_LINES[@]}"; do
                    STATS_LINES[$_bi]="${STATS_LINES[$_bi]}${_XP_EXTRA_PAD}"
                done
                STATS_W=$_xp_row_w
            fi
            # Pad the Lv row itself out to the (possibly grown) column width so it
            # matches the stat rows exactly (fixes a latent 1-col under-width).
            _XP_ROW_PAD=$(printf '%*s' "$(( STATS_W - _xp_row_w ))" '')
            STATS_LINES+=("${_SDIM}${_xp_label}${NC} ${C}${_xp_bar}${NC} ${_SDIM}${_xp_pctstr}${NC}${_xp_toast}${_XP_ROW_PAD}")
            ;;
    esac
fi

# Combined-mode metrics row: model/context/usage/reset, appended below the
# stat bars (or as the only row, when SHOW_STATS is off) — same column, so
# enabling this never pushes the bubble/art further right.
if [ "$USE_COMBINED" = "true" ]; then
    _METRICS_TSV=$(printf '%s' "$CC_INPUT" | jq -r '
        [
            (.model.display_name // ""),
            (.context_window.context_window_size // ""),
            (.context_window.used_percentage // ""),
            (.rate_limits.five_hour.used_percentage // ""),
            (.rate_limits.five_hour.resets_at // "")
        ] | join("")
    ' 2>/dev/null)
    if [ -n "$_METRICS_TSV" ]; then
        IFS=$'\x1f' read -r _M_MODEL _M_CTX_SIZE _M_CTX _M_USAGE _M_RESET <<< "$_METRICS_TSV"
        _SDIM=$'\033[2m'
        _METRICS_PARTS=()
        if [ -n "$_M_MODEL" ]; then
            _MODEL_TAG=$(printf '%s' "$_M_MODEL" | tr '[:upper:]' '[:lower:]')
            case "$_M_CTX_SIZE" in
                ''|*[!0-9]*) ;;
                *) [ "$_M_CTX_SIZE" -ge 1000000 ] && _MODEL_TAG="${_MODEL_TAG}[1m]" ;;
            esac
            _METRICS_PARTS+=("$_MODEL_TAG")
        fi
        case "$_M_CTX" in
            ''|*[!0-9.]*) ;;
            *) _METRICS_PARTS+=("ctx $(printf '%.0f' "$_M_CTX")%") ;;
        esac
        case "$_M_USAGE" in
            ''|*[!0-9.]*) ;;
            *) _METRICS_PARTS+=("usage $(printf '%.0f' "$_M_USAGE")%") ;;
        esac
        case "$_M_RESET" in
            ''|*[!0-9]*) ;;
            *)
                _SECS_LEFT=$(( _M_RESET - NOW ))
                if [ "$_SECS_LEFT" -gt 0 ]; then
                    _HRS=$(( _SECS_LEFT / 3600 ))
                    _MINS=$(( (_SECS_LEFT % 3600) / 60 ))
                    _METRICS_PARTS+=("reset ${_HRS}h${_MINS}m")
                fi
                ;;
        esac
        if [ ${#_METRICS_PARTS[@]} -gt 0 ]; then
            _METRICS_LINE="${_METRICS_PARTS[0]}"
            for (( _mi=1; _mi<${#_METRICS_PARTS[@]}; _mi++ )); do
                _METRICS_LINE="${_METRICS_LINE} · ${_METRICS_PARTS[$_mi]}"
            done
            # Model name/percentage lengths vary, so this row can exceed the
            # fixed STATS_W. Grow STATS_W to fit and backfill already-built
            # rows with the same extra padding — every row in the stats
            # column must share one width, or the gap/bubble/art columns
            # drift on whichever row is narrower.
            _METRICS_LEN=${#_METRICS_LINE}
            if [ "$_METRICS_LEN" -gt "$STATS_W" ]; then
                _EXTRA_PAD=$(printf '%*s' "$(( _METRICS_LEN - STATS_W ))" '')
                for _bi in "${!STATS_LINES[@]}"; do
                    STATS_LINES[$_bi]="${STATS_LINES[$_bi]}${_EXTRA_PAD}"
                done
                STATS_W=$_METRICS_LEN
            fi
            _METRICS_LINE=$(printf '%-*s' "$STATS_W" "$_METRICS_LINE")
            STATS_LINES+=("${_SDIM}${_METRICS_LINE}${NC}")
        fi
    fi
fi

STATS_COUNT=${#STATS_LINES[@]}

# ─── Speech bubble (left of art, word-wrapped) ──────────────────────────────
# Strip the quotes we added earlier
BUBBLE_TEXT=""
if [ -n "$BUBBLE" ]; then
    BUBBLE_TEXT="${BUBBLE%\"}"
    BUBBLE_TEXT="${BUBBLE_TEXT#\"}"
fi

# ─── Display width (emojis count as 2 cols) ──────────────────────────────────
# iconv turns the string into a stream of UTF-32LE codepoints, then awk sums
# widths. Rules mirror server/art.ts:displayWidth — the U+2600-U+27BF range
# is split by Emoji_Presentation (2) vs text-presentation (1), and VS16
# (U+FE0F) upgrades the previous narrow symbol to 2 cols (e.g. ❤ + VS16).
# The ambiguous codepoint list comes from emoji-widths.data, generated by
# scripts/gen-emoji-widths.ts from the Unicode Emoji_Presentation property.
EMOJI_WIDTHS_DATA="$(dirname "${BASH_SOURCE[0]}")/emoji-widths.data"
EMOJI_PRES_2600="$(grep -v '^#' "$EMOJI_WIDTHS_DATA" 2>/dev/null | tr -d '\n')"

dwidth() {
    printf '%s' "$1" | iconv -f UTF-8 -t UTF-32LE 2>/dev/null | od -An -tu4 | awk -v pres="$EMOJI_PRES_2600" '
    BEGIN {
        n = split(pres, arr)
        for (k = 1; k <= n; k++) wide[arr[k]] = 1
    }
    # Precondition: cp is neither a variation selector (65024-65039) nor ZWJ
    # (8205); the main loop filters those before calling in.
    function char_width(cp) {
        if (cp >= 126976) return 2
        if (cp >= 9728 && cp <= 10175) return (cp in wide) ? 2 : 1
        if (cp >= 9472 && cp <= 9631) return 1
        if (cp >= 12288 && cp <= 40959) return 2
        if (cp >= 65281 && cp <= 65376) return 2
        return 1
    }
    { for (i = 1; i <= NF; i++) {
        cp = $i + 0
        if (cp == 65039) {
            if (upgradable) { w += 1; upgradable = 0 }
            continue
        }
        if ((cp >= 65024 && cp <= 65038) || cp == 8205) { upgradable = 0; continue }
        cw = char_width(cp)
        w += cw
        upgradable = (cw == 1 && cp >= 9728 && cp <= 10175) ? 1 : 0
    } }
    END { print w+0 }'
}

# ─── Word-wrap bubble text ────────────────────────────────────────────────────
TEXT_LINES=()
if [ -n "$BUBBLE_TEXT" ]; then
    WORDS=($BUBBLE_TEXT)
    CUR_LINE=""
    CUR_W=0
    for word in "${WORDS[@]}"; do
        word_w=$(dwidth "$word")
        if [ -z "$CUR_LINE" ]; then
            CUR_LINE="$word"; CUR_W=$word_w
        elif [ $(( CUR_W + 1 + word_w )) -le $INNER_W ]; then
            CUR_LINE="$CUR_LINE $word"; CUR_W=$(( CUR_W + 1 + word_w ))
        else
            TEXT_LINES+=("$CUR_LINE")
            CUR_LINE="$word"; CUR_W=$word_w
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
        tpad=$(( INNER_W - $(dwidth "$tl") ))
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

# ─── Right-align: [stats] [bubble] art, columns to the left of the art ───────
# The bubble+art block stays flush against the right edge regardless of the
# stats panel — TOTAL_W/PAD below are unchanged by the stats column. Instead,
# the stats panel gets a small fixed left margin (flush to the terminal's
# left edge) and the padding that used to precede it is moved to sit between
# the stats panel and the bubble, so the bubble/art position never shifts.
GAP=2
STATS_GAP=2
STATS_LEFT_MARGIN=1
TOTAL_W=$ART_W
[ $BUBBLE_COUNT -gt 0 ] && TOTAL_W=$(( BOX_W + GAP + TOTAL_W ))
[ $STATS_COUNT -gt 0 ] && TOTAL_W=$(( STATS_W + STATS_GAP + TOTAL_W ))
# §7.B wide: reserve the left lane once, here — shifts the bubble+art block left
# by the constant WANDER_LEFT (0 unless wide). Offset-independent, so the bubble
# position is identical on every tick.
PAD=$(( COLS - TOTAL_W - MARGIN - WANDER_LEFT ))
[ "$PAD" -lt 0 ] && PAD=0

if [ $STATS_COUNT -gt 0 ]; then
    LEAD_PAD=$STATS_LEFT_MARGIN
    MID_PAD=$(( PAD - STATS_LEFT_MARGIN ))
    [ "$MID_PAD" -lt 0 ] && MID_PAD=0
else
    LEAD_PAD=$PAD
    MID_PAD=0
fi

# On Windows (Git Bash / MSYS2), Braille Blank (U+2800) renders as double-width,
# which doubles the spacer and pushes content off-screen. Use regular spaces instead.
# MID_SPACER sits mid-line (never trimmed), so it's always plain spaces — only
# the line-leading SPACER needs the non-trimmable Braille Blank.
case "$(uname -s)" in
    MINGW*|CYGWIN*|MSYS*) SPACER=$(printf '%*s' "$LEAD_PAD" '') ;;
    *)                     SPACER=$(printf "${B}%${LEAD_PAD}s" "") ;;
esac
MID_SPACER=$(printf '%*s' "$MID_PAD" '')
STATS_GAP_STR=$(printf '%*s' "$STATS_GAP" '')

# ─── Idle wander hop headroom (movement §7.A, flag wanderHop) ───────────────
# Reserve HOP_RESERVE blank rows above the art ONLY when the server baked a
# non-empty wanderRowSequence (hop on). Headroom = the sequence's max so it is
# constant across ticks — the block height never changes, so the bubble/stats
# (centered on the total height below) can't bob. Collapse to 0 if the block
# would blow the height budget (degrade, NFR7); WANDER_ROW resets so the
# connector logic and art position stay consistent with "no hop".
HOP_RESERVE=0
if [ "$WANDER_ROW_MAX" -gt 0 ]; then
    HOP_RESERVE=$WANDER_ROW_MAX
    HOP_CAP=2
    [ "$HOP_RESERVE" -gt "$HOP_CAP" ] && HOP_RESERVE=$HOP_CAP
    HOP_BUDGET=12
    if [ $(( ART_COUNT + HOP_RESERVE )) -gt "$HOP_BUDGET" ]; then
        HOP_RESERVE=0
        WANDER_ROW=0
    fi
fi
ART_COUNT_TOTAL=$(( ART_COUNT + HOP_RESERVE ))
# Art's top row within the block: WANDER_ROW=0 rests on the floor (below the
# headroom); WANDER_ROW=HOP_RESERVE touches the ceiling.
ART_TOP=$(( HOP_RESERVE - WANDER_ROW ))
[ "$ART_TOP" -lt 0 ] && ART_TOP=0

# Vertically center each left column on the FLOOR baseline (the full block
# height incl. headroom), independent of the live hop row → no vertical bob.
BUBBLE_START=0
if [ $BUBBLE_COUNT -gt 0 ] && [ $BUBBLE_COUNT -lt $ART_COUNT_TOTAL ]; then
    BUBBLE_START=$(( (ART_COUNT_TOTAL - BUBBLE_COUNT) / 2 ))
fi
STATS_START=0
if [ $STATS_COUNT -gt 0 ] && [ $STATS_COUNT -lt $ART_COUNT_TOTAL ]; then
    STATS_START=$(( (ART_COUNT_TOTAL - STATS_COUNT) / 2 ))
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
# Idle wander (design-movement §5c): retract the connector while the buddy is
# away from home — the bubble box stays whole, it just stops pointing at thin
# air. Reattaches at offset 0 (home). The "   " gap keeps the width identical.
# §5e exception: when wanderBubble is on, the bubble travels WITH the buddy, so
# the connector stays attached for horizontal motion — only a vertical hop
# (WANDER_ROW>0), where the mouth is on a different row, still retracts it.
if [ "$WANDER_BUBBLE" = "true" ]; then
    [ "$WANDER_ROW" -gt 0 ] && CONNECTOR_BI=-1
else
    { [ "$WANDER_OFF" -gt 0 ] || [ "$WANDER_ROW" -gt 0 ]; } && CONNECTOR_BI=-1
fi

# ─── Output: merged stats panel + bubble + connector + art per line ──────────
TOTAL_BUBBLE=$(( BUBBLE_START + BUBBLE_COUNT ))
TOTAL_STATS=$(( STATS_START + STATS_COUNT ))
MAX_LINES=$ART_COUNT_TOTAL
[ $TOTAL_BUBBLE -gt $MAX_LINES ] && MAX_LINES=$TOTAL_BUBBLE
[ $TOTAL_STATS -gt $MAX_LINES ] && MAX_LINES=$TOTAL_STATS
for (( i=0; i<MAX_LINES; i++ )); do
    # Art part: actual art line (shifted down by the hop headroom, up by the
    # live hop row) or blank filler.
    ai=$(( i - ART_TOP ))
    if [ $ai -ge 0 ] && [ $ai -lt $ART_COUNT ]; then
        art_part="${ALL_COLORS[$ai]}${ALL_LINES[$ai]}${NC}"
    else
        art_part=$(printf '%*s' "$ART_W" '')
    fi

    line_out="$SPACER"

    # Stats column (leftmost) — pre-colored, fixed STATS_W display width
    if [ $STATS_COUNT -gt 0 ]; then
        si=$(( i - STATS_START ))
        if [ $si -ge 0 ] && [ $si -lt $STATS_COUNT ]; then
            line_out+="${STATS_LINES[$si]}"
        else
            line_out+=$(printf '%*s' "$STATS_W" '')
        fi
        line_out+="$STATS_GAP_STR"
        line_out+="$MID_SPACER"
    fi

    # §5e: when the bubble travels with the buddy, the offset is inserted here —
    # before the whole bubble cluster — so bubble+connector+art shift together.
    # Empty (no-op) in the default pinned-bubble mode. Applied on every row so
    # blank-bubble rows (top/bottom art) translate by the same amount.
    line_out+="$WANDER_PAD_BUBBLE"

    # Bubble column
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
                line_out+="${C}${bline}${NC}${gap}"
            else
                pipe_l="${bline:0:1}"
                pipe_r="${bline: -1}"
                inner="${bline:1:$(( ${#bline} - 2 ))}"
                line_out+="${C}${pipe_l}${NC}${DIM}${inner}${NC}${C}${pipe_r}${NC}${gap}"
            fi
        else
            line_out+=$(printf '%*s' "$BOX_W" '')
            line_out+="   "
        fi
    fi

    # Idle wander (design-movement §5d): nudge the art block right into the
    # reclaimed margin. In the default mode this is the whole offset (bubble
    # pinned); with wanderBubble on it's empty because the offset already shifted
    # the bubble cluster above (art rode along, connector attached).
    line_out+="$WANDER_PAD_ART"
    line_out+="$art_part"
    echo "$line_out"
done

exit 0
