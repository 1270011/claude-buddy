/**
 * "Today's whim" — a single optional daily suggestion (game-feel FR-B1/B2).
 *
 * Deliberately NON-COERCIVE: an offer, not an obligation. There is no streak, no
 * consecutive-completion tracking, and no penalty for missing a day — that
 * restraint is structural (there is simply no field to record a miss). The
 * reward for fulfilling it is a single loot roll and nothing more (OQ1).
 *
 * State is account-scoped in whims.json alongside xp.json/streak.json, resolved
 * via buddyStateDir() at call time (honors CLAUDE_CONFIG_DIR per profile).
 *
 * Progress is delta-based against the existing event counters (achievements.ts)
 * — no second tally to keep in sync. Whim metrics are global counters only, so
 * the baseline and current readings always come from the same (slot-independent)
 * source.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path.ts";
import { loadEvents, type EventCounters } from "./achievements.ts";
import { rollLoot } from "./loot.ts";

// ─── Whim catalog ─────────────────────────────────────────────────────────────

export interface WhimDef {
  id: string;
  /** The in-character offer shown to the user. */
  offer: string;
  /** A global event counter; progress is its delta since the whim was offered. */
  metric: keyof EventCounters;
  target: number;
}

/** The daily pool. Metrics are all global counters (slot-independent). */
export const WHIMS: WhimDef[] = [
  {
    id: "commit",
    offer: "feel like landing a few commits today?",
    metric: "commits_made",
    target: 3,
  },
  {
    id: "green",
    offer: "how about a clean test run?",
    metric: "all_green",
    target: 1,
  },
  {
    id: "diff",
    offer: "in the mood to move some code around?",
    metric: "large_diffs",
    target: 1,
  },
  {
    id: "debug",
    offer: "let's hunt down a couple of bugs.",
    metric: "errors_seen",
    target: 2,
  },
];

// ─── State ────────────────────────────────────────────────────────────────────

export interface WhimState {
  date: string; // YYYY-MM-DD (local)
  whimId: string;
  baseline: number; // metric value when the whim was offered
  fulfilled: boolean;
  rewarded: boolean;
  // NOTE: deliberately no `streak` / `bestStreak` / `missed` field —
  // non-coercion is structural, not just a UI choice (game-feel FR-B1).
}

function whimFile(): string {
  return join(buddyStateDir(), "whims.json");
}

/** Local calendar date as YYYY-MM-DD, so the daily boundary is the user's midnight. */
export function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Deterministic non-negative hash of a string (for the daily pick). */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Pure: which whim is offered on a given date. Exported for tests. */
export function whimForDate(date: string): WhimDef {
  return WHIMS[hashStr(date) % WHIMS.length];
}

function readRaw(): Partial<WhimState> | null {
  try {
    return JSON.parse(readFileSync(whimFile(), "utf8")) as Partial<WhimState>;
  } catch {
    return null;
  }
}

function saveWhim(state: WhimState): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = whimFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(state));
  }
}

/**
 * Today's whim, rolling a fresh one (and re-baselining from the current
 * counters) whenever the stored date isn't today or the file is absent/partial.
 * Persists on a new-day roll. Missing a day leaves no trace — yesterday's
 * unfinished whim is simply replaced.
 */
export function loadWhim(now: Date = new Date()): WhimState {
  const date = todayStr(now);
  const raw = readRaw();
  if (
    raw &&
    raw.date === date &&
    typeof raw.whimId === "string" &&
    typeof raw.baseline === "number"
  ) {
    return {
      date,
      whimId: raw.whimId,
      baseline: raw.baseline,
      fulfilled: raw.fulfilled ?? false,
      rewarded: raw.rewarded ?? false,
    };
  }
  const whim = whimForDate(date);
  const fresh: WhimState = {
    date,
    whimId: whim.id,
    baseline: loadEvents()[whim.metric],
    fulfilled: false,
    rewarded: false,
  };
  saveWhim(fresh);
  return fresh;
}

/** The active whim definition for a state (falls back to the first if unknown). */
export function whimDef(state: WhimState): WhimDef {
  return WHIMS.find((w) => w.id === state.whimId) ?? WHIMS[0];
}

/** Current progress toward today's whim, clamped to [0, target]. */
export function whimProgress(state: WhimState): {
  current: number;
  target: number;
} {
  const def = whimDef(state);
  const raw = Math.max(0, loadEvents()[def.metric] - state.baseline);
  return { current: Math.min(raw, def.target), target: def.target };
}

export interface WhimTick {
  fulfilled: boolean;
  /** True only on the single tick that first grants the reward. */
  justRewarded: boolean;
  offer: string;
}

/**
 * Reconcile today's whim against the current counters: mark it fulfilled when
 * the target is met, and — exactly once — roll loot as the reward (OQ1:
 * loot-only, nothing else). Idempotent, so it's safe to call on every award.
 * The caller never throws because of a whim.
 */
export function tickWhim(slot?: string, now: Date = new Date()): WhimTick {
  const state = loadWhim(now);
  const def = whimDef(state);
  const { current, target } = whimProgress(state);

  if (current >= target) state.fulfilled = true;

  let justRewarded = false;
  if (state.fulfilled && !state.rewarded) {
    state.rewarded = true;
    saveWhim(state);
    justRewarded = true;
    try {
      rollLoot("whim", slot); // the entire reward — no XP/stat bonus (NFR1)
    } catch {
      // loot is best-effort; the whim still counts as fulfilled.
    }
  } else {
    saveWhim(state);
  }
  return { fulfilled: state.fulfilled, justRewarded, offer: def.offer };
}

/** One-line markdown summary of today's whim, for the buddy_xp card. */
export function formatWhimLine(now: Date = new Date()): string {
  const state = loadWhim(now);
  const def = whimDef(state);
  const { current, target } = whimProgress(state);
  const status = state.fulfilled ? "✓ done" : `${current}/${target}`;
  return `**Today's whim:** ${def.offer} (${status})`;
}
