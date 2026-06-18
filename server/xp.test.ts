/**
 * Unit tests for the pure leveling/skill-point helpers in xp.ts.
 *
 * Like state.test.ts, this suite covers only the pure functions — the file I/O
 * paths (loadXpState/saveXpState against xp.json) belong in a separate
 * integration suite with a temp state dir. Migration logic is deliberately
 * factored into the pure backfillXpState() so it can be pinned down here.
 */

import { describe, test, expect } from "bun:test";
import {
  pointsForLevel,
  backfillXpState,
  availablePoints,
  unlockCost,
  computeLevel,
  purchaseError,
  refundError,
  rarityMultiplier,
  RESPEC_LOCK_LEVEL,
  type XpState,
} from "./xp.ts";
import type { Companion } from "./engine.ts";

/** Build a full XpState from a partial, for guard tests. */
function makeState(partial: Partial<XpState>): XpState {
  return {
    totalXp: 0,
    level: 1,
    unlockedReactions: [],
    unlockedUpgrades: [],
    cosmeticFlags: [],
    levelUpAchieved: false,
    pointsTotal: 0,
    pointsSpent: 0,
    respecLockedAt: null,
    title: null,
    ...partial,
  };
}

/** Minimal companion stub — purchaseError only reads bones.species/rarity. */
function stubCompanion(species: string, rarity: string): Companion {
  return { bones: { species, rarity } } as unknown as Companion;
}

describe("pointsForLevel", () => {
  test("level 1 grants no points", () => {
    expect(pointsForLevel(1)).toBe(0);
  });

  test("tier boundaries match the grant table", () => {
    expect(pointsForLevel(2)).toBe(1); // first point at L2
    expect(pointsForLevel(5)).toBe(4); // L2–5: 1 each
    expect(pointsForLevel(6)).toBe(6); // +2 at L6
    expect(pointsForLevel(10)).toBe(14); // through the mid tier
    expect(pointsForLevel(15)).toBe(24); // end of the 2/level tier
    expect(pointsForLevel(16)).toBe(27); // +3 at L16
    expect(pointsForLevel(20)).toBe(39); // documented total at max
  });

  test("is monotonic across all levels", () => {
    for (let l = 2; l <= 20; l++) {
      expect(pointsForLevel(l)).toBeGreaterThanOrEqual(pointsForLevel(l - 1));
    }
  });

  test("clamps at MAX_LEVEL", () => {
    expect(pointsForLevel(25)).toBe(pointsForLevel(20));
  });
});

describe("unlockCost", () => {
  test("returns the cost of a known reaction", () => {
    expect(unlockCost("celebrate_level5")).toBe(1);
    expect(unlockCost("boss_fight_level8")).toBe(2);
  });

  test("returns the cost of a known upgrade", () => {
    expect(unlockCost("bonus_eye")).toBe(1);
    expect(unlockCost("extra_hat_slot")).toBe(3);
  });

  test("returns 0 for an unknown id", () => {
    expect(unlockCost("does_not_exist")).toBe(0);
  });
});

describe("availablePoints", () => {
  const base: XpState = {
    totalXp: 0,
    level: 1,
    unlockedReactions: [],
    unlockedUpgrades: [],
    cosmeticFlags: [],
    levelUpAchieved: false,
    pointsTotal: 0,
    pointsSpent: 0,
    respecLockedAt: null,
    title: null,
  };

  test("is total minus spent", () => {
    expect(availablePoints({ ...base, pointsTotal: 10, pointsSpent: 3 })).toBe(7);
  });

  test("never goes negative", () => {
    expect(availablePoints({ ...base, pointsTotal: 2, pointsSpent: 5 })).toBe(0);
  });
});

describe("backfillXpState — fresh/empty", () => {
  test("null yields valid defaults", () => {
    const s = backfillXpState(null);
    expect(s.totalXp).toBe(0);
    expect(s.level).toBe(1);
    expect(s.unlockedReactions).toEqual([]);
    expect(s.unlockedUpgrades).toEqual([]);
    expect(s.cosmeticFlags).toEqual([]);
    expect(s.levelUpAchieved).toBe(false);
    expect(s.pointsTotal).toBe(0);
    expect(s.pointsSpent).toBe(0);
    expect(s.respecLockedAt).toBeNull();
    expect(s.title).toBeNull();
  });

  test("missing arrays are coerced to empty", () => {
    const s = backfillXpState({ totalXp: 0 } as Partial<XpState>);
    expect(s.unlockedReactions).toEqual([]);
    expect(s.unlockedUpgrades).toEqual([]);
  });
});

