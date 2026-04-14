/**
 * Unit tests for achievements.ts
 *
 * Tests the achievement badge system: definitions, event counters,
 * threshold checks, per-slot scoping, and the pure check logic.
 * File I/O functions (checkAndAward, renderers) persist to disk and
 * are not tested here, consistent with the project policy in TESTING.md.
 */

import { describe, test, expect } from "bun:test";
import {
  ACHIEVEMENTS,
  COUNTER_KEYS,
  GLOBAL_KEYS,
  SLOT_KEYS,
  type EventCounters,
  type GlobalCounters,
  type SlotCounters,
} from "./achievements.ts";

const EMPTY_EVENTS: EventCounters = {
  errors_seen: 0,
  tests_failed: 0,
  large_diffs: 0,
  turns: 0,
  pets: 0,
  sessions: 0,
  reactions_given: 0,
  commands_run: 0,
  days_active: 0,
};

function makeEvents(overrides: Partial<EventCounters> = {}): EventCounters {
  return { ...EMPTY_EVENTS, ...overrides };
}

// ─── Achievement definitions ─────────────────────────────────────────────

describe("ACHIEVEMENTS array", () => {
  test("is non-empty", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThan(0);
  });

  test("every achievement has a unique id", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every achievement has required fields", () => {
    for (const ach of ACHIEVEMENTS) {
      expect(typeof ach.id).toBe("string");
      expect(ach.id.length).toBeGreaterThan(0);
      expect(typeof ach.name).toBe("string");
      expect(ach.name.length).toBeGreaterThan(0);
      expect(typeof ach.description).toBe("string");
      expect(ach.description.length).toBeGreaterThan(0);
      expect(typeof ach.icon).toBe("string");
      expect(typeof ach.secret).toBe("boolean");
      expect(typeof ach.check).toBe("function");
    }
  });

  test("check function accepts EventCounters and returns boolean", () => {
    for (const ach of ACHIEVEMENTS) {
      const result = ach.check(EMPTY_EVENTS);
      expect(typeof result).toBe("boolean");
    }
  });
});

// ─── Counter key partitions ──────────────────────────────────────────────

describe("counter key partitions", () => {
  test("GLOBAL_KEYS and SLOT_KEYS are disjoint", () => {
    const globalSet = new Set(GLOBAL_KEYS as string[]);
    const slotSet = new Set(SLOT_KEYS as string[]);
    for (const k of globalSet) {
      expect(slotSet.has(k)).toBe(false);
    }
  });

  test("COUNTER_KEYS is the union of GLOBAL_KEYS and SLOT_KEYS", () => {
    const counterSet = new Set(COUNTER_KEYS as string[]);
    for (const k of GLOBAL_KEYS) expect(counterSet.has(k)).toBe(true);
    for (const k of SLOT_KEYS) expect(counterSet.has(k)).toBe(true);
    expect(COUNTER_KEYS.length).toBe(GLOBAL_KEYS.length + SLOT_KEYS.length);
  });
});

// ─── COUNTER_KEYS ─────────────────────────────────────────────────────────

describe("COUNTER_KEYS", () => {
  test("matches every key in EventCounters", () => {
    const expectedKeys = Object.keys(EMPTY_EVENTS).sort() as (keyof EventCounters)[];
    const actualKeys = [...COUNTER_KEYS].sort() as (keyof EventCounters)[];
    expect(actualKeys).toEqual(expectedKeys);
  });
});

// ─── Achievement check thresholds ────────────────────────────────────────

