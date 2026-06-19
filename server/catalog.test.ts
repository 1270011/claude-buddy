/**
 * Catalog-integrity tests: structural guarantees about the unlock catalog that
 * the design promises — full level coverage, sane cost tiers, category spread,
 * a budget that forbids owning everything, and the non-refundable invariant for
 * stat/hat effects. All pure (operates on the exported catalog arrays).
 */

import { describe, test, expect } from "bun:test";
import {
  UNLOCKABLE_REACTIONS,
  UNLOCKABLE_UPGRADES,
  pointsForLevel,
  unlockCost,
  MAX_LEVEL,
  RESPEC_LOCK_LEVEL,
  PRESTIGE_MAX,
} from "./xp.ts";

const ALL = [...UNLOCKABLE_REACTIONS, ...UNLOCKABLE_UPGRADES];
// The prestige-exclusive tier is gated by prestigeLevel, not level, and has its
// own cost band (2..4) — the base-economy invariants below scope to BASE so
// they keep describing the level-gated catalog, while PRESTIGE has its own block.
const BASE = ALL.filter((i) => i.prestigeLevel === undefined);
const PRESTIGE = ALL.filter((i) => i.prestigeLevel !== undefined);

describe("catalog coverage", () => {
  test("every level 2..20 has at least one purchasable unlock", () => {
    const levels = new Set(ALL.map((i) => i.level));
    const missing: number[] = [];
    for (let l = 2; l <= MAX_LEVEL; l++) {
      if (!levels.has(l)) missing.push(l);
    }
    expect(missing).toEqual([]);
  });

  test("no base unlock gates below level 2 or above MAX_LEVEL", () => {
    for (const i of BASE) {
      expect(i.level).toBeGreaterThanOrEqual(2);
      expect(i.level).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
});

describe("catalog ids", () => {
  test("ids are unique across both catalogs", () => {
    const ids = ALL.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("unlockCost agrees with each item's cost", () => {
    for (const i of ALL) expect(unlockCost(i.id)).toBe(i.cost);
  });
});

describe("cost tiers rise with level", () => {
  test("early unlocks (<=5) never cost 3", () => {
    for (const i of BASE) if (i.level <= 5) expect(i.cost).toBeLessThan(3);
  });

  test("endgame unlocks (>=16) never cost 1", () => {
    for (const i of BASE) if (i.level >= 16) expect(i.cost).toBeGreaterThan(1);
  });

  test("all base costs are within 1..3", () => {
    for (const i of BASE) {
      expect(i.cost).toBeGreaterThanOrEqual(1);
      expect(i.cost).toBeLessThanOrEqual(3);
    }
  });
});

describe("category distribution", () => {
  test("spans all four categories", () => {
    const cats = new Set(ALL.map((i) => i.category));
    expect(cats).toContain("cosmetic");
    expect(cats).toContain("behavioral");
    expect(cats).toContain("stat");
    expect(cats).toContain("prestige");
  });

  test("behavioral unlocks are reactions (so they surface via buddy_pet)", () => {
    for (const r of UNLOCKABLE_REACTIONS) expect(r.category).toBe("behavioral");
  });
});

describe("budget keeps 'most but not all'", () => {
  // The single-playthrough budget covers the base catalog; prestige items are
  // bought from the fresh post-ascension budget, so they're excluded here.
  const totalCost = BASE.reduce((s, i) => s + i.cost, 0);
  const budget = pointsForLevel(MAX_LEVEL);

  test("a maxed player cannot afford the entire catalog", () => {
    expect(totalCost).toBeGreaterThan(budget); // > 39
  });

  test("but can afford a clear majority of it", () => {
    expect(budget).toBeGreaterThan(totalCost / 2); // owns more than half
  });
});

describe("effect invariants", () => {
  test("hat and stat effects are non-refundable (locked level, or prestige)", () => {
    // Both revert lossily, so they must be unreachable by a refund: either
    // gated at/above the respec-lock level, or prestige-tier (permanent).
    for (const u of UNLOCKABLE_UPGRADES) {
      if (u.effect && (u.effect.type === "hat" || u.effect.type === "stat")) {
        const nonRefundable =
          u.level >= RESPEC_LOCK_LEVEL || u.prestigeLevel !== undefined;
        expect(nonRefundable).toBe(true);
      }
    }
  });

  test("prestige titles carry no companion effect (titles via equipTitle)", () => {
    for (const u of UNLOCKABLE_UPGRADES) {
      if (u.category === "prestige") expect(u.effect).toBeUndefined();
    }
  });
});

describe("prestige-exclusive tier (additional-rewards FR1.4)", () => {
  test("there are prestige-gated items spanning the design's 1..MAX tiers", () => {
    expect(PRESTIGE.length).toBeGreaterThan(0);
    for (const i of PRESTIGE) {
      expect(i.prestigeLevel).toBeGreaterThanOrEqual(1);
      expect(i.prestigeLevel).toBeLessThanOrEqual(PRESTIGE_MAX);
    }
  });

  test("prestige costs sit in the 2..4 band (design §3.4)", () => {
    for (const i of PRESTIGE) {
      expect(i.cost).toBeGreaterThanOrEqual(2);
      expect(i.cost).toBeLessThanOrEqual(4);
    }
  });

  test("prestige items reuse the existing four categories (no 5th)", () => {
    const valid = new Set(["cosmetic", "behavioral", "stat", "prestige"]);
    for (const i of PRESTIGE) expect(valid.has(i.category)).toBe(true);
  });

  test("the top tier is reachable (an item gated at PRESTIGE_MAX exists)", () => {
    expect(PRESTIGE.some((i) => i.prestigeLevel === PRESTIGE_MAX)).toBe(true);
  });
});