describe("backfillXpState — legacy migration (no points fields)", () => {
  // A pre-points xp.json: owned unlocks were auto-granted, no economy fields.
  const legacy = {
    totalXp: 10000, // → level 12
    level: 12,
    unlockedReactions: [
      "celebrate_level5",
      "boss_fight_level8",
      "zen_mode_level10",
      "debug_sprint_level12",
    ],
    unlockedUpgrades: ["bonus_eye", "shiny_aura", "stat_boost"],
    cosmeticFlags: [],
    levelUpAchieved: false,
  } as Partial<XpState>;

  test("recomputes level from totalXp", () => {
    expect(backfillXpState(legacy).level).toBe(computeLevel(10000));
  });

  test("derives pointsTotal from the level", () => {
    expect(backfillXpState(legacy).pointsTotal).toBe(pointsForLevel(12));
  });

  test("preserves every owned unlock (US5 — nobody loses anything)", () => {
    const s = backfillXpState(legacy);
    expect(s.unlockedReactions).toEqual(legacy.unlockedReactions!);
    expect(s.unlockedUpgrades).toEqual(legacy.unlockedUpgrades!);
  });

  test("grandfathers owned cost into pointsSpent, clamped to pointsTotal", () => {
    const s = backfillXpState(legacy);
    // reactions 1+2+2+2 = 7, upgrades 1+2+2 = 5 → 12 spent, ≤ 18 total
    expect(s.pointsSpent).toBe(12);
    expect(s.pointsSpent).toBeLessThanOrEqual(s.pointsTotal);
    expect(availablePoints(s)).toBe(6);
  });

  test("locks respec when migrated at/above the lock level", () => {
    expect(backfillXpState(legacy).respecLockedAt).toBe(RESPEC_LOCK_LEVEL);
  });
});

describe("backfillXpState — over-unlocked legacy (clamp safety)", () => {
  // Pathological: more owned than the level's points would buy. Must not crash
  // and must not produce negative available points.
  const overUnlocked = {
    totalXp: 100, // → level 2, pointsTotal 1
    unlockedUpgrades: ["bonus_eye", "shiny_aura", "stat_boost", "extra_hat_slot"],
  } as Partial<XpState>;

  test("keeps all owned items but caps pointsSpent at pointsTotal", () => {
    const s = backfillXpState(overUnlocked);
    expect(s.unlockedUpgrades).toHaveLength(4);
    expect(s.pointsSpent).toBe(s.pointsTotal);
    expect(availablePoints(s)).toBe(0);
  });
});

describe("backfillXpState — self-healing & passthrough", () => {
  test("recomputes a stale level field from totalXp", () => {
    const s = backfillXpState({ totalXp: 6000, level: 1 } as Partial<XpState>);
    expect(s.level).toBe(computeLevel(6000));
    expect(s.level).toBeGreaterThan(1);
  });

  test("respec stays open below the lock level", () => {
    const s = backfillXpState({ totalXp: 4500 } as Partial<XpState>); // level 9
    expect(s.level).toBeLessThan(RESPEC_LOCK_LEVEL);
    expect(s.respecLockedAt).toBeNull();
  });

  test("honors an explicit respecLockedAt from new-format state", () => {
    const s = backfillXpState({
      totalXp: 0,
      respecLockedAt: RESPEC_LOCK_LEVEL,
    } as Partial<XpState>);
    expect(s.respecLockedAt).toBe(RESPEC_LOCK_LEVEL);
  });

  test("honors an explicit pointsSpent from new-format state (clamped)", () => {
    const s = backfillXpState({
      totalXp: 6000, // level 10, pointsTotal 14
      pointsSpent: 5,
    } as Partial<XpState>);
    expect(s.pointsSpent).toBe(5);
  });

  test("preserves an equipped title", () => {
    const s = backfillXpState({ totalXp: 0, title: "Committer" } as Partial<XpState>);
    expect(s.title).toBe("Committer");
  });
});

