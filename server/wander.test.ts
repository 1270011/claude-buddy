/**
 * Unit tests for the idle-wander core (server/wander.ts).
 *
 * buildWanderSequence is a pure, seeded random walk: the same opts.seed must
 * always yield the exact same arrays, the walk must read as walking (|Δ| ≤ 1,
 * never teleporting), and hops must rise and fully return to the floor. These
 * tests pin that contract — no I/O, fixed seeds. (Design §4 / §9.)
 */

import { describe, test, expect } from "bun:test";
import {
  buildWanderSequence,
  moodWalkOpts,
  type WanderOpts,
} from "./wander.ts";

const baseOpts = (over: Partial<WanderOpts> = {}): WanderOpts => ({
  range: 6,
  length: 180,
  dwellMin: 3,
  dwellMax: 9,
  stepEvery: 1,
  hopHeight: 0,
  seed: 12345,
  ...over,
});

// ─── buildWanderSequence: shape & bounds ─────────────────────────────────────

describe("buildWanderSequence — shape & bounds", () => {
  test("returns exactly `length` horizontal entries", () => {
    const { horizontal } = buildWanderSequence(baseOpts({ length: 200 }));
    expect(horizontal.length).toBe(200);
  });

  test("every horizontal entry is within [0, range]", () => {
    const range = 6;
    const { horizontal } = buildWanderSequence(baseOpts({ range }));
    for (const v of horizontal) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(range);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test("starts at home (offset 0)", () => {
    const { horizontal } = buildWanderSequence(baseOpts());
    expect(horizontal[0]).toBe(0);
  });

  test("range 0 ⇒ buddy never leaves home", () => {
    const { horizontal } = buildWanderSequence(baseOpts({ range: 0 }));
    expect(horizontal.every((v) => v === 0)).toBe(true);
  });
});

// ─── buildWanderSequence: motion reads as walking ────────────────────────────

describe("buildWanderSequence — steps, never teleports", () => {
  test("adjacent horizontal entries differ by at most 1", () => {
    const { horizontal } = buildWanderSequence(baseOpts());
    for (let i = 1; i < horizontal.length; i++) {
      expect(Math.abs(horizontal[i] - horizontal[i - 1])).toBeLessThanOrEqual(1);
    }
  });

  test("stepEvery=2 ⇒ value changes at most every other tick", () => {
    const { horizontal } = buildWanderSequence(baseOpts({ stepEvery: 2 }));
    for (let i = 1; i < horizontal.length; i++) {
      const changedNow = horizontal[i] !== horizontal[i - 1];
      const changedPrev = i >= 2 && horizontal[i - 1] !== horizontal[i - 2];
      // Two consecutive changes would mean a step faster than stepEvery.
      expect(changedNow && changedPrev).toBe(false);
    }
  });

  test("contains at least one dwell run >= dwellMin", () => {
    const dwellMin = 5;
    const { horizontal } = buildWanderSequence(
      baseOpts({ dwellMin, dwellMax: 12, length: 400 }),
    );
    let longest = 1;
    let run = 1;
    for (let i = 1; i < horizontal.length; i++) {
      run = horizontal[i] === horizontal[i - 1] ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    expect(longest).toBeGreaterThanOrEqual(dwellMin);
  });
});

// ─── buildWanderSequence: determinism ────────────────────────────────────────

describe("buildWanderSequence — determinism", () => {
  test("same seed ⇒ identical horizontal arrays", () => {
    const a = buildWanderSequence(baseOpts({ seed: 777 }));
    const b = buildWanderSequence(baseOpts({ seed: 777 }));
    expect(a.horizontal).toEqual(b.horizontal);
  });

  test("different seeds ⇒ different walks", () => {
    const a = buildWanderSequence(baseOpts({ seed: 1 }));
    const b = buildWanderSequence(baseOpts({ seed: 2 }));
    expect(a.horizontal).not.toEqual(b.horizontal);
  });
});

// ─── buildWanderSequence: hop arc (§7.A) ─────────────────────────────────────

describe("buildWanderSequence — hop arc", () => {
  test("hopHeight=0 ⇒ vertical is undefined", () => {
    const { vertical } = buildWanderSequence(baseOpts({ hopHeight: 0 }));
    expect(vertical).toBeUndefined();
  });

  test("hopHeight>0 ⇒ vertical entries within [0, hopHeight]", () => {
    const hopHeight = 2;
    const { vertical } = buildWanderSequence(baseOpts({ hopHeight }));
    expect(vertical).toBeDefined();
    expect(vertical!.length).toBe(180);
    for (const v of vertical!) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(hopHeight);
    }
  });

  test("each hop rises to the peak and returns to 0 (complete arc)", () => {
    const hopHeight = 2;
    const { vertical } = buildWanderSequence(
      baseOpts({ hopHeight, length: 400 }),
    );
    const v = vertical!;
    // The track is 0-baseline with bounded arcs; collect maximal nonzero runs.
    let sawPeak = false;
    let i = 0;
    while (i < v.length) {
      if (v[i] === 0) {
        i++;
        continue;
      }
      const start = i;
      while (i < v.length && v[i] > 0) i++;
      const end = i; // exclusive; v[end] is 0 or end-of-array
      const run = v.slice(start, end);
      // Bounded by 0 on both sides (rises from 0, returns to 0).
      if (start > 0) expect(v[start - 1]).toBe(0);
      if (end < v.length) expect(v[end]).toBe(0);
      // Arc reaches the peak and is non-empty.
      expect(Math.max(...run)).toBe(hopHeight);
      sawPeak = true;
    }
    expect(sawPeak).toBe(true);
  });

  test("hop arcs are deterministic for the same seed", () => {
    const a = buildWanderSequence(baseOpts({ hopHeight: 2, seed: 99 }));
    const b = buildWanderSequence(baseOpts({ hopHeight: 2, seed: 99 }));
    expect(a.vertical).toEqual(b.vertical);
  });
});

// ─── moodWalkOpts (§7.D) — read-only personality map ─────────────────────────

describe("moodWalkOpts", () => {
  test("maps every mood to its §7.D personality (level 0, no nudge)", () => {
    // The design's §7.D table, pinned exactly: range / dwell / stepEvery.
    const table: Record<
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
    for (const [mood, want] of Object.entries(table)) {
      const got = moodWalkOpts(mood, 0, 1);
      expect({
        range: got.range,
        dwellMin: got.dwellMin,
        dwellMax: got.dwellMax,
        stepEvery: got.stepEvery,
      }).toEqual(want);
    }
  });

  test("excited ranges wider and dwells shorter than tired", () => {
    const excited = moodWalkOpts("excited", 1, 42);
    const tired = moodWalkOpts("tired", 1, 42);
    expect(excited.range).toBeGreaterThan(tired.range);
    expect(excited.dwellMax).toBeLessThan(tired.dwellMin);
  });

  test("tired shuffles slowly (stepEvery=2, small range, long dwell)", () => {
    const tired = moodWalkOpts("tired", 1, 42);
    expect(tired.stepEvery).toBe(2);
    expect(tired.range).toBeLessThanOrEqual(4);
    expect(tired.dwellMin).toBeGreaterThanOrEqual(18);
  });

  test("unknown mood falls back to the calm focused baseline", () => {
    const unknown = moodWalkOpts("nonsense", 0, 42);
    const focused = moodWalkOpts("focused", 0, 42);
    expect(unknown).toEqual(focused);
  });

  test("level nudges range by min(2, floor(level/10))", () => {
    expect(moodWalkOpts("happy", 0, 1).range).toBe(4);
    expect(moodWalkOpts("happy", 10, 1).range).toBe(5);
    expect(moodWalkOpts("happy", 50, 1).range).toBe(6); // capped at +2
  });

  test("hop amplitude bumps to 2 at level >= 20", () => {
    expect(moodWalkOpts("happy", 19, 1).hopHeight).toBe(1);
    expect(moodWalkOpts("happy", 20, 1).hopHeight).toBe(2);
  });

  test("is a pure function of its inputs (same args ⇒ identical opts)", () => {
    const a = moodWalkOpts("excited", 7, 12345);
    const b = moodWalkOpts("excited", 7, 12345);
    expect(a).toEqual(b);
    // Read-only: the seed is threaded straight through, nothing else observed.
    expect(a.seed).toBe(12345);
  });

  test("opts feed straight into a buildable walk", () => {
    const opts = moodWalkOpts("chaotic", 5, 2024);
    const { horizontal } = buildWanderSequence(opts);
    expect(horizontal.length).toBe(opts.length);
    expect(Math.max(...horizontal)).toBeLessThanOrEqual(opts.range);
  });
});
