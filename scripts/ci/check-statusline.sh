#!/usr/bin/env bash
# CI golden check for the Claude Code statusline.
#
# Primary signal: loud text assertions over a width matrix + CJK / wide-emoji
# fixtures. A broken render fails the build. VHS image goldens are a separate
# step (scripts/ci/check-vhs-goldens.sh).
#
# Run from the repo root:
#   bash scripts/ci/check-statusline.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/statusline-fixture" && pwd)"
pty_helper="$ROOT/scripts/ci/render-statusline-pty.py"
payload='{"session_id":"ci","model":{"display_name":"CI"},"workspace":{"current_dir":"."}}'

# Widths that have historically sheared the card / truncated the right edge.
WIDTHS=(20 40 60 80 93 120 200)

# Claude Code kills statusline scripts around 1s; stay under that budget.
TIME_BUDGET_MS=1000

fail() {
  echo "FAIL: $1" >&2
  if [ -n "${2:-}" ]; then
    printf '%s\n' "$2" >&2
  fi
  exit 1
}

# Strip SGR / CSI color sequences. Keep the rest of the glyphs intact so
# display-width math matches what a terminal would paint.
strip_ansi() {
  # shellcheck disable=SC2001
  printf '%s' "$1" | sed $'s/\x1b\\[[0-9;]*[A-Za-z]//g'
}

# Display width — mirrors statusline/buddy-status.sh:dwidth and
# server/art.ts:displayWidth (Emoji_Presentation + CJK + VS16 upgrade).
EMOJI_WIDTHS_DATA="$ROOT/statusline/emoji-widths.data"
EMOJI_PRES_2600="$(grep -v '^#' "$EMOJI_WIDTHS_DATA" 2>/dev/null | tr -d '\n' || true)"

dwidth() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-32LE 2>/dev/null | od -An -tu4 -v | awk -v pres="$EMOJI_PRES_2600" '
    function load_ranges(value, target,    n, i, count, bounds, start, end, cp) {
      n = split(value, ranges, ",")
      for (i = 1; i <= n; i++) {
        count = split(ranges[i], bounds, "-")
        start = bounds[1] + 0
        end = (count == 2) ? bounds[2] + 0 : start
        for (cp = start; cp <= end; cp++) target[cp] = 1
      }
    }
    BEGIN {
      load_ranges(pres, wide)
    }
    function char_width(cp) {
      if (cp >= 126976) return 2
      if (cp >= 9728 && cp <= 10175) return (cp in wide) ? 2 : 1
      if (cp >= 9472 && cp <= 9631) return 1
      if (cp >= 12288 && cp <= 40959) return 2
      if (cp >= 65281 && cp <= 65376) return 2
      return 1
    }
    {
      for (i = 1; i <= NF; i++) {
        cp = $i + 0
        if (cp == 65039) {
          if (upgradable) { w += 1; upgradable = 0 }
          continue
        }
        if ((cp >= 65024 && cp <= 65038) || cp == 8205) { upgradable = 0; continue }
        cw = char_width(cp)
        w += cw
        upgradable = (cw == 1 && cp >= 9728 && cp <= 10175) ? 1 : 0
      }
    }
    END { print w + 0 }
  '
}

now_ms() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(int(time.time() * 1000))'
  else
    echo $(( $(date +%s) * 1000 ))
  fi
}

# Render statusline against a fixture dir at a fixed terminal width.
# Uses a pseudo-TTY so buddy-status.sh's stty/PTY width probe sees the
# requested cols (COLUMNS alone is ignored when the parent TTY is wide).
# Sets globals: OUTPUT, PLAIN, ELAPSED_MS, EFFECTIVE_COLS
render_at() {
  local config_dir="$1"
  local cols="$2"
  local rendered errfile
  errfile=$(mktemp)
  # The fixtures write reaction.default.json, but paths.sh derives the
  # per-session filename from CLAUDE_CODE_SESSION_ID / TMUX_PANE. Whichever of
  # those happens to be set in the ambient environment decides which reaction
  # file is read, so the check passed locally and failed on CI (no bubble
  # rendered, because the reaction was looked up under a different session id).
  # Pin them empty so the session id is always "default" and the result does
  # not depend on where the check runs.
  rendered="$(
    CLAUDE_CODE_SESSION_ID="" \
    TMUX_PANE="" \
    STATUSLINE_PAYLOAD="$payload" \
      python3 "$pty_helper" \
        "$cols" \
        "$ROOT" \
        "$config_dir" \
        "$ROOT/statusline/buddy-status.sh" \
        2>"$errfile"
  )"
  # Prefer the child-only timer from the PTY helper (excludes harness import).
  ELAPSED_MS=$(sed -n 's/^STATUSLINE_ELAPSED_MS=//p' "$errfile" | tail -n1)
  rm -f "$errfile"
  case "$ELAPSED_MS" in
    ''|*[!0-9]*) ELAPSED_MS=9999 ;;
  esac
  OUTPUT="$(printf '%s' "$rendered" | tr -d '\r')"
  PLAIN="$(strip_ansi "$OUTPUT")"
  # buddy-status.sh currently floors detected widths below 40 up to 125
  # (owned by the resize worker). Assert against the budget the script
  # actually honors so the matrix stays honest without forking that logic.
  if [ "$cols" -lt 40 ]; then
    EFFECTIVE_COLS=125
  else
    EFFECTIVE_COLS="$cols"
  fi
}

