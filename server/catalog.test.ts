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
} from "./xp.ts";

const ALL = [...UNLOCKABLE_REACTIONS, ...UNLOCKABLE_UPGRADES];

describe("catalog coverage", () => {
  test("every level 2..20 has at least one purchasable unlock", () => {
    const levels = new Set(ALL.map((i) => i.level));
    const missing: number[] = [];
    for (let l = 2; l <= MAX_LEVEL; l++) {
      if (!levels.has(l)) missing.push(l);
    }
    expect(missing).toEqual([]);
  });

  test("no unlock gates below level 2 or above MAX_LEVEL", () => {
    for (const i of ALL) {
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
    for (const i of ALL) if (i.level <= 5) expect(i.cost).toBeLessThan(3);
  });

  test("endgame unlocks (>=16) never cost 1", () => {
    for (const i of ALL) if (i.level >= 16) expect(i.cost).toBeGreaterThan(1);
  });

  test("all costs are within 1..3", () => {
    for (const i of ALL) {
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
  const totalCost = ALL.reduce((s, i) => s + i.cost, 0);
  const budget = pointsForLevel(MAX_LEVEL);

  test("a maxed player cannot afford the entire catalog", () => {
    expect(totalCost).toBeGreaterThan(budget); // > 39
  });

  test("but can afford a clear majority of it", () => {
    expect(budget).toBeGreaterThan(totalCost / 2); // owns more than half
  });
});

describe("effect invariants", () => {
  test("hat and stat effects are non-refundable (level >= lock level)", () => {
    for (const u of UNLOCKABLE_UPGRADES) {
      if (u.effect && (u.effect.type === "hat" || u.effect.type === "stat")) {
        expect(u.level).toBeGreaterThanOrEqual(RESPEC_LOCK_LEVEL);
      }
    }
  });

  test("prestige unlocks carry no companion effect (titles via equipTitle)", () => {
    for (const u of UNLOCKABLE_UPGRADES) {
      if (u.category === "prestige") expect(u.effect).toBeUndefined();
    }
  });
});
