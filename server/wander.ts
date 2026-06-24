/**
 * Idle-wander core (game-feel "buddy movement"): a pure, seeded random walk
 * that the status line cycles through to amble the buddy art rightward within
 * its reclaimed margin (and, with hop on, a parallel vertical bob).
 *
 * Server bakes, bash cycles — this module is the bake. It owns no I/O and reads
 * no state; `writeStatusState` injects `Date.now()` as the seed in production
 * while tests pin it. Mirrors the pre-baked-sequence pattern of
 * `art.ts` (`getStatusFrames` / `flourishFrames`).
 *
 * Design: docs/game-feel/design-movement.md §4 (generator) + §7.D (mood map).
 */

import { mulberry32 } from "./engine.ts";

/** Tunables for one baked walk. All durations are in ticks (≈ seconds). */
export interface WanderOpts {
  /** Max horizontal offset; the walk stays in [0, range]. */
  range: number;
  /** Sequence length == loop period in seconds. */
  length: number;
  /** Min ticks parked at a waypoint. */
  dwellMin: number;
  /** Max ticks parked at a waypoint. */
  dwellMax: number;
  /** Ticks per 1-cell step (1 = brisk, 2 = slow shuffle). */
  stepEvery: number;
  /** Max vertical rows; 0 disables hops (§7.A). */
  hopHeight: number;
  /** Injected seed; `Date.now()` in prod, fixed in tests. */
  seed: number;
}

/** A baked walk: index both arrays by `NOW % length`, like `frameSequence`. */
export interface WanderWalk {
  /** Per-tick horizontal offset (cells, ≥ 0) → `wanderSequence`. */
  horizontal: number[];
  /** Per-tick vertical offset (rows) → `wanderRowSequence`; `undefined`
   *  when `hopHeight === 0`. */
  vertical: number[] | undefined;
}

/** §7.D mood → walk personality (range / dwell / step). */
const MOOD_WALK: Record<
  string,
  { range: number; dwellMin: number; dwellMax: number; stepEvery: number }
> = {
  focused: { range: 2, dwellMin: 12, dwellMax: 24, stepEvery: 1 },
  happy: { range: 4, dwellMin: 6, dwellMax: 16, stepEvery: 1 },
  excited: { range: 6, dwellMin: 3, dwellMax: 9, stepEvery: 1 },
  chaotic: { range: 6, dwellMin: 2, dwellMax: 7, stepEvery: 1 },
  tired: { range: 2, dwellMin: 18, dwellMax: 30, stepEvery: 2 },
  melancholy: { range: 2, dwellMin: 14, dwellMax: 26, stepEvery: 2 },
};

/** Calm fallback for an unknown mood string (never animate more than focused). */
const DEFAULT_MOOD = "focused";

/** Default loop length (seconds); see §8. status.json reseeds well before it. */
const DEFAULT_LENGTH = 180;

/** Inclusive integer in [lo, hi]; collapses to lo when hi <= lo. */
function randInt(rng: () => number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** A parabolic hop arc rising to `height` and back, e.g. height 2 → [1, 2, 1].
 *  Surrounded by baseline 0s it reads 0→…→height→…→0 (a complete arc). */
function hopArc(height: number): number[] {
  const arc: number[] = [];
  for (let v = 1; v <= height; v++) arc.push(v);
  for (let v = height - 1; v >= 1; v--) arc.push(v);
  return arc;
}

/**
 * Build a deterministic "amble": from home (0), pick a random waypoint in
 * [0, range], step toward it one cell every `stepEvery` ticks (so |Δ| ≤ 1),
 * park for a random dwell, repeat until `length` ticks are produced. With
 * `hopHeight > 0` a parallel vertical track sprinkles parabolic hop arcs.
 *
 * Pure: no I/O, deterministic for a given `opts.seed`.
 */
export function buildWanderSequence(opts: WanderOpts): WanderWalk {
  const range = Math.max(0, Math.floor(opts.range));
  const length = Math.max(0, Math.floor(opts.length));
  const stepEvery = Math.max(1, Math.floor(opts.stepEvery));
  const dwellMin = Math.max(1, Math.floor(opts.dwellMin));
  const dwellMax = Math.max(dwellMin, Math.floor(opts.dwellMax));
  const hopHeight = Math.max(0, Math.floor(opts.hopHeight));

  const rng = mulberry32(opts.seed >>> 0);
  const horizontal: number[] = [];
  let pos = 0;

  while (horizontal.length < length) {
    // Dwell at the current waypoint.
    const dwell = randInt(rng, dwellMin, dwellMax);
    for (let i = 0; i < dwell && horizontal.length < length; i++) {
      horizontal.push(pos);
    }
    if (horizontal.length >= length) break;

    // Travel to a fresh waypoint: hold each cell `stepEvery` ticks, then step.
    const target = randInt(rng, 0, range);
    const dir = target > pos ? 1 : -1;
    while (pos !== target && horizontal.length < length) {
      for (let s = 0; s < stepEvery && horizontal.length < length; s++) {
        horizontal.push(pos);
      }
      pos += dir;
    }
  }

  let vertical: number[] | undefined;
  if (hopHeight > 0 && length > 0) {
    vertical = new Array<number>(length).fill(0);
    const arc = hopArc(hopHeight);
    // First hop after a gap; arcs are separated by ≥ dwellMin baseline ticks,
    // so each is bounded by 0s — it rises and returns to 0.
    let i = randInt(rng, dwellMin, dwellMax);
    while (i + arc.length <= length) {
      for (let k = 0; k < arc.length; k++) vertical[i + k] = arc[k];
      i += arc.length + randInt(rng, dwellMin, dwellMax);
    }
  }

  return { horizontal, vertical };
}

/**
 * Map the buddy's current mood + level to a walk personality (§7.D). A one-way
 * read — input is values `writeStatusState` already holds, output is the opts
 * for `buildWanderSequence`. Writes nothing and grants no advantage (NFR1),
 * exactly like `emotion → frames` today.
 *
 * @param mood - current mood string (unknown ⇒ calm `focused` baseline).
 * @param level - buddy XP level; nudges range up by `min(2, ⌊level/10⌋)` and
 *     bumps hop amplitude to 2 at level ≥ 20 (purely flavor).
 * @param seed - injected seed, threaded straight into the returned opts.
 */
export function moodWalkOpts(
  mood: string,
  level: number,
  seed: number,
): WanderOpts {
  const base = MOOD_WALK[mood] ?? MOOD_WALK[DEFAULT_MOOD];
  const lvl = Math.max(0, Math.floor(level));
  const rangeNudge = Math.min(2, Math.floor(lvl / 10));
  return {
    range: base.range + rangeNudge,
    length: DEFAULT_LENGTH,
    dwellMin: base.dwellMin,
    dwellMax: base.dwellMax,
    stepEvery: base.stepEvery,
    hopHeight: lvl >= 20 ? 2 : 1,
    seed,
  };
}
