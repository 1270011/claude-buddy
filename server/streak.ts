/**
 * Session streaks for claude-buddy (additional-rewards FR2).
 *
 * A "streak" counts consecutive net-positive sessions — a session counts toward
 * the streak when it ends in a git commit (the existing `session_complete`
 * trigger). A session that ends with no commit breaks the streak.
 *
 * Streak state must outlive any single `session.$SID.json` snapshot (which is
 * session-scoped and re-baselined on every commit), so it lives in its own
 * account-scoped file, `streak.json`, alongside `xp.json`.
 *
 * Break detection (design §4.2 / risk R1): rather than inspecting snapshot
 * files — which `awardSessionComplete()` re-writes after every commit, making
 * "a snapshot exists" useless as a signal — we track the ordering of the two
 * lifecycle events directly. `recordSessionStart()` (fired once per session at
 * `session_start`) notices when the *previous* start was never followed by a
 * completion and resets the streak. This means a break is only detected at the
 * *next* session's start, not in real time — acceptable, and documented here so
 * it isn't mistaken for a bug.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path.ts";

// ─── State shape ──────────────────────────────────────────────────────────────

export interface StreakState {
  /** Consecutive net-positive (commit-ending) sessions. */
  current: number;
  /** Lifetime best; never decreases. */
  longest: number;
  /** Epoch seconds of the last `session_complete` (display only). */
  lastSessionAt: number;
  /**
   * Epoch seconds of the last `session_start` — internal, for break detection.
   * A start whose timestamp is newer than `lastSessionAt` means the previous
   * session never produced a commit, so the next start breaks the streak.
   */
  lastStartAt: number;
}

function emptyStreak(): StreakState {
  return { current: 0, longest: 0, lastSessionAt: 0, lastStartAt: 0 };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Atomic I/O (mirrors session.ts) ─────────────────────────────────────────

function streakFile(): string {
  return join(buddyStateDir(), "streak.json");
}

/**
 * Load the streak state, back-filling any missing fields so an absent or
 * partial `streak.json` reads as a clean zeroed streak (NFR1).
 */
export function loadStreak(): StreakState {
  try {
    const p = JSON.parse(readFileSync(streakFile(), "utf8")) as Partial<
      StreakState
    >;
    return {
      current: p.current ?? 0,
      longest: p.longest ?? 0,
      lastSessionAt: p.lastSessionAt ?? 0,
      lastStartAt: p.lastStartAt ?? 0,
    };
  } catch {
    return emptyStreak();
  }
}

export function saveStreak(state: StreakState): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = streakFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(state));
  }
}

// ─── Milestone bonus (pure) ──────────────────────────────────────────────────

/** A streak milestone is reached every this many net-positive sessions. */
export const STREAK_MILESTONE_INTERVAL = 3;
/** Hard cap on the streak bonus, kept well under SESSION_BONUS_CAP (120). */
export const STREAK_BONUS_CAP = 30;

/**
 * The bonus granted for the given streak length, before any multiplier.
 *
 * Zero except on a milestone (every STREAK_MILESTONE_INTERVAL sessions), where
 * it grows slowly with the milestone count and plateaus at STREAK_BONUS_CAP so
 * it can never dominate a single commit's reward (design §4.3 / NFR6):
 *
 *   3 → 12, 6 → 14, 9 → 16, … capped at 30.
 */
export function streakBonus(current: number): number {
  if (current <= 0 || current % STREAK_MILESTONE_INTERVAL !== 0) return 0;
  const tier = Math.floor(current / STREAK_MILESTONE_INTERVAL);
  return Math.min(10 + 2 * tier, STREAK_BONUS_CAP);
}

/** Whether the given streak length lands on a milestone (for loot triggers). */
export function isStreakMilestone(current: number): boolean {
  return current > 0 && current % STREAK_MILESTONE_INTERVAL === 0;
}

// ─── Lifecycle entry points ──────────────────────────────────────────────────

/**
 * Record a completed (commit-ending) session: increment the streak, update the
 * lifetime best, and return the milestone bonus to fold into the session
 * reward. Called from `awardSessionComplete()`.
 */
export function updateStreak(): number {
  const state = loadStreak();
  state.current += 1;
  if (state.current > state.longest) state.longest = state.current;
  state.lastSessionAt = nowSeconds();
  saveStreak(state);
  return streakBonus(state.current);
}

/**
 * Record a session start, breaking the streak first if the previous session
 * never completed. Called from the `session_start` hook path.
 *
 * The break rule: if the last start is newer than the last completion, the
 * session that started then never produced a commit, so the streak resets to
 * zero before this new session begins.
 */
export function recordSessionStart(): StreakState {
  const state = loadStreak();
  if (state.lastStartAt > state.lastSessionAt && state.current > 0) {
    state.current = 0;
  }
  state.lastStartAt = nowSeconds();
  saveStreak(state);
  return state;
}