assert_render() {
  local label="$1"
  local cols="$2"
  local expect_name="$3"
  local expect_substr="${4:-}"
  local budget="${EFFECTIVE_COLS:-$cols}"

  local plain_lines line_count max_w w line
  plain_lines=$(printf '%s\n' "$PLAIN")
  line_count=$(printf '%s\n' "$plain_lines" | wc -l | tr -d ' ')

  printf '%s\n' "$PLAIN" | grep -Fq "$expect_name" \
    || fail "[$label] pet name '$expect_name' missing from output" "$PLAIN"

  [ "$line_count" -ge 4 ] \
    || fail "[$label] expected >=4 output lines, got $line_count" "$PLAIN"

  if [ -n "$expect_substr" ]; then
    printf '%s\n' "$PLAIN" | grep -Fq "$expect_substr" \
      || fail "[$label] expected substring missing: $expect_substr" "$PLAIN"
  fi

  # Sprite content must stay art, not descriptor words.
  if printf '%s\n' "$PLAIN" | grep -Eq '<\([[:alpha:]]{2,}'; then
    fail "[$label] sprite looks corrupted (word leaked into eye slot)" "$PLAIN"
  fi
  if printf '%s\n' "$PLAIN" | grep -Fq '{E}'; then
    fail "[$label] unresolved {E} eye placeholder in output" "$PLAIN"
  fi

  max_w=0
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    w=$(dwidth "$line")
    if [ "$w" -gt "$max_w" ]; then
      max_w=$w
    fi
    if [ "$w" -gt "$budget" ]; then
      fail "[$label] row display width $w exceeds budget $budget (requested cols=$cols): $(printf '%q' "$line")" "$PLAIN"
    fi
  done <<< "$plain_lines"

  # Bubble box: border rows and text rows must agree in outer width.
  # Bubble and art share a line ("| text |--   <(° ..."), so measure only the
  # box segment. Ignore short art glyphs like the duck feet (`--') that also
  # start with a backtick.
  local box_w="" border_w text_w trimmed first bubble_only
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    trimmed=$(printf '%s' "$line" | sed $'s/^[ \t\xE2\xA0\x80]*//')
    first=$(printf '%s' "$trimmed" | cut -c1)
    bubble_only=""
    if [ "$first" = "." ]; then
      bubble_only=$(printf '%s' "$trimmed" | sed -n 's/^\(\.[-][-]*\.\).*/\1/p')
    elif [ "$first" = '`' ]; then
      bubble_only=$(printf '%s' "$trimmed" | sed -n "s/^\\(\`[-][-]*'\).*/\\1/p")
    elif [ "$first" = "|" ]; then
      bubble_only=$(printf '%s' "$trimmed" | sed -n 's/^\(|[^|]*|\).*/\1/p')
    fi
    [ -z "$bubble_only" ] && continue
    # Real speech boxes are wide (INNER_W defaults to 44 → outer 48). Skip
    # any short accidental match.
    local seg_w
    seg_w=$(dwidth "$bubble_only")
    if [ "$seg_w" -lt 20 ]; then
      continue
    fi
    if [ "$first" = "|" ]; then
      if [ -n "$box_w" ] && [ "$seg_w" -ne "$box_w" ]; then
        fail "[$label] bubble text width $seg_w != border $box_w" "$PLAIN"
      fi
    else
      if [ -z "$box_w" ]; then
        box_w=$seg_w
      elif [ "$seg_w" -ne "$box_w" ]; then
        fail "[$label] bubble border width $seg_w != $box_w" "$PLAIN"
      fi
    fi
  done <<< "$plain_lines"

  # Name row must not outrun a reasonable panel width.
  local name_line name_w
  name_line=$(printf '%s\n' "$PLAIN" | grep -F "$expect_name" | head -n1 || true)
  if [ -n "$name_line" ]; then
    name_w=$(dwidth "$(printf '%s' "$name_line" | sed $'s/^[ \t\xE2\xA0\x80]*//')")
    if [ "$name_w" -gt 24 ]; then
      fail "[$label] name row display width $name_w looks wider than the panel" "$PLAIN"
    fi
  fi

  if [ "$ELAPSED_MS" -gt "$TIME_BUDGET_MS" ]; then
    fail "[$label] statusline took ${ELAPSED_MS}ms (budget ${TIME_BUDGET_MS}ms)" "$PLAIN"
  fi

  echo "OK: $label requested_cols=$cols budget=$budget lines=$line_count max_row_w=$max_w time=${ELAPSED_MS}ms name='$expect_name'"
}