describe("achievement thresholds", () => {
  test("first_steps always unlocks", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "first_steps")!;
    expect(ach).toBeDefined();
    expect(ach.check(EMPTY_EVENTS)).toBe(true);
  });

  test("good_boy requires 10 pets", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "good_boy")!;
    expect(ach.check(makeEvents({ pets: 9 }))).toBe(false);
    expect(ach.check(makeEvents({ pets: 10 }))).toBe(true);
    expect(ach.check(makeEvents({ pets: 50 }))).toBe(true);
  });

  test("best_friend requires 50 pets", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "best_friend")!;
    expect(ach.check(makeEvents({ pets: 49 }))).toBe(false);
    expect(ach.check(makeEvents({ pets: 50 }))).toBe(true);
  });

  test("bug_spotter requires 1 error", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "bug_spotter")!;
    expect(ach.check(makeEvents({ errors_seen: 0 }))).toBe(false);
    expect(ach.check(makeEvents({ errors_seen: 1 }))).toBe(true);
  });

  test("error_whisperer requires 25 errors", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "error_whisperer")!;
    expect(ach.check(makeEvents({ errors_seen: 24 }))).toBe(false);
    expect(ach.check(makeEvents({ errors_seen: 25 }))).toBe(true);
  });

  test("battle_scarred requires 100 errors and is secret", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "battle_scarred")!;
    expect(ach.secret).toBe(true);
    expect(ach.check(makeEvents({ errors_seen: 99 }))).toBe(false);
    expect(ach.check(makeEvents({ errors_seen: 100 }))).toBe(true);
  });

  test("test_witness requires 1 test failure", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "test_witness")!;
    expect(ach.check(makeEvents({ tests_failed: 0 }))).toBe(false);
    expect(ach.check(makeEvents({ tests_failed: 1 }))).toBe(true);
  });

  test("test_veteran requires 50 test failures", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "test_veteran")!;
    expect(ach.check(makeEvents({ tests_failed: 49 }))).toBe(false);
    expect(ach.check(makeEvents({ tests_failed: 50 }))).toBe(true);
  });

  test("big_mover requires 1 large diff", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "big_mover")!;
    expect(ach.check(makeEvents({ large_diffs: 0 }))).toBe(false);
    expect(ach.check(makeEvents({ large_diffs: 1 }))).toBe(true);
  });

  test("refactor_machine requires 10 large diffs", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "refactor_machine")!;
    expect(ach.check(makeEvents({ large_diffs: 9 }))).toBe(false);
    expect(ach.check(makeEvents({ large_diffs: 10 }))).toBe(true);
  });

  test("chatterbox requires 100 reactions", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "chatterbox")!;
    expect(ach.check(makeEvents({ reactions_given: 99 }))).toBe(false);
    expect(ach.check(makeEvents({ reactions_given: 100 }))).toBe(true);
  });

  test("week_streak requires 7 days and is not secret", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "week_streak")!;
    expect(ach.secret).toBe(false);
    expect(ach.check(makeEvents({ days_active: 6 }))).toBe(false);
    expect(ach.check(makeEvents({ days_active: 7 }))).toBe(true);
  });

  test("month_streak requires 30 days and is secret", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "month_streak")!;
    expect(ach.secret).toBe(true);
    expect(ach.check(makeEvents({ days_active: 29 }))).toBe(false);
    expect(ach.check(makeEvents({ days_active: 30 }))).toBe(true);
  });

  test("power_user requires 50 commands", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "power_user")!;
    expect(ach.check(makeEvents({ commands_run: 49 }))).toBe(false);
    expect(ach.check(makeEvents({ commands_run: 50 }))).toBe(true);
  });

  test("dedicated requires 200 turns", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "dedicated")!;
    expect(ach.check(makeEvents({ turns: 199 }))).toBe(false);
    expect(ach.check(makeEvents({ turns: 200 }))).toBe(true);
  });

  test("thousand_turns requires 1000 turns and is secret", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "thousand_turns")!;
    expect(ach.secret).toBe(true);
    expect(ach.check(makeEvents({ turns: 999 }))).toBe(false);
    expect(ach.check(makeEvents({ turns: 1000 }))).toBe(true);
  });
});

// ─── Unlock simulation (pure logic) ──────────────────────────────────────