describe("purchaseError", () => {
  // celebrate_level5: level 5, cost 1, ungated.
  test("allows an affordable, level-appropriate, ungated buy", () => {
    const s = makeState({ level: 5, pointsTotal: 4 });
    expect(purchaseError(s, "celebrate_level5", null)).toBeNull();
  });

  test("rejects an unknown id", () => {
    const s = makeState({ level: 20, pointsTotal: 39 });
    expect(purchaseError(s, "nope", null)).toContain("Unknown unlock");
  });

  test("rejects an already-owned unlock", () => {
    const s = makeState({
      level: 5,
      pointsTotal: 4,
      unlockedReactions: ["celebrate_level5"],
    });
    expect(purchaseError(s, "celebrate_level5", null)).toContain("Already owned");
  });

  test("enforces the level gate", () => {
    const s = makeState({ level: 4, pointsTotal: 3 });
    expect(purchaseError(s, "celebrate_level5", null)).toContain(
      "unlocks at level 5",
    );
  });

  test("enforces available points", () => {
    // avail = 4 - 4 = 0, celebrate costs 1
    const s = makeState({ level: 5, pointsTotal: 4, pointsSpent: 4 });
    expect(purchaseError(s, "celebrate_level5", null)).toContain("Need 1 point");
  });

  test("enforces species gating (boss_fight_level8 → dragon/goose)", () => {
    const s = makeState({ level: 8, pointsTotal: 6 });
    expect(purchaseError(s, "boss_fight_level8", stubCompanion("cat", "common"))).toContain(
      "doesn't qualify",
    );
    expect(
      purchaseError(s, "boss_fight_level8", stubCompanion("dragon", "common")),
    ).toBeNull();
  });

  test("enforces rarity gating (zen_mode_level10 → rare+)", () => {
    const s = makeState({ level: 10, pointsTotal: 14 });
    expect(
      purchaseError(s, "zen_mode_level10", stubCompanion("cat", "common")),
    ).toContain("doesn't qualify");
    expect(
      purchaseError(s, "zen_mode_level10", stubCompanion("cat", "legendary")),
    ).toBeNull();
  });
});

describe("refundError", () => {
  test("allows refunding an owned unlock while respec is open", () => {
    const s = makeState({
      level: 5,
      respecLockedAt: null,
      unlockedReactions: ["celebrate_level5"],
      pointsSpent: 1,
      pointsTotal: 4,
    });
    expect(refundError(s, "celebrate_level5")).toBeNull();
  });

  test("rejects refunds once respec is locked", () => {
    const s = makeState({
      level: 12,
      respecLockedAt: RESPEC_LOCK_LEVEL,
      unlockedReactions: ["celebrate_level5"],
    });
    expect(refundError(s, "celebrate_level5")).toContain("Respec is locked");
  });

  test("rejects refunding something not owned", () => {
    const s = makeState({ level: 5, respecLockedAt: null });
    expect(refundError(s, "celebrate_level5")).toContain("don't own");
  });

  test("rejects an unknown id (respec open)", () => {
    const s = makeState({ level: 5, respecLockedAt: null });
    expect(refundError(s, "nope")).toContain("Unknown unlock");
  });
});

describe("rarityMultiplier", () => {
  test("common is the 1.0 baseline", () => {
    expect(rarityMultiplier("common")).toBe(1.0);
  });

  test("scales up monotonically with rarity", () => {
    expect(rarityMultiplier("uncommon")).toBeGreaterThan(rarityMultiplier("common"));
    expect(rarityMultiplier("rare")).toBeGreaterThan(rarityMultiplier("uncommon"));
    expect(rarityMultiplier("epic")).toBeGreaterThan(rarityMultiplier("rare"));
    expect(rarityMultiplier("legendary")).toBeGreaterThan(rarityMultiplier("epic"));
  });

  test("legendary is +20%", () => {
    expect(rarityMultiplier("legendary")).toBeCloseTo(1.2);
  });

  test("undefined rarity is neutral (1.0)", () => {
    expect(rarityMultiplier(undefined)).toBe(1);
  });
});
