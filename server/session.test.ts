/**
 * Unit tests for the pure session-bonus helpers in session.ts.
 *
 * The snapshot I/O and the awardSessionComplete orchestration touch the
 * filesystem and the XP store, so they belong in an integration suite with a
 * temp state dir. The bonus math and the counter diff are pure and pinned here.
 */

import { describe, test, expect } from "bun:test";
import {
  computeSessionBonus,
  counterDelta,
  SESSION_BASE_BONUS,
  SESSION_BONUS_CAP,
  type SessionCounters,
} from "./session.ts";

const ZERO: SessionCounters = {
  all_green: 0,
  large_diffs: 0,
  errors_seen: 0,
  commits_made: 0,
};

describe("computeSessionBonus", () => {
  test("a no-work commit grants only the base bonus", () => {
    expect(computeSessionBonus(ZERO)).toBe(SESSION_BASE_BONUS);
  });

  test("matches the documented worked example", () => {
    // 3 green runs, 1 big diff, 2 errors → 30 + 24 + 5 + 8 = 67
    const delta: SessionCounters = {
      all_green: 3,
      large_diffs: 1,
      errors_seen: 2,
      commits_made: 1,
    };
    expect(computeSessionBonus(delta)).toBe(67);
  });

  test("commits_made does not contribute to the score", () => {
    const delta: SessionCounters = { ...ZERO, commits_made: 9 };
    expect(computeSessionBonus(delta)).toBe(SESSION_BASE_BONUS);
  });

  test("applies per-event diminishing caps", () => {
    // Each term saturates: 8·6 + 5·4 + 4·5 = 48 + 20 + 20 = 88, +30 base = 118
    const flooded: SessionCounters = {
      all_green: 100,
      large_diffs: 100,
      errors_seen: 100,
      commits_made: 100,
    };
    expect(computeSessionBonus(flooded)).toBe(118);
  });

  test("never exceeds the hard cap", () => {
    const flooded: SessionCounters = {
      all_green: 9999,
      large_diffs: 9999,
      errors_seen: 9999,
      commits_made: 9999,
    };
    expect(computeSessionBonus(flooded)).toBeLessThanOrEqual(SESSION_BONUS_CAP);
  });

  test("each individual term scales until its cap", () => {
    expect(computeSessionBonus({ ...ZERO, all_green: 1 })).toBe(38); // 30 + 8
    expect(computeSessionBonus({ ...ZERO, large_diffs: 1 })).toBe(35); // 30 + 5
    expect(computeSessionBonus({ ...ZERO, errors_seen: 1 })).toBe(34); // 30 + 4
  });
});

describe("counterDelta", () => {
  test("subtracts the baseline from the current counters", () => {
    const current: SessionCounters = {
      all_green: 5,
      large_diffs: 3,
      errors_seen: 4,
      commits_made: 2,
    };
    const baseline: SessionCounters = {
      all_green: 2,
      large_diffs: 1,
      errors_seen: 4,
      commits_made: 1,
    };
    expect(counterDelta(current, baseline)).toEqual({
      all_green: 3,
      large_diffs: 2,
      errors_seen: 0,
      commits_made: 1,
    });
  });

  test("clamps to zero when a baseline somehow exceeds current", () => {
    const current: SessionCounters = { ...ZERO, all_green: 1 };
    const baseline: SessionCounters = { ...ZERO, all_green: 5 };
    expect(counterDelta(current, baseline).all_green).toBe(0);
  });

  test("an unchanged session yields an all-zero delta", () => {
    const snap: SessionCounters = {
      all_green: 7,
      large_diffs: 2,
      errors_seen: 1,
      commits_made: 3,
    };
    expect(counterDelta(snap, snap)).toEqual(ZERO);
  });
});