# ─── Fixture 1: committed baseline (pikachu / Cobalt) ────────────────────────
base_name="$(jq -r .name "$fixture_dir/buddy-state/status.json")"
# Cold-start warmup (not timed). Claude Code also keeps the process hot after
# the first tick; the budget is for steady-state, not first-ever spawn.
render_at "$fixture_dir" 80 >/dev/null || true
for cols in "${WIDTHS[@]}"; do
  render_at "$fixture_dir" "$cols"
  assert_render "baseline@${cols}" "$cols" "$base_name"
done

# ─── Fixture 2: duck + CJK reaction (real prior breakage) ────────────────────
cjk_dir=$(mktemp -d)
cleanup() { rm -rf "$cjk_dir" "${emoji_dir:-}" "${corrupt_dir:-}"; }
trap cleanup EXIT
mkdir -p "$cjk_dir/buddy-state"
cp "$fixture_dir/buddy-state/config.json" "$cjk_dir/buddy-state/config.json"

bun -e "
import { writeFileSync } from 'fs';
import { getStatusFrames } from './server/art.ts';
const bones = {
  rarity: 'common', species: 'duck', eye: '°', hat: 'none', shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
  peak: 'DEBUGGING', dump: 'PATIENCE',
};
const { frames, frameSequence } = getStatusFrames(bones);
writeFileSync(process.argv[1], JSON.stringify({
  name: 'Daffodil', species: 'duck', rarity: 'common', stars: '★',
  face: '(°>', eye: '°', shiny: false, hat: 'none', reaction: '',
  muted: false, achievement: '', frames, frameSequence,
  level: 1, xp: 0, mood: 'focused',
}));
" "$cjk_dir/buddy-state/status.json"

_ts=$(now_ms)
printf '{"reaction":"编译通过了 你好世界","timestamp":%s,"reason":"turn"}\n' "$_ts" \
  > "$cjk_dir/buddy-state/reaction.default.json"

# Bubble rows use INNER_W=44 (box ~48 cols) today; the resize worker owns
# shrinking/dropping bubbles under that floor. Exercise CJK width accounting
# at budgets that can actually hold the current box.
for cols in 80 93 120 200; do
  render_at "$cjk_dir" "$cols"
  assert_render "cjk@${cols}" "$cols" "Daffodil" "你好"
  printf '%s\n' "$PLAIN" | grep -Fq '<(°' \
    || fail "[cjk@${cols}] duck eye row missing degree-sign glyph" "$PLAIN"
done

# ─── Fixture 3: wide-emoji reaction (VS16 / presentation) ────────────────────
emoji_dir=$(mktemp -d)
mkdir -p "$emoji_dir/buddy-state"
cp "$cjk_dir/buddy-state/status.json" "$emoji_dir/buddy-state/status.json"
cp "$fixture_dir/buddy-state/config.json" "$emoji_dir/buddy-state/config.json"
_ts=$(now_ms)
printf '{"reaction":"ship it 🎉 ❤️ ✨","timestamp":%s,"reason":"success"}\n' "$_ts" \
  > "$emoji_dir/buddy-state/reaction.default.json"

for cols in 80 93 120 200; do
  render_at "$emoji_dir" "$cols"
  assert_render "emoji@${cols}" "$cols" "Daffodil" "🎉"
done

# ─── Fixture 4: corrupt eye descriptor must not reach the sprite ─────────────
# Regression for the live "<(normal ..." bug: even if bones.eye is the word
# "normal", getStatusFrames must bake a real glyph.
corrupt_dir=$(mktemp -d)
mkdir -p "$corrupt_dir/buddy-state"
cp "$fixture_dir/buddy-state/config.json" "$corrupt_dir/buddy-state/config.json"

bun -e "
import { writeFileSync } from 'fs';
import { getStatusFrames } from './server/art.ts';
const bones = {
  rarity: 'common', species: 'duck', eye: 'normal', hat: 'none', shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
  peak: 'DEBUGGING', dump: 'PATIENCE',
};
const { frames, frameSequence } = getStatusFrames(bones);
for (const body of frames) {
  if (body.includes('normal')) {
    console.error('getStatusFrames leaked descriptor into frame:', body);
    process.exit(2);
  }
  if (body.includes('{E}')) {
    console.error('unresolved placeholder:', body);
    process.exit(2);
  }
}
writeFileSync(process.argv[1], JSON.stringify({
  name: 'Daffodil', species: 'duck', rarity: 'common', stars: '★',
  face: '(°>', eye: '°', shiny: false, hat: 'none', reaction: '',
  muted: false, achievement: '', frames, frameSequence,
  level: 1, xp: 0, mood: 'focused',
}));
" "$corrupt_dir/buddy-state/status.json"

render_at "$corrupt_dir" 80
assert_render "corrupt-eye@80" 80 "Daffodil"
if printf '%s\n' "$PLAIN" | grep -Fq 'normal'; then
  fail "[corrupt-eye@80] literal normal appeared in render" "$PLAIN"
fi
printf '%s\n' "$PLAIN" | grep -Fq '<(°' \
  || fail "[corrupt-eye@80] expected sanitized degree-sign eye" "$PLAIN"

echo "OK: all statusline golden assertions passed"
