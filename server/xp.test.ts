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
  prestigeMultiplierFor,
  PRESTIGE_MAX,
  PRESTIGE_MULTIPLIER_TABLE,
  ascendError,
  applyAscension,
  applyCollectionReward,
  accountMultiplier,
  COLLECTION_MULTIPLIER_BONUS,
  COLLECTOR_TITLE,
  MAX_LEVEL,
  xpForLevel,
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
    bonusPoints: 0,
    collectionMultiplier: 1.0,
    respecLockedAt: null,
    title: null,
    prestigeLevel: 0,
    prestigeMultiplier: 1.0,
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
    bonusPoints: 0,
    collectionMultiplier: 1.0,
    respecLockedAt: null,
    title: null,
    prestigeLevel: 0,
    prestigeMultiplier: 1.0,
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

  test("rejects refunding a prestige unlock even with respec open", () => {
    // prestige_aura is owned; respec is open (as it is right after ascension),
    // but prestige items are permanent.
    const s = makeState({
      level: 5,
      respecLockedAt: null,
      prestigeLevel: 2,
      unlockedUpgrades: ["prestige_aura"],
    });
    expect(refundError(s, "prestige_aura")).toContain("permanent");
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

// ─── Prestige / ascension (additional-rewards FR1) ────────────────────────────

describe("prestigeMultiplierFor", () => {
  test("tier 0 is the 1.0 baseline", () => {
    expect(prestigeMultiplierFor(0)).toBe(1.0);
  });

  test("matches the documented table at each tier", () => {
    expect(prestigeMultiplierFor(1)).toBeCloseTo(1.05);
    expect(prestigeMultiplierFor(2)).toBeCloseTo(1.09);
    expect(prestigeMultiplierFor(3)).toBeCloseTo(1.12);
    expect(prestigeMultiplierFor(4)).toBeCloseTo(1.14);
    expect(prestigeMultiplierFor(PRESTIGE_MAX)).toBeCloseTo(1.15);
  });

  test("gains shrink each tier (diminishing returns)", () => {
    const gains: number[] = [];
    for (let t = 1; t <= PRESTIGE_MAX; t++) {
      gains.push(
        PRESTIGE_MULTIPLIER_TABLE[t] - PRESTIGE_MULTIPLIER_TABLE[t - 1],
      );
    }
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThanOrEqual(gains[i - 1] + 1e-9);
    }
  });

  test("clamps out-of-range tiers to the 0..MAX bounds", () => {
    expect(prestigeMultiplierFor(-3)).toBe(1.0);
    expect(prestigeMultiplierFor(999)).toBeCloseTo(1.15);
  });
});

describe("backfillXpState — prestige", () => {
  test("absent prestige fields back-fill to 0 / ×1.0", () => {
    const s = backfillXpState({ totalXp: 0 });
    expect(s.prestigeLevel).toBe(0);
    expect(s.prestigeMultiplier).toBe(1.0);
  });

  test("the multiplier is re-derived from the tier, not trusted from disk", () => {
    // A corrupt/stale cached multiplier must be ignored.
    const s = backfillXpState({
      totalXp: 0,
      prestigeLevel: 2,
      prestigeMultiplier: 99,
    } as Partial<XpState>);
    expect(s.prestigeLevel).toBe(2);
    expect(s.prestigeMultiplier).toBeCloseTo(1.09);
  });

  test("clamps an over-range stored prestige tier", () => {
    const s = backfillXpState({
      totalXp: 0,
      prestigeLevel: 50,
    } as Partial<XpState>);
    expect(s.prestigeLevel).toBe(PRESTIGE_MAX);
    expect(s.prestigeMultiplier).toBeCloseTo(1.15);
  });
});

describe("ascendError", () => {
  test("rejects below max level", () => {
    expect(ascendError(makeState({ level: 19 }))).toContain(
      `level ${MAX_LEVEL}`,
    );
  });

  test("rejects at the prestige cap", () => {
    const s = makeState({ level: MAX_LEVEL, prestigeLevel: PRESTIGE_MAX });
    expect(ascendError(s)).toContain("maximum prestige");
  });

  test("allows ascension at max level below the cap", () => {
    const s = makeState({ level: MAX_LEVEL, prestigeLevel: 0 });
    expect(ascendError(s)).toBeNull();
  });
});

describe("applyAscension", () => {
  test("resets level/XP but bumps the prestige tier and multiplier", () => {
    const s = makeState({
      totalXp: xpForLevel(MAX_LEVEL),
      level: MAX_LEVEL,
      prestigeLevel: 0,
    });
    applyAscension(s);
    expect(s.prestigeLevel).toBe(1);
    expect(s.prestigeMultiplier).toBeCloseTo(1.05);
    expect(s.totalXp).toBe(0);
    expect(s.level).toBe(1);
  });

  test("preserves owned unlocks and the equipped title (FR1.2)", () => {
    const s = makeState({
      totalXp: xpForLevel(MAX_LEVEL),
      level: MAX_LEVEL,
      unlockedReactions: ["greet_level2"],
      unlockedUpgrades: ["bonus_eye"],
      cosmeticFlags: ["has_third_eye"],
      title: "Legend",
    });
    applyAscension(s);
    expect(s.unlockedReactions).toEqual(["greet_level2"]);
    expect(s.unlockedUpgrades).toEqual(["bonus_eye"]);
    expect(s.cosmeticFlags).toEqual(["has_third_eye"]);
    expect(s.title).toBe("Legend");
  });

  test("reopens respec and grants a fresh point budget", () => {
    const s = makeState({
      totalXp: xpForLevel(MAX_LEVEL),
      level: MAX_LEVEL,
      respecLockedAt: RESPEC_LOCK_LEVEL,
      pointsSpent: 7,
    });
    applyAscension(s);
    expect(s.respecLockedAt).toBeNull();
    expect(s.pointsSpent).toBe(0);
    expect(s.pointsTotal).toBe(0);
  });

  test("never exceeds the prestige cap", () => {
    const s = makeState({
      totalXp: xpForLevel(MAX_LEVEL),
      level: MAX_LEVEL,
      prestigeLevel: PRESTIGE_MAX - 1,
    });
    applyAscension(s);
    expect(s.prestigeLevel).toBe(PRESTIGE_MAX);
    applyAscension(s); // one more — should hold at the cap
    expect(s.prestigeLevel).toBe(PRESTIGE_MAX);
  });
});

describe("purchaseError — prestige gate", () => {
  test("blocks a prestige-gated item below the required tier", () => {
    // prestige_aura requires prestigeLevel 2.
    const s = makeState({ level: MAX_LEVEL, prestigeLevel: 1 });
    expect(purchaseError(s, "prestige_aura", null)).toContain("Prestige 2");
  });

  test("allows a prestige-gated item once the tier is met (points aside)", () => {
    const s = makeState({
      level: MAX_LEVEL,
      prestigeLevel: 2,
      pointsTotal: 10,
    });
    expect(purchaseError(s, "prestige_aura", null)).toBeNull();
  });
});

// ─── Collection milestone (additional-rewards FR3) ────────────────────────────

describe("applyCollectionReward", () => {
  test("grants the account-wide multiplier", () => {
    const s = makeState({});
    applyCollectionReward(s);
    expect(s.collectionMultiplier).toBeCloseTo(1 + COLLECTION_MULTIPLIER_BONUS);
  });

  test("auto-equips the Collector title when none is worn", () => {
    const s = makeState({ title: null });
    applyCollectionReward(s);
    expect(s.title).toBe(COLLECTOR_TITLE);
  });

  test("does not clobber a deliberately-equipped title", () => {
    const s = makeState({ title: "Legend" });
    applyCollectionReward(s);
    expect(s.title).toBe("Legend");
    expect(s.collectionMultiplier).toBeCloseTo(1.05); // multiplier still granted
  });

  test("is idempotent — a second grant changes nothing", () => {
    const s = makeState({ title: null });
    applyCollectionReward(s);
    const after = { ...s };
    applyCollectionReward(s);
    expect(s.collectionMultiplier).toBe(after.collectionMultiplier);
    expect(s.title).toBe(after.title);
  });
});

describe("accountMultiplier", () => {
  test("is prestige × collection", () => {
    const s = makeState({ prestigeMultiplier: 1.05, collectionMultiplier: 1.05 });
    expect(accountMultiplier(s)).toBeCloseTo(1.05 * 1.05);
  });

  test("is neutral at the baseline", () => {
    expect(accountMultiplier(makeState({}))).toBe(1.0);
  });
});

describe("backfillXpState — collection multiplier", () => {
  test("absent field back-fills to ×1.0", () => {
    expect(backfillXpState({ totalXp: 0 }).collectionMultiplier).toBe(1.0);
  });

  test("a stored earned multiplier passes through", () => {
    const s = backfillXpState({
      totalXp: 0,
      collectionMultiplier: 1.05,
    } as Partial<XpState>);
    expect(s.collectionMultiplier).toBeCloseTo(1.05);
  });
});

describe("multiplier stacking ceiling (risk R2)", () => {
  test("rarity × prestige stays modest at the combined max", () => {
    const combined =
      rarityMultiplier("legendary") * prestigeMultiplierFor(PRESTIGE_MAX);
    expect(combined).toBeCloseTo(1.38); // 1.20 × 1.15
    expect(combined).toBeLessThan(1.5);
  });

  test("rarity × prestige × collection stays under the design's ~1.45", () => {
    const s = makeState({
      prestigeMultiplier: prestigeMultiplierFor(PRESTIGE_MAX),
      collectionMultiplier: 1 + COLLECTION_MULTIPLIER_BONUS,
    });
    const combined = rarityMultiplier("legendary") * accountMultiplier(s);
    expect(combined).toBeCloseTo(1.2 * 1.15 * 1.05); // ≈ 1.449
    expect(combined).toBeLessThan(1.5);
  });
});
