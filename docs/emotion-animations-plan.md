# Emotion Animations — Implementation Plan

Status: step 1 shipped, steps 2–6 pending.
Branch: `feat/emotion-animations`.

## Progress

- [x] **Step 1** — move art ownership from bash to the server. `getStatusFrames`
      in `server/art.ts` pre-bakes idle/blink + hat overlay; `writeStatusState`
      writes `frames` + `frameSequence` into `status.json`; bash becomes a dumb
      cycler with a small `(°°)` fallback for version skew. Snapshot script
      added for visual review.
- [ ] Step 2 — emotion art frames for all species.
- [ ] Step 3 — reason → emotion mapping.
- [ ] Step 4 — persist active emotion in status.json.
- [ ] Step 5 — statusline wiring (mostly no-op thanks to step 1).
- [ ] Step 6 — docs.

## Goal

Give buddies visual emotional states. Today the art cycles purely on wall-clock
time (`NOW % 15`), with no reaction to events. We want the buddy's body art to
change when something happens: angry on errors, happy on pets, bored when idle,
surprised on large diffs.

## Model

```ts
type Emotion = "feliz" | "enfadado" | "aburrido" | "sorpresa" | "neutral";
```

`neutral` = no active emotion, falls back to the current 3-frame idle cycle.

### Reason → Emotion mapping

| Reason        | Emotion    |
|---------------|------------|
| `pet`         | feliz      |
| `hatch`       | feliz      |
| `error`       | enfadado   |
| `test-fail`   | enfadado   |
| `idle`        | aburrido   |
| `large-diff`  | sorpresa   |
| `turn`        | neutral    |

## Art

Each non-neutral emotion has 2–3 sub-frames for micro-movement (consistent with
the current 3 idle frames per species). The emotion art ignores the buddy's
configured eye — the emotion owns its eyes (`^`, `>`, `-`, `O`).

Sub-frame count per emotion:

- **aburrido** (3): `z` high → `z` drifting → no `z`
- **feliz** (2): ripple `~  ~` → `  ~~`
- **enfadado** (2): mouth `>>` → `>>>`
- **sorpresa** (2): eyes `O` + `!` → eyes `o` + `!!`

Total new art: 18 species × 9 frames = 162 frames of 5×12 chars.

## Architecture — server renders, bash cycles

Today `statusline/buddy-status.sh` has a ~150-line `case "$SPECIES"` block
holding every species' art inline. We move all art ownership to the server and
reduce bash to a dumb cycler.

New `status.json` payload shape:

```json
{
  "emotion": "enfadado",
  "frames": [["line1","line2","line3","line4","line5"], ...],
  "frameSequence": [0, 0, 1, 0, 1, 1],
  "timestamp": 1712345678
}
```

- `frames`: array of pre-rendered 5-line art frames, eyes already resolved.
- `frameSequence`: which frame to show at each tick. Bash picks
  `frames[frameSequence[NOW % frameSequence.length]]`.
- For `neutral`: server writes the 3 idle frames and the existing sequence
  `[0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0]`, pre-resolving `-1` (blink) to a frame
  with `-` eyes. Bash no longer needs a special case for blinks.

Benefits:
- Removes all art from bash (testability, maintainability).
- Animation still works tick-by-tick via `NOW` in bash.
- Server only rewrites `status.json` when state changes (species swap, emotion
  activation, emotion expiry) — not every tick.

## TTL

Emotions inherit the existing `reactionTTL` config. When the reaction bubble
expires, the emotion also clears back to `neutral`. No new decay logic needed.

## Commit order

1. **`refactor(statusline): read frames from status.json`** — first we move art
   ownership out of bash with no behaviour change. Server writes the 3 idle
   frames + current sequence. Bash reads and cycles. This is the only step
   that touches the plumbing — isolate the risk.
2. **`feat(art): add emotion frames (happy, angry, bored, surprised)`** — data
   only in `server/art.ts`.
3. **`feat(reactions): map reasons to emotions`** — mapping + tests.
4. **`feat(state): persist emotion in status.json`** — server chooses which
   frames to write based on active emotion.
5. **`feat(statusline): display emotion animations`** — if step 1 is clean,
   this is mostly a no-op: bash already cycles whatever the server gives it.
6. **`docs`**.

## Open risks

- Step 1 is the only step that can break the statusline silently. Manual
  verification after each commit: open a fresh terminal, confirm buddy appears
  and cycles frames correctly across species.
- 162 ASCII frames is tedious but mechanical. Easy to introduce width/height
  bugs — add a test that asserts every frame is 5 lines × 12 display cols.
- Bash needs `jq` (already a dependency) to parse `frames` arrays.
