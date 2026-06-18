/**
 * Session-completion bonus for claude-buddy.
 *
 * A "session" runs from the first hook activity (or the previous commit) up to
 * the next git commit. When react.sh detects a commit it fires
 * `award-xp.ts session_complete`, which awards a bonus scaled by the work done
 * since the session baseline was captured.
 *
 * The baseline is a snapshot of the relevant lifetime counters from events.json
 * (maintained by react.sh / achievements.ts). On commit we diff the current
 * counters against the baseline, award the bonus, then re-baseline so the next
 * session starts fresh. This reuses the existing counters — no second tally to
 * keep in sync.
 *
 * State: session.$SID.json, session-scoped via the same $SID as reactions, and
 * cleaned up on uninstall (see TRANSIENT_PREFIXES in state.ts).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path.ts";
import { sessionId } from "./state.ts";
import { loadGlobalEvents, type GlobalCounters } from "./achievements.ts";
import { awardXpAmount, rarityMultiplier, type XpState } from "./xp.ts";
import type { Species, Rarity } from "./engine.ts";

// ─── Counters that feed the bonus ────────────────────────────────────────────

/** The slice of lifetime counters the session bonus cares about. */
export interface SessionCounters {
  all_green: number; // green test runs
  large_diffs: number; // substantive changes
  errors_seen: number; // errors worked through
  commits_made: number; // baseline only — not scored
}

export interface SessionSnapshot {
  startedAt: number; // epoch seconds
  baseline: SessionCounters;
}

function extractCounters(g: GlobalCounters): SessionCounters {
  return {
    all_green: g.all_green,
    large_diffs: g.large_diffs,
    errors_seen: g.errors_seen,
    commits_made: g.commits_made,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Snapshot I/O (atomic, session-scoped) ───────────────────────────────────

function snapshotFile(): string {
  return join(buddyStateDir(), `session.${sessionId()}.json`);
}

export function loadSnapshot(): SessionSnapshot | null {
  try {
    return JSON.parse(readFileSync(snapshotFile(), "utf8")) as SessionSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: SessionSnapshot): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = snapshotFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(snapshot));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(snapshot));
  }
}

// ─── Bonus computation (pure) ────────────────────────────────────────────────

/**
 * Per-event diff between the current counters and a baseline, clamped to ≥ 0
 * (counters only ever grow, but a missing/younger baseline shouldn't go
 * negative).
 */
export function counterDelta(
  current: SessionCounters,
  baseline: SessionCounters,
): SessionCounters {
  const d = (a: number, b: number): number => Math.max(0, a - b);
  return {
    all_green: d(current.all_green, baseline.all_green),
    large_diffs: d(current.large_diffs, baseline.large_diffs),
    errors_seen: d(current.errors_seen, baseline.errors_seen),
    commits_made: d(current.commits_made, baseline.commits_made),
  };
}

/** Hard cap on the raw session bonus, before any multiplier. */
export const SESSION_BONUS_CAP = 120;
/** Base award for committing at all. */
export const SESSION_BASE_BONUS = 30;

/**
 * Compute the session-completion bonus from a counter delta. Weighted with
 * per-event diminishing caps so a single giant session can't dwarf the curve,
 * then capped at SESSION_BONUS_CAP. Species/rarity multipliers are applied by
 * the caller (Phase 4) — this stays a pure, deterministic function of the work.
 */
export function computeSessionBonus(delta: SessionCounters): number {
  const raw =
    SESSION_BASE_BONUS +
    8 * Math.min(delta.all_green, 6) +
    5 * Math.min(delta.large_diffs, 4) +
    4 * Math.min(delta.errors_seen, 5);
  return Math.min(raw, SESSION_BONUS_CAP);
}

// ─── Lifecycle entry points (called from award-xp.ts) ────────────────────────

/** Capture the baseline at the start of a session (overwrites any stale one). */
export function startSession(): SessionSnapshot {
  const snapshot: SessionSnapshot = {
    startedAt: nowSeconds(),
    baseline: extractCounters(loadGlobalEvents()),
  };
  saveSnapshot(snapshot);
  return snapshot;
}

export interface SessionCompletion {
  bonus: number;
  state: XpState;
}

/**
 * Award the session-completion bonus on commit, then re-baseline for the next
 * session. If no baseline exists yet (first commit before any session_start),
 * the delta is zero and only the base bonus is granted.
 */
export function awardSessionComplete(
  slot?: string,
  species?: Species,
  rarity?: Rarity,
): SessionCompletion {
  const current = extractCounters(loadGlobalEvents());
  const snapshot = loadSnapshot();
  const baseline = snapshot?.baseline ?? current;

  // Cap the raw bonus first (§3.2), then apply the global rarity multiplier.
  const raw = computeSessionBonus(counterDelta(current, baseline));
  const bonus = Math.floor(raw * rarityMultiplier(rarity));
  const state = awardXpAmount(bonus, slot, species, rarity);

  // Re-baseline: the next session starts counting from here.
  saveSnapshot({ startedAt: nowSeconds(), baseline: current });

  return { bonus, state };
}
