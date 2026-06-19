/**
 * Tests for session streaks (additional-rewards FR2).
 *
 * The bonus math is pure and pinned directly. The lifecycle entry points touch
 * the filesystem, so they run against a temp CLAUDE_CONFIG_DIR — `buddyStateDir()`
 * reads the env on every call, so setting it per-test keeps each case hermetic.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  streakBonus,
  isStreakMilestone,
  updateStreak,
  recordSessionStart,
  loadStreak,
  saveStreak,
  STREAK_BONUS_CAP,
  STREAK_MILESTONE_INTERVAL,
} from "./streak.ts";

// ─── Pure bonus math ──────────────────────────────────────────────────────────

describe("streakBonus", () => {
  test("is zero off a milestone", () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(0);
    expect(streakBonus(4)).toBe(0);
    expect(streakBonus(5)).toBe(0);
  });

  test("matches the documented values at the first milestones", () => {
    expect(streakBonus(3)).toBe(12); // 10 + 2*1
    expect(streakBonus(6)).toBe(14); // 10 + 2*2
    expect(streakBonus(9)).toBe(16); // 10 + 2*3
  });

  test("plateaus at the cap and never exceeds it", () => {
    expect(streakBonus(30)).toBe(STREAK_BONUS_CAP); // 10 + 2*10 = 30
    expect(streakBonus(33)).toBe(STREAK_BONUS_CAP); // 10 + 2*11 = 32 -> 30
    expect(streakBonus(300)).toBeLessThanOrEqual(STREAK_BONUS_CAP);
  });

  test("stays well under the 120 session-bonus cap (NFR6)", () => {
    for (let n = 0; n <= 300; n++) {
      expect(streakBonus(n)).toBeLessThanOrEqual(STREAK_BONUS_CAP);
    }
  });

  test("negative input is treated as no milestone", () => {
    expect(streakBonus(-3)).toBe(0);
  });
});

describe("isStreakMilestone", () => {
  test("true only on multiples of the interval", () => {
    expect(isStreakMilestone(0)).toBe(false);
    expect(isStreakMilestone(STREAK_MILESTONE_INTERVAL)).toBe(true);
    expect(isStreakMilestone(STREAK_MILESTONE_INTERVAL * 4)).toBe(true);
    expect(isStreakMilestone(STREAK_MILESTONE_INTERVAL + 1)).toBe(false);
  });
});

// ─── Lifecycle (filesystem-backed) ────────────────────────────────────────────

describe("streak lifecycle", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-streak-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("an absent streak.json loads as a zeroed streak", () => {
    expect(loadStreak()).toEqual({
      current: 0,
      longest: 0,
      lastSessionAt: 0,
      lastStartAt: 0,
    });
  });

  test("a partial streak.json back-fills missing fields", () => {
    saveStreak({ current: 4 } as never);
    const loaded = loadStreak();
    expect(loaded.current).toBe(4);
    expect(loaded.longest).toBe(0);
    expect(loaded.lastSessionAt).toBe(0);
    expect(loaded.lastStartAt).toBe(0);
  });

  test("consecutive completions increment the streak", () => {
    expect(updateStreak()).toBe(0); // current 1
    expect(updateStreak()).toBe(0); // current 2
    expect(updateStreak()).toBe(12); // current 3 -> milestone
    expect(loadStreak().current).toBe(3);
  });

  test("longest tracks the high-water mark and never decreases", () => {
    updateStreak();
    updateStreak();
    updateStreak(); // current 3, longest 3

    // A no-commit session breaks the streak, then one more completion.
    saveStreak({ ...loadStreak(), lastStartAt: loadStreak().lastSessionAt + 1 });
    recordSessionStart(); // current -> 0
    expect(loadStreak().current).toBe(0);
    expect(loadStreak().longest).toBe(3);

    updateStreak(); // current 1, longest still 3
    expect(loadStreak().current).toBe(1);
    expect(loadStreak().longest).toBe(3);
  });

  test("a session start after a completion does NOT break the streak", () => {
    updateStreak();
    updateStreak(); // current 2, lastSessionAt set

    // Simulate the prior start being older than the last completion (the
    // common case: a commit happened during the session).
    saveStreak({ ...loadStreak(), lastStartAt: loadStreak().lastSessionAt - 5 });
    recordSessionStart();
    expect(loadStreak().current).toBe(2);
  });

  test("a session start with no intervening completion breaks the streak", () => {
    updateStreak();
    updateStreak();
    updateStreak(); // current 3

    // Previous start is newer than the last completion -> that session never
    // committed.
    saveStreak({
      ...loadStreak(),
      lastStartAt: loadStreak().lastSessionAt + 100,
    });
    recordSessionStart();
    expect(loadStreak().current).toBe(0);
  });

  test("the very first session start never breaks (no prior session)", () => {
    recordSessionStart();
    const s = loadStreak();
    expect(s.current).toBe(0);
    expect(s.lastStartAt).toBeGreaterThan(0);
  });

  test("recordSessionStart always advances lastStartAt", () => {
    updateStreak();
    const before = loadStreak().lastStartAt;
    recordSessionStart();
    expect(loadStreak().lastStartAt).toBeGreaterThanOrEqual(before);
  });
});
