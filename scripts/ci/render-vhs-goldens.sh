#!/usr/bin/env bash
# Render statusline VHS goldens (PNG frames) for the committed fixtures.
#
# Usage (from repo root):
#   bash scripts/ci/render-vhs-goldens.sh              # write under scripts/ci/vhs-out/
#   bash scripts/ci/render-vhs-goldens.sh --update      # also refresh scripts/ci/goldens/
#
# Requires: vhs, ffmpeg, ttyd on PATH. CI installs pinned versions.
#
# Re-baseline intentionally:
#   bash scripts/ci/render-vhs-goldens.sh --update
#   git add scripts/ci/goldens/*.png
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

UPDATE=0
OUT_DIR="scripts/ci/vhs-out"
GOLDEN_DIR="scripts/ci/goldens"

for arg in "$@"; do
  case "$arg" in
    --update) UPDATE=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

command -v vhs >/dev/null 2>&1 || { echo "vhs not on PATH" >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not on PATH" >&2; exit 1; }
command -v ttyd >/dev/null 2>&1 || { echo "ttyd not on PATH" >&2; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

env_ci_was="${CI-}"
unset CI || true
export COLORTERM=truecolor

gen_dir="$OUT_DIR/fixtures"
mkdir -p "$gen_dir/cjk/buddy-state" "$gen_dir/emoji/buddy-state"
cp scripts/ci/statusline-fixture/buddy-state/config.json "$gen_dir/cjk/buddy-state/config.json"
cp scripts/ci/statusline-fixture/buddy-state/config.json "$gen_dir/emoji/buddy-state/config.json"

bun -e "
import { writeFileSync } from 'fs';
import { getStatusFrames } from './server/art.ts';
const bones = {
  rarity: 'common', species: 'duck', eye: '°', hat: 'none', shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
  peak: 'DEBUGGING', dump: 'PATIENCE',
};
const { frames, frameSequence } = getStatusFrames(bones);
const status = {
  name: 'Daffodil', species: 'duck', rarity: 'common', stars: '★',
  face: '(°>', eye: '°', shiny: false, hat: 'none', reaction: '',
  muted: false, achievement: '', frames, frameSequence,
  level: 1, xp: 0, mood: 'focused',
};
writeFileSync(process.argv[1], JSON.stringify(status));
writeFileSync(process.argv[2], JSON.stringify(status));
writeFileSync(process.argv[3], JSON.stringify({
  reaction: '编译通过了 你好世界', timestamp: 0, reason: 'turn',
}));
writeFileSync(process.argv[4], JSON.stringify({
  reaction: 'ship it 🎉 ❤️ ✨', timestamp: 0, reason: 'success',
}));
" \
  "$gen_dir/cjk/buddy-state/status.json" \
  "$gen_dir/emoji/buddy-state/status.json" \
  "$gen_dir/cjk/buddy-state/reaction.default.json" \
  "$gen_dir/emoji/buddy-state/reaction.default.json"

render_one() {
  local name="$1"
  local cols="$2"
  local lines="$3"
  local fixture_rel="$4"
  local tape out_png out_gif
  tape="$OUT_DIR/${name}.tape"
  out_png="$OUT_DIR/${name}.png"
  out_gif="$OUT_DIR/${name}.gif"

  # Relative paths only — vhs's tape parser treats absolute "/..." paths as
  # separate commands. JSON stays out of the tape via vhs-run-statusline.sh.
  cat > "$tape" <<EOF
Output ${out_gif}
Set Width $(( cols * 9 ))
Set Height $(( lines * 18 ))
Set FontSize 14
Set FontFamily "DejaVu Sans Mono"
Set Padding 12
Set Margin 0
Set Theme "Catppuccin Mocha"
Set Shell "bash"
Set TypingSpeed 0ms
Set Framerate 10
Type "PS1= bash --noprofile --norc -c 'bash scripts/ci/vhs-run-statusline.sh ${cols} ${fixture_rel}; sleep 1'"
Enter
Sleep 2s
EOF

  echo "render: $name (cols=$cols fixture=$fixture_rel)"
  vhs "$tape"
  [ -f "$out_gif" ] || { echo "missing gif: $out_gif" >&2; exit 1; }

  # Extract a late still frame. Prefer the last frame so typing/sleep settle.
  # -update 1 lets ffmpeg write a single PNG path without a %d sequence.
  ffmpeg -hide_banner -loglevel error -y \
    -i "$out_gif" \
    -vf "select=eq(n\,max(0\,n))" \
    -update 1 -frames:v 1 \
    "$out_png"
  # The select above is a no-op; take the final frame explicitly.
  local nframes
  nframes=$(ffprobe -v error -select_streams v:0 -count_frames \
    -show_entries stream=nb_read_frames -of csv=p=0 "$out_gif" || echo 0)
  if [ "${nframes:-0}" -gt 1 ] 2>/dev/null; then
    local last=$(( nframes - 1 ))
    ffmpeg -hide_banner -loglevel error -y \
      -i "$out_gif" \
      -vf "select=eq(n\,${last})" \
      -update 1 -frames:v 1 \
      "$out_png"
  fi
  [ -f "$out_png" ] || { echo "missing png: $out_png" >&2; exit 1; }
}

render_one "baseline-80" 80 18 "scripts/ci/statusline-fixture"
render_one "baseline-40" 40 18 "scripts/ci/statusline-fixture"
render_one "cjk-80" 80 18 "scripts/ci/vhs-out/fixtures/cjk"
render_one "emoji-40" 40 18 "scripts/ci/vhs-out/fixtures/emoji"

if [ "$UPDATE" -eq 1 ]; then
  mkdir -p "$GOLDEN_DIR"
  for png in "$OUT_DIR"/*.png; do
    base=$(basename "$png")
    cp "$png" "$GOLDEN_DIR/$base"
    echo "updated golden: $GOLDEN_DIR/$base"
  done
fi

if [ -n "${env_ci_was}" ]; then
  export CI="$env_ci_was"
fi

echo "OK: vhs renders written to $OUT_DIR"