describe("unlock simulation via check functions", () => {
  test("with empty events, only first_steps would unlock", () => {
    const wouldUnlock = ACHIEVEMENTS.filter((a) => a.check(EMPTY_EVENTS));
    expect(wouldUnlock.length).toBe(1);
    expect(wouldUnlock[0].id).toBe("first_steps");
  });

  test("with maxed events, all achievements would unlock", () => {
    const maxed = makeEvents({
      errors_seen: 999,
      tests_failed: 999,
      large_diffs: 999,
      turns: 9999,
      pets: 999,
      sessions: 999,
      reactions_given: 999,
      commands_run: 999,
      days_active: 999,
    });
    const wouldUnlock = ACHIEVEMENTS.filter((a) => a.check(maxed));
    expect(wouldUnlock.length).toBe(ACHIEVEMENTS.length);
  });

  test("progressive: more events satisfy more check functions", () => {
    const s1 = ACHIEVEMENTS.filter((a) => a.check(makeEvents())).length;
    const s2 = ACHIEVEMENTS.filter((a) => a.check(makeEvents({ pets: 10 }))).length;
    const s3 = ACHIEVEMENTS.filter((a) => a.check(makeEvents({ pets: 10, errors_seen: 25 }))).length;
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  test("achievements at exact threshold boundary", () => {
    const events = makeEvents({ pets: 10 });
    const ids = ACHIEVEMENTS.filter((a) => a.check(events)).map((a) => a.id);
    expect(ids).toContain("good_boy");
    expect(ids).toContain("first_steps");
    expect(ids).not.toContain("best_friend");
  });
});

// ─── Per-slot vs global scoping ───────────────────────────────────────────

describe("per-slot vs global counter scoping", () => {
  test("pets is a slot-scoped key", () => {
    expect((SLOT_KEYS as string[]).includes("pets")).toBe(true);
    expect((GLOBAL_KEYS as string[]).includes("pets")).toBe(false);
  });

  test("turns is a global key", () => {
    expect((GLOBAL_KEYS as string[]).includes("turns")).toBe(true);
    expect((SLOT_KEYS as string[]).includes("turns")).toBe(false);
  });

  test("reactions_given is a slot-scoped key", () => {
    expect((SLOT_KEYS as string[]).includes("reactions_given")).toBe(true);
  });

  test("errors_seen is a global key", () => {
    expect((GLOBAL_KEYS as string[]).includes("errors_seen")).toBe(true);
    expect((SLOT_KEYS as string[]).includes("errors_seen")).toBe(false);
  });

  test("tests_failed is a global key", () => {
    expect((GLOBAL_KEYS as string[]).includes("tests_failed")).toBe(true);
  });

  test("days_active is a global key", () => {
    expect((GLOBAL_KEYS as string[]).includes("days_active")).toBe(true);
  });

  test("commands_run is a global key", () => {
    expect((GLOBAL_KEYS as string[]).includes("commands_run")).toBe(true);
  });

  test("good_boy and best_friend check pets (slot-scoped)", () => {
    const good = ACHIEVEMENTS.find((a) => a.id === "good_boy")!;
    const best = ACHIEVEMENTS.find((a) => a.id === "best_friend")!;
    expect(good.check(makeEvents({ pets: 0 }))).toBe(false);
    expect(best.check(makeEvents({ pets: 0 }))).toBe(false);
    expect(good.check(makeEvents({ pets: 10 }))).toBe(true);
    expect(best.check(makeEvents({ pets: 50 }))).toBe(true);
  });

  test("dedicated and thousand_turns check turns (global)", () => {
    const ded = ACHIEVEMENTS.find((a) => a.id === "dedicated")!;
    const thou = ACHIEVEMENTS.find((a) => a.id === "thousand_turns")!;
    expect(ded.check(makeEvents({ turns: 200 }))).toBe(true);
    expect(thou.check(makeEvents({ turns: 1000 }))).toBe(true);
  });

  test("chatterbox checks reactions_given (slot-scoped)", () => {
    const ach = ACHIEVEMENTS.find((a) => a.id === "chatterbox")!;
    expect(ach.check(makeEvents({ reactions_given: 100 }))).toBe(true);
  });
});

// ─── Secret achievement visibility ───────────────────────────────────────

describe("secret achievements", () => {
  test("secret achievements are correctly flagged", () => {
    const secretIds = ACHIEVEMENTS.filter((a) => a.secret).map((a) => a.id);
    expect(secretIds).toContain("battle_scarred");
    expect(secretIds).toContain("month_streak");
    expect(secretIds).toContain("thousand_turns");
  });

  test("non-secret achievements are the majority", () => {
    const nonSecret = ACHIEVEMENTS.filter((a) => !a.secret);
    expect(nonSecret.length).toBeGreaterThan(0);
    const secret = ACHIEVEMENTS.filter((a) => a.secret);
    expect(nonSecret.length).toBeGreaterThan(secret.length);
  });
});

// ─── EventCounters shape ─────────────────────────────────────────────────

describe("EventCounters", () => {
  test("EMPTY_EVENTS has all counter keys set to 0", () => {
    for (const key of COUNTER_KEYS) {
      expect(EMPTY_EVENTS[key]).toBe(0);
    }
  });

  test("all counter keys are numeric fields", () => {
    for (const key of COUNTER_KEYS) {
      expect(typeof EMPTY_EVENTS[key]).toBe("number");
    }
  });
});
