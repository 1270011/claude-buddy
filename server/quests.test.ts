/**
 * Tests for "Today's whim" (game-feel FR-B1/B2).
 *
 * whimForDate is pure. The lifecycle (loadWhim/tickWhim/whimProgress) touches
 * whims.json + the event counters + a loot roll, so those run against a temp
 * CLAUDE_CONFIG_DIR — quests/loot/xp all resolve their files at call time, so
 * per-test env keeps each case hermetic. tickWhim is always called with a
 * non-existent slot so the loot companion lookup is a safe no-op read.
 *
 * "Day" is injected via the optional `now: Date` arg, so rollover is tested
 * deterministically with no clock mocking.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  WHIMS,
  whimForDate,
  loadWhim,
  whimProgress,
  whimDef,
  tickWhim,
  formatWhimLine,
  todayStr,
} from "./quests.ts";
import { incrementEvent } from "./achievements.ts";

const SLOT = "whim-test-nonexistent-slot";
const DAY1 = new Date(2026, 5, 22, 10, 0, 0); // local 2026-06-22
const DAY2 = new Date(2026, 5, 23, 10, 0, 0); // local 2026-06-23

describe("whimForDate (pure)", () => {
  test("is deterministic for a given date", () => {
    expect(whimForDate("2026-06-22").id).toBe(whimForDate("2026-06-22").id);
  });

  test("always indexes within the catalog", () => {
    const ids = WHIMS.map((w) => w.id);
    for (const d of ["2026-06-22", "2026-06-23", "2026-01-01", "2025-12-31"]) {
      expect(ids).toContain(whimForDate(d).id);
    }
  });
});

describe("whim lifecycle (temp dir)", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-whim-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("offers a whim with zero progress and NO streak/coercion field", () => {
    const w = loadWhim(DAY1);
    expect(w.date).toBe(todayStr(DAY1));
    expect(w.fulfilled).toBe(false);
    expect(w.rewarded).toBe(false);
    expect(Object.keys(w)).not.toContain("streak");
    expect(Object.keys(w)).not.toContain("missed");
    expect(whimProgress(w).current).toBe(0);
  });

  test("progress tracks the metric delta, clamped to the target", () => {
    const def = whimDef(loadWhim(DAY1));
    for (let i = 0; i < def.target + 2; i++) incrementEvent(def.metric, 1);
    expect(whimProgress(loadWhim(DAY1)).current).toBe(def.target);
  });

  test("fulfilling the whim rewards exactly once (loot-only)", () => {
    const def = whimDef(loadWhim(DAY1));
    for (let i = 0; i < def.target; i++) incrementEvent(def.metric, 1);

    const first = tickWhim(SLOT, DAY1);
    expect(first.fulfilled).toBe(true);
    expect(first.justRewarded).toBe(true);

    const second = tickWhim(SLOT, DAY1);
    expect(second.fulfilled).toBe(true);
    expect(second.justRewarded).toBe(false); // no double reward
  });

  test("rolls a fresh whim at the next local day, discarding prior progress", () => {
    const def1 = whimDef(loadWhim(DAY1));
    incrementEvent(def1.metric, 1);

    const w2 = loadWhim(DAY2);
    expect(w2.date).toBe(todayStr(DAY2));
    expect(w2.fulfilled).toBe(false);
    // Baseline re-snapshotted at the new day → yesterday's bump doesn't count.
    expect(whimProgress(w2).current).toBe(0);
  });

  test("a partial/absent whims.json re-rolls cleanly", () => {
    // No file yet → loadWhim must synthesize a valid state.
    const w = loadWhim(DAY1);
    expect(WHIMS.map((x) => x.id)).toContain(w.whimId);
    expect(typeof w.baseline).toBe("number");
  });

  test("formatWhimLine shows progress, then done", () => {
    const def = whimDef(loadWhim(DAY1));
    expect(formatWhimLine(DAY1)).toContain(`0/${def.target}`);
    for (let i = 0; i < def.target; i++) incrementEvent(def.metric, 1);
    tickWhim(SLOT, DAY1);
    expect(formatWhimLine(DAY1)).toContain("done");
  });
});
