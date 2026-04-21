#!/usr/bin/env bash
# Render the statusline for every species at every frame index. Used for
# visual review after changes to art pipeline (server render + bash cycler).
#
# Usage:
#   ./scripts/snapshot-statusline.sh                 # print to stdout
#   ./scripts/snapshot-statusline.sh out/fixtures    # write one file per case
#
# Uses a temp BUDDY_STATE_DIR so it never touches the user's real state.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-}"

TMP_STATE=$(mktemp -d)
trap 'rm -rf "$TMP_STATE"' EXIT
export CLAUDE_CONFIG_DIR="$TMP_STATE"
mkdir -p "$TMP_STATE/buddy-state"

SPECIES_LIST=(duck goose blob cat dragon octopus owl penguin turtle snail
              ghost axolotl capybara cactus robot rabbit mushroom chonk)
HATS=(none crown propeller wizard)
# Ticks hit all 4 distinct frames: 0→F0, 4→F1, 8→blink, 11→F2.
TICKS=(0 4 8 11)

for species in "${SPECIES_LIST[@]}"; do
    for hat in "${HATS[@]}"; do
        # Generate status.json with pre-rendered frames via a small bun script.
        bun -e "
import { writeStatusState } from '${ROOT}/server/state.ts';
writeStatusState({
    bones: {
        species: '${species}', eye: '\\u00b0', hat: '${hat}',
        rarity: 'common', shiny: false,
        stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
        peak: 'DEBUGGING', dump: 'PATIENCE',
    },
    name: 'Test', personality: '', hatchedAt: 0, userId: 'x',
});
" > /dev/null

        for tick in "${TICKS[@]}"; do
            label="${species}  hat=${hat}  tick=${tick}"
            body=$(BUDDY_FAKE_NOW="$tick" COLUMNS=80 \
                   "$ROOT/statusline/buddy-status.sh" < /dev/null)
            if [ -n "$OUT_DIR" ]; then
                mkdir -p "$OUT_DIR"
                printf '%s\n' "$body" > "$OUT_DIR/${species}_${hat}_t${tick}.out"
            else
                printf '=== %s ===\n%s\n\n' "$label" "$body"
            fi
        done
    done
done
