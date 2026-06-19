/**
 * XP and leveling system for claude-buddy.
 *
 * Awards XP for coding events, computes levels, and manages unlockables.
 * State persists to xp.json in the buddy state directory.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path";
import type { Species, Rarity, Companion, Hat } from "./engine";

// ─── XP event types ───────────────────────────────────────────────────────────

export type XpEvent =
  | "errors_spotted"
  | "tests_passed"
  | "tests_failed"
  | "large_diff"
  | "turn"
  | "achievement_unlocked"
  | "time_spent"
  | "buddy_pet";

// ─── XP rules ─────────────────────────────────────────────────────────────────

interface XpRule {
  event: XpEvent;
  baseXp: number;
  /**
   * Optional per-event species multiplier (opt-in flavor). Stacks on top of the
   * global rarity multiplier; defaults to 1.0 when unset.
   */
  speciesBonus?: Partial<Record<Species, number>>;
}

const XP_RULES: XpRule[] = [
  { event: "errors_spotted",        baseXp: 12 },
  { event: "tests_passed",          baseXp: 20 },
  { event: "tests_failed",          baseXp: 5 },
  { event: "large_diff",            baseXp: 20 },
  { event: "turn",                  baseXp: 1 },
  { event: "achievement_unlocked",  baseXp: 50 },
  { event: "time_spent",            baseXp: 2 },  // per minute
  { event: "buddy_pet",             baseXp: 5 },
];

function getRule(event: XpEvent): XpRule {
  return XP_RULES.find((r) => r.event === event) ?? { event, baseXp: 1 };
}

// ─── Rarity multiplier (global) ──────────────────────────────────────────────

/**
 * Global XP multiplier by rarity — rarer buddies level a little faster. Small
 * by design (flavor, not power creep): a legendary gains ~20% more than common.
 */
export const RARITY_MULTIPLIER: Record<Rarity, number> = {
  common: 1.0,
  uncommon: 1.05,
  rare: 1.1,
  epic: 1.15,
  legendary: 1.2,
};

/** The rarity multiplier for a given rarity (1.0 when unknown/undefined). */
export function rarityMultiplier(rarity?: Rarity): number {
  return rarity ? (RARITY_MULTIPLIER[rarity] ?? 1) : 1;
}

// ─── Prestige multiplier (ascension) ─────────────────────────────────────────

/** Highest prestige tier a player can reach (additional-rewards FR1, OQ1). */
export const PRESTIGE_MAX = 5;

/**
 * Cumulative XP multiplier by prestige tier — each ascension adds a smaller
 * gain (diminishing returns) so the loop rewards dedication without letting
 * multipliers run away. Capped at ×1.15, mirroring the rarity ceiling's intent
 * (flavor, not power creep). Indexed by prestige level 0..PRESTIGE_MAX.
 */
export const PRESTIGE_MULTIPLIER_TABLE: readonly number[] = [
  1.0, // 0 — never ascended
  1.05,
  1.09,
  1.12,
  1.14,
  1.15, // 5 — hard cap
];

/** The cumulative multiplier for a prestige tier (clamped to 0..PRESTIGE_MAX). */
export function prestigeMultiplierFor(prestigeLevel: number): number {
  const clamped = Math.max(0, Math.min(PRESTIGE_MAX, prestigeLevel));
  return PRESTIGE_MULTIPLIER_TABLE[clamped] ?? 1.0;
}

// ─── Level table ──────────────────────────────────────────────────────────────

export const MAX_LEVEL = 20;

export const XP_LEVELS: Record<number, number> = {
  1: 0,
  2: 100,
  3: 250,
  4: 500,
  5: 900,
  6: 1500,
  7: 2300,
  8: 3300,
  9: 4500,
  10: 6000,
  11: 7800,
  12: 10000,
  13: 12500,
  14: 15500,
  15: 19000,
  16: 23000,
  17: 27500,
  18: 32500,
  19: 38000,
  20: 44000,
};

/** Compute level from total XP. Returns 1–MAX_LEVEL. */
export function computeLevel(totalXp: number): number {
  for (let lvl = MAX_LEVEL; lvl >= 1; lvl--) {
    if (totalXp >= (XP_LEVELS[lvl] ?? 0)) return lvl;
  }
  return 1;
}

/** XP needed to reach the next level (0 if at max). */
export function xpToNextLevel(totalXp: number): number {
  const current = computeLevel(totalXp);
  if (current >= MAX_LEVEL) return 0;
  return XP_LEVELS[current + 1] - totalXp;
}

/** Total XP needed to reach a level from 0. */
export function xpForLevel(level: number): number {
  return XP_LEVELS[Math.min(level, MAX_LEVEL)] ?? 0;
}

// ─── Unlockables ──────────────────────────────────────────────────────────────

/** Category an unlockable belongs to — drives how it is surfaced and applied. */
export type UnlockCategory = "cosmetic" | "behavioral" | "stat" | "prestige";

export interface UnlockableReaction {
  id: string;
  /** Minimum level required to purchase this unlock (a gate, not auto-grant). */
  level: number;
  /** Skill-point price. */
  cost: number;
  category: UnlockCategory;
  template: string;
  species?: Species[];
  rarity?: Rarity[];
  /** Minimum prestige tier required to buy (omitted = available to everyone). */
  prestigeLevel?: number;
}

/**
 * A reversible effect an owned upgrade has on the companion. Data-driven so the
 * catalog stays declarative — applyUpgradeEffect/revertUpgradeEffect interpret
 * these rather than carrying a per-id switch.
 *   - flag:  a cosmetic marker in cosmeticFlags (renderable signal, clean revert)
 *   - shiny: toggles bones.shiny, tracked so natural shimmer is never clobbered
 *   - hat:   sets bones.hat (used only by non-refundable, L>=10 cosmetics)
 *   - stat:  adds to the peak stat (used only by non-refundable, L>=10 items)
 */
export type UpgradeEffect =
  | { type: "flag"; flag: string }
  | { type: "shiny" }
  | { type: "hat"; hat: Hat }
  | { type: "stat"; amount: number };

export interface UnlockableUpgrade {
  id: string;
  /** Minimum level required to purchase this unlock (a gate, not auto-grant). */
  level: number;
  /** Skill-point price. */
  cost: number;
  category: UnlockCategory;
  name: string;
  description: string;
  icon: string;
  species?: Species[];
  rarity?: Rarity[];
  /** What buying this upgrade does to the companion (none → pure unlock). */
  effect?: UpgradeEffect;
  /** Whether this upgrade is currently active on a companion */
  active?: boolean;
  /** Minimum prestige tier required to buy (omitted = available to everyone). */
  prestigeLevel?: number;
}

// Behavioral unlocks are reactions: owned templates surface on buddy_pet via
// getAvailableReactions(). Every level 2\u201320 has at least one purchasable item
// across these and UNLOCKABLE_UPGRADES; costs rise with level (1 early \u2192 3 late).

export const UNLOCKABLE_REACTIONS: UnlockableReaction[] = [
  {
    id: "greet_level2",
    level: 2,
    cost: 1,
    category: "behavioral",
    template: "*perks up* ready when you are.",
  },
  {
    id: "celebrate_level5",
    level: 5,
    cost: 1,
    category: "behavioral",
    template: "*does a happy dance* level up!",
  },
  {
    id: "focus_level6",
    level: 6,
    cost: 2,
    category: "behavioral",
    template: "*locks in* deep work mode engaged.",
  },
  {
    id: "boss_fight_level8",
    level: 8,
    cost: 2,
    category: "behavioral",
    template: "*rolls up sleeves* time to debug.",
    species: ["dragon", "goose"],
  },
  {
    id: "rubber_duck_level9",
    level: 9,
    cost: 2,
    category: "behavioral",
    template: "*tilts head* explain it to me one more time?",
  },
  {
    id: "zen_mode_level10",
    level: 10,
    cost: 2,
    category: "behavioral",
    template: "*closes all eyes* ...peace.",
    rarity: ["rare", "epic", "legendary"],
  },
  {
    id: "debug_sprint_level12",
    level: 12,
    cost: 2,
    category: "behavioral",
    template: "*cracks knuckles* let's squash this.",
    species: ["cat", "robot"],
  },
  {
    id: "ship_it_level14",
    level: 14,
    cost: 2,
    category: "behavioral",
    template: "*nods* ship it. no fear.",
  },
  {
    id: "sage_quip_level18",
    level: 18,
    cost: 3,
    category: "behavioral",
    template: "*ancient calm* you've come a long way.",
    rarity: ["epic", "legendary"],
  },
  // ── Prestige-exclusive (additional-rewards FR1.4; gated on prestigeLevel) ──
  {
    id: "prestige_reset_quip",
    level: 1,
    cost: 2,
    category: "behavioral",
    template: "*back at level one* we've done this before.",
    prestigeLevel: 1,
  },
  {
    id: "prestige_veteran_quip",
    level: 1,
    cost: 3,
    category: "behavioral",
    template: "*unbothered* resetting the counter, never the standards.",
    prestigeLevel: 3,
  },
];

export const UNLOCKABLE_UPGRADES: UnlockableUpgrade[] = [
  // \u2500\u2500 Cosmetic \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  {
    id: "bonus_eye",
    level: 3,
    cost: 1,
    category: "cosmetic",
    name: "Third Eye",
    description: "Your buddy gains a bonus eye for extra perception.",
    icon: "\ud83d\udc41",
    effect: { type: "flag", flag: "has_third_eye" },
  },
  {
    id: "sparkle_eyes",
    level: 4,
    cost: 1,
    category: "cosmetic",
    name: "Sparkle Eyes",
    description: "A glint of mischief in your buddy's eyes.",
    icon: "\u2727",
    effect: { type: "flag", flag: "sparkle_eyes" },
  },
  {
    id: "beanie",
    level: 6,
    cost: 2,
    category: "cosmetic",
    name: "Cozy Beanie",
    description: "A snug little beanie for chilly debugging nights.",
    icon: "\ud83e\udde2",
    effect: { type: "flag", flag: "beanie" },
  },
  {
    id: "shiny_aura",
    level: 7,
    cost: 2,
    category: "cosmetic",
    name: "Shiny Aura",
    description: "A permanent shimmer effect around your buddy.",
    icon: "\u2728",
    effect: { type: "shiny" },
  },
  {
    id: "glow",
    level: 11,
    cost: 2,
    category: "cosmetic",
    name: "Soft Glow",
    description: "A gentle ambient glow around your buddy.",
    icon: "\ud83d\udd06",
    effect: { type: "flag", flag: "glow" },
  },
  {
    id: "extra_hat_slot",
    level: 15,
    cost: 3,
    category: "cosmetic",
    name: "Hat Collection",
    description: "Unlocks the tiny-duck hat permanently.",
    icon: "\ud83c\udfa9",
    effect: { type: "hat", hat: "tinyduck" },
  },
  {
    id: "crown",
    level: 16,
    cost: 3,
    category: "cosmetic",
    name: "Royal Crown",
    description: "A regal crown befitting your buddy's standing.",
    icon: "\ud83d\udc51",
    effect: { type: "hat", hat: "crown" },
  },
  {
    id: "wizard_hat",
    level: 17,
    cost: 3,
    category: "cosmetic",
    name: "Wizard Hat",
    description: "A pointed hat for arcane refactoring.",
    icon: "\ud83e\uddd9",
    effect: { type: "hat", hat: "wizard" },
  },
  {
    id: "constellation",
    level: 19,
    cost: 3,
    category: "cosmetic",
    name: "Constellation",
    description: "A tiny constellation orbits your buddy.",
    icon: "\ud83c\udf20",
    effect: { type: "flag", flag: "constellation" },
  },
  // \u2500\u2500 Stat (all level >= 11, so never refundable: stat math stays sound) \u2500\u2500\u2500\u2500\u2500\u2500
  {
    id: "quick_study",
    level: 11,
    cost: 2,
    category: "stat",
    name: "Quick Study",
    description: "+3 to peak stat.",
    icon: "\ud83d\udcd8",
    effect: { type: "stat", amount: 3 },
  },
  {
    id: "stat_boost",
    level: 12,
    cost: 2,
    category: "stat",
    name: "Training Bonus",
    description: "+5 to peak stat.",
    icon: "\u2b50",
    effect: { type: "stat", amount: 5 },
  },
  {
    id: "iron_focus",
    level: 13,
    cost: 2,
    category: "stat",
    name: "Iron Focus",
    description: "+5 to peak stat.",
    icon: "\ud83e\uddb4",
    effect: { type: "stat", amount: 5 },
  },
  {
    id: "prodigy",
    level: 20,
    cost: 3,
    category: "stat",
    name: "Prodigy",
    description: "+5 to peak stat.",
    icon: "\ud83c\udf1f",
    effect: { type: "stat", amount: 5 },
  },
  // \u2500\u2500 Prestige (titles; equip via buddy_upgrades equipTitle) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  {
    id: "title_committer",
    level: 11,
    cost: 2,
    category: "prestige",
    name: "Committer",
    description: "A prestige title earned through steady commits.",
    icon: "\ud83c\udff7",
  },
  {
    id: "title_debugger",
    level: 13,
    cost: 2,
    category: "prestige",
    name: "Debugger",
    description: "A prestige title for the relentless bug-hunter.",
    icon: "\ud83c\udff7",
  },
  {
    id: "title_architect",
    level: 16,
    cost: 3,
    category: "prestige",
    name: "Architect",
    description: "A prestige title for the system-shaper.",
    icon: "\ud83c\udff7",
  },
  {
    id: "title_sage",
    level: 18,
    cost: 3,
    category: "prestige",
    name: "Sage",
    description: "A prestige title for the deeply wise.",
    icon: "\ud83c\udff7",
  },
  {
    id: "title_legend",
    level: 20,
    cost: 3,
    category: "prestige",
    name: "Legend",
    description: "A prestige title reserved for the maxed and mighty.",
    icon: "\ud83c\udff7",
  },
  // \u2500\u2500 Prestige-exclusive (additional-rewards FR1.4; gated on prestigeLevel) \u2500\u2500
  {
    id: "prestige_aura",
    level: 1,
    cost: 2,
    category: "cosmetic",
    name: "Ascendant Aura",
    description: "A faint halo that only the ascended carry.",
    icon: "\ud83d\udcab",
    effect: { type: "flag", flag: "ascendant_aura" },
    prestigeLevel: 2,
  },
  {
    id: "prestige_resolve",
    level: 1,
    cost: 3,
    category: "stat",
    name: "Tempered Resolve",
    description: "+5 to peak stat \u2014 forged across resets.",
    icon: "\u2694\ufe0f",
    effect: { type: "stat", amount: 5 },
    prestigeLevel: 4,
  },
  {
    id: "title_ascendant",
    level: 1,
    cost: 4,
    category: "prestige",
    name: "Ascendant",
    description: "A prestige title for those who reached the summit and climbed again.",
    icon: "\ud83d\udd31",
    prestigeLevel: 5,
  },
  {
    id: "prestige_crown",
    level: 1,
    cost: 4,
    category: "cosmetic",
    name: "Ascendant Crown",
    description: "A crown reserved for the fully ascended.",
    icon: "\ud83d\udc51",
    effect: { type: "hat", hat: "crown" },
    prestigeLevel: 5,
  },
];

/** Look up the skill-point cost of any unlockable by id (0 if unknown). */
export function unlockCost(id: string): number {
  const rxn = UNLOCKABLE_REACTIONS.find((r) => r.id === id);
  if (rxn) return rxn.cost;
  const upg = UNLOCKABLE_UPGRADES.find((u) => u.id === id);
  if (upg) return upg.cost;
  return 0;
}

// \u2500\u2500\u2500 Skill-point grants \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * Skill points granted for reaching a given level (the per-level increment).
 * Tiered so late levels feel weightier: 1 (L2\u20135), 2 (L6\u201315), 3 (L16\u201320).
 */
function pointsAtLevel(level: number): number {
  if (level <= 1) return 0;
  if (level <= 5) return 1;
  if (level <= 15) return 2;
  return 3;
}

/** Cumulative skill points granted by reaching `level` (0 at level 1). */
export function pointsForLevel(level: number): number {
  const capped = Math.min(level, MAX_LEVEL);
  let total = 0;
  for (let l = 2; l <= capped; l++) total += pointsAtLevel(l);
  return total;
}

// ─── XP state ─────────────────────────────────────────────────────────────────

export interface XpState {
  totalXp: number;
  level: number;
  unlockedReactions: string[];
  unlockedUpgrades: string[];
  cosmeticFlags: string[];
  levelUpAchieved: boolean; // flash animation once per level-up

  // Skill-point economy.
  pointsTotal: number; // lifetime points granted (derived from level)
  pointsSpent: number; // points consumed by owned unlocks
  /** Level at which respec became permanent (null until first crossing L10). */
  respecLockedAt: number | null;

  // Prestige identity.
  title: string | null; // equipped prestige title, null if none

  // Ascension (additional-rewards FR1).
  prestigeLevel: number; // 0 = never ascended; caps at PRESTIGE_MAX
  prestigeMultiplier: number; // derived from prestigeLevel, cached for display
}

/** Level at and beyond which respec is permanently locked. */
export const RESPEC_LOCK_LEVEL = 10;

const XP_FILE = join(buddyStateDir(), "xp.json");

/** Skill points currently available to spend. */
export function availablePoints(state: XpState): number {
  return Math.max(0, state.pointsTotal - state.pointsSpent);
}

/** Total skill-point cost of the unlocks a state already owns. */
function ownedPointCost(
  unlockedReactions: string[],
  unlockedUpgrades: string[],
): number {
  let cost = 0;
  for (const id of unlockedReactions) cost += unlockCost(id);
  for (const id of unlockedUpgrades) cost += unlockCost(id);
  return cost;
}

/**
 * Normalize a parsed (possibly legacy or partial) xp.json blob into a complete,
 * self-consistent XpState. Pure — no I/O — so migration is unit-testable.
 *
 * Rules:
 *   - `level` is recomputed from `totalXp` (self-heals a stale level field).
 *   - `pointsTotal` is always derived from the level via the grant table.
 *   - Legacy state (no `pointsSpent` field) grandfathers already-owned unlocks:
 *     `pointsSpent` is set to their cost, clamped so it never exceeds
 *     `pointsTotal` — nobody loses an unlock during migration.
 *   - `respecLockedAt` defaults to the lock level once the player is at/over it.
 */
export function backfillXpState(parsed: Partial<XpState> | null): XpState {
  const p = parsed ?? {};
  const totalXp = typeof p.totalXp === "number" ? p.totalXp : 0;
  const level = computeLevel(totalXp);
  const unlockedReactions = Array.isArray(p.unlockedReactions)
    ? p.unlockedReactions
    : [];
  const unlockedUpgrades = Array.isArray(p.unlockedUpgrades)
    ? p.unlockedUpgrades
    : [];

  const pointsTotal = pointsForLevel(level);

  // Legacy blobs have no pointsSpent — derive it from owned unlocks.
  const rawSpent =
    typeof p.pointsSpent === "number"
      ? p.pointsSpent
      : ownedPointCost(unlockedReactions, unlockedUpgrades);
  const pointsSpent = Math.min(Math.max(0, rawSpent), pointsTotal);

  const respecLockedAt =
    p.respecLockedAt === undefined
      ? level >= RESPEC_LOCK_LEVEL
        ? RESPEC_LOCK_LEVEL
        : null
      : p.respecLockedAt;

  // Prestige back-fills to 0; the multiplier is always re-derived from the tier
  // (self-healing, like pointsTotal) rather than trusting the stored cache.
  const prestigeLevel =
    typeof p.prestigeLevel === "number"
      ? Math.max(0, Math.min(PRESTIGE_MAX, Math.floor(p.prestigeLevel)))
      : 0;

  return {
    totalXp,
    level,
    unlockedReactions,
    unlockedUpgrades,
    cosmeticFlags: Array.isArray(p.cosmeticFlags) ? p.cosmeticFlags : [],
    levelUpAchieved: p.levelUpAchieved ?? false,
    pointsTotal,
    pointsSpent,
    respecLockedAt,
    title: p.title ?? null,
    prestigeLevel,
    prestigeMultiplier: prestigeMultiplierFor(prestigeLevel),
  };
}

function loadXpState(): XpState {
  try {
    const raw = readFileSync(XP_FILE, "utf8");
    return backfillXpState(JSON.parse(raw) as Partial<XpState>);
  } catch {
    return backfillXpState(null);
  }
}

function saveXpState(state: XpState): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const tmp = XP_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  // Atomic rename
  try {
    const { renameSync } = require("fs");
    renameSync(tmp, XP_FILE);
  } catch {
    // fallback: just write directly
    writeFileSync(XP_FILE, JSON.stringify(state, null, 2));
  }
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Compute XP awarded for an event, applying the species, rarity, and prestige
 * multipliers. The prestige factor stacks multiplicatively with rarity at the
 * same point (additional-rewards FR1.3); it defaults to 1.0 so callers without
 * a loaded state are unaffected.
 */
function computeXpForEvent(
  event: XpEvent,
  species?: Species,
  rarity?: Rarity,
  prestigeMult: number = 1,
): number {
  const rule = getRule(event);
  const speciesMult =
    species && rule.speciesBonus?.[species] ? rule.speciesBonus[species]! : 1;
  return Math.floor(
    rule.baseXp * rarityMultiplier(rarity) * speciesMult * prestigeMult,
  );
}

/**
 * Apply a raw XP gain to a state in place: bumps the total, recomputes the
 * level and derived point total, permanently locks respec once the lock level
 * is reached, and sets the level-up flag. Shared by awardXp (fixed event XP)
 * and awardXpAmount (dynamic amounts such as the session-completion bonus).
 *
 * Leveling no longer auto-unlocks content — it grants skill points (derived
 * from pointsTotal) which the player spends via spendUnlock().
 */
function applyXpGain(state: XpState, xpGain: number): void {
  const prevLevel = state.level;
  const newTotal = state.totalXp + xpGain;
  const newLevel = computeLevel(newTotal);

  state.totalXp = newTotal;
  state.level = newLevel;
  // Keep the derived skill-point total in step with the level.
  state.pointsTotal = pointsForLevel(newLevel);

  // Respec locks permanently the first time the player reaches the lock level.
  if (state.respecLockedAt === null && newLevel >= RESPEC_LOCK_LEVEL) {
    state.respecLockedAt = RESPEC_LOCK_LEVEL;
  }

  // Detect level-up
  if (newLevel > prevLevel) {
    state.levelUpAchieved = true;
  }
}

/**
 * Award XP for an event.
 * Returns the updated XpState.
 */
export function awardXp(
  event: XpEvent,
  slot?: string,
  species?: Species,
  rarity?: Rarity,
): XpState {
  const state = loadXpState();
  applyXpGain(
    state,
    computeXpForEvent(event, species, rarity, state.prestigeMultiplier),
  );
  saveXpState(state);
  return state;
}

/**
 * Award a precomputed amount of XP (e.g. a session-completion bonus). Negative
 * or non-finite amounts are treated as zero. Returns the updated XpState.
 */
export function awardXpAmount(
  amount: number,
  slot?: string,
  species?: Species,
  rarity?: Rarity,
): XpState {
  const gain = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  const state = loadXpState();
  applyXpGain(state, gain);
  saveXpState(state);
  return state;
}

/** Get current XP state */
export function getXpState(): XpState {
  return loadXpState();
}

/** Clear the level-up flash (after animation plays) */
export function clearLevelUpFlag(): void {
  const state = loadXpState();
  state.levelUpAchieved = false;
  saveXpState(state);
}

/** Owned reaction templates the companion currently qualifies for. */
export function getAvailableReactions(
  species?: Species,
  rarity?: Rarity,
): string[] {
  const state = loadXpState();
  const out: string[] = [];
  for (const rxn of UNLOCKABLE_REACTIONS) {
    if (!state.unlockedReactions.includes(rxn.id)) continue;
    if (rxn.species && (!species || !rxn.species.includes(species))) continue;
    if (rxn.rarity && (!rarity || !rxn.rarity.includes(rarity))) continue;
    out.push(rxn.template);
  }
  return out;
}

/**
 * Pick a random owned reaction template the companion qualifies for, or null if
 * none are owned. Used to occasionally surface purchased behavioral unlocks.
 */
export function pickOwnedReaction(
  species?: Species,
  rarity?: Rarity,
): string | null {
  const owned = getAvailableReactions(species, rarity);
  if (owned.length === 0) return null;
  return owned[Math.floor(Math.random() * owned.length)];
}

// ─── Skill-point economy ──────────────────────────────────────────────────────

type FoundUnlock =
  | { kind: "reaction"; item: UnlockableReaction }
  | { kind: "upgrade"; item: UnlockableUpgrade };

/** Locate an unlockable by id across both catalogs. */
export function findUnlockable(id: string): FoundUnlock | null {
  const rxn = UNLOCKABLE_REACTIONS.find((r) => r.id === id);
  if (rxn) return { kind: "reaction", item: rxn };
  const upg = UNLOCKABLE_UPGRADES.find((u) => u.id === id);
  if (upg) return { kind: "upgrade", item: upg };
  return null;
}

function isOwned(state: XpState, id: string): boolean {
  return (
    state.unlockedReactions.includes(id) ||
    state.unlockedUpgrades.includes(id)
  );
}

/** Whether the companion satisfies an unlock's species/rarity restriction. */
function meetsRequirements(
  item: UnlockableReaction | UnlockableUpgrade,
  companion: Companion | null,
): boolean {
  if (item.species) {
    if (!companion || !item.species.includes(companion.bones.species)) {
      return false;
    }
  }
  if (item.rarity) {
    if (!companion || !item.rarity.includes(companion.bones.rarity)) {
      return false;
    }
  }
  return true;
}

function labelOf(found: FoundUnlock): string {
  return found.kind === "reaction"
    ? `"${found.item.template}"`
    : found.item.name;
}

function addFlag(state: XpState, flag: string): void {
  if (!state.cosmeticFlags.includes(flag)) state.cosmeticFlags.push(flag);
}

function removeFlag(state: XpState, flag: string): void {
  const i = state.cosmeticFlags.indexOf(flag);
  if (i >= 0) state.cosmeticFlags.splice(i, 1);
}

/**
 * Apply an owned upgrade's declarative effect to a companion. Flag/shiny effects
 * revert cleanly; hat/stat effects are reserved for non-refundable (L>=10)
 * upgrades, so their revert is best-effort only.
 */
function applyUpgradeEffect(
  companion: Companion,
  state: XpState,
  id: string,
): void {
  const upg = UNLOCKABLE_UPGRADES.find((u) => u.id === id);
  const effect = upg?.effect;
  if (!effect) return;
  switch (effect.type) {
    case "flag":
      addFlag(state, effect.flag);
      break;
    case "shiny":
      if (!companion.bones.shiny) {
        companion.bones.shiny = true;
        addFlag(state, "aura_shiny");
      }
      break;
    case "hat":
      companion.bones.hat = effect.hat;
      break;
    case "stat":
      companion.bones.stats[companion.bones.peak] = Math.min(
        100,
        companion.bones.stats[companion.bones.peak] + effect.amount,
      );
      break;
  }
}

/** Inverse of applyUpgradeEffect, for refunds while respec is open. */
function revertUpgradeEffect(
  companion: Companion,
  state: XpState,
  id: string,
): void {
  const upg = UNLOCKABLE_UPGRADES.find((u) => u.id === id);
  const effect = upg?.effect;
  if (!effect) return;
  switch (effect.type) {
    case "flag":
      removeFlag(state, effect.flag);
      break;
    case "shiny":
      if (state.cosmeticFlags.includes("aura_shiny")) {
        removeFlag(state, "aura_shiny");
        companion.bones.shiny = false; // only undo the aura, not natural shimmer
      }
      break;
    case "hat":
      companion.bones.hat = "none";
      break;
    case "stat":
      companion.bones.stats[companion.bones.peak] = Math.max(
        0,
        companion.bones.stats[companion.bones.peak] - effect.amount,
      );
      break;
  }
}

export interface UnlockResult {
  ok: boolean;
  message: string;
  state: XpState;
  /** True when the companion object was mutated and must be persisted. */
  companionChanged: boolean;
}

function fail(state: XpState, message: string): UnlockResult {
  return { ok: false, message, state, companionChanged: false };
}

/**
 * Pure: validation message for buying `id` against `state`, or null when the
 * purchase is allowed. Checks unknown id, ownership, level gate, species/rarity
 * fit, and available points — in that order.
 */
export function purchaseError(
  state: XpState,
  id: string,
  companion: Companion | null,
): string | null {
  const found = findUnlockable(id);
  if (!found) return `Unknown unlock "${id}".`;
  if (isOwned(state, id)) return `Already owned: ${labelOf(found)}.`;
  if (state.level < found.item.level) {
    return `${labelOf(found)} unlocks at level ${found.item.level} — you're ${state.level}.`;
  }
  if (
    found.item.prestigeLevel &&
    state.prestigeLevel < found.item.prestigeLevel
  ) {
    return `${labelOf(found)} unlocks at Prestige ${found.item.prestigeLevel} — you're Prestige ${state.prestigeLevel}.`;
  }
  if (!meetsRequirements(found.item, companion)) {
    return `Your companion doesn't qualify for ${labelOf(found)}.`;
  }
  const avail = availablePoints(state);
  if (avail < found.item.cost) {
    return `Need ${found.item.cost} point(s), you have ${avail}. Level up to earn more.`;
  }
  return null;
}

/**
 * Pure: validation message for refunding `id`, or null when allowed. Refunds
 * require an open respec window (below the lock level).
 */
export function refundError(state: XpState, id: string): string | null {
  if (state.respecLockedAt !== null) {
    return `Respec is locked — choices became permanent at level ${RESPEC_LOCK_LEVEL}.`;
  }
  const found = findUnlockable(id);
  if (!found) return `Unknown unlock "${id}".`;
  if (!isOwned(state, id)) return `You don't own ${labelOf(found)}.`;
  // Prestige-tier unlocks are permanent — they can carry lossy hat/stat effects
  // and respec is open right after an ascension, so refunds are disallowed.
  if (found.item.prestigeLevel) {
    return `${labelOf(found)} is a prestige unlock — those are permanent.`;
  }
  return null;
}

/**
 * Buy an unlock with skill points. Validates via purchaseError, then commits:
 * marks owned, debits points, and applies any upgrade effect.
 */
export function spendUnlock(
  id: string,
  companion: Companion | null,
): UnlockResult {
  const state = loadXpState();
  const err = purchaseError(state, id, companion);
  if (err) return fail(state, err);
  const found = findUnlockable(id)!;
  const cost = found.item.cost;

  let companionChanged = false;
  if (found.kind === "reaction") {
    state.unlockedReactions.push(id);
  } else {
    state.unlockedUpgrades.push(id);
    if (companion) {
      applyUpgradeEffect(companion, state, id);
      companionChanged = true;
    }
  }
  state.pointsSpent += cost;
  saveXpState(state);
  return {
    ok: true,
    message: `Unlocked ${labelOf(found)} (−${cost} pt).`,
    state,
    companionChanged,
  };
}

/**
 * Refund an owned unlock, reverting its effect and returning the points. Only
 * permitted while respec is open (below the lock level).
 */
export function refundUnlock(
  id: string,
  companion: Companion | null,
): UnlockResult {
  const state = loadXpState();
  const err = refundError(state, id);
  if (err) return fail(state, err);
  const found = findUnlockable(id)!;

  let companionChanged = false;
  if (found.kind === "reaction") {
    state.unlockedReactions = state.unlockedReactions.filter((x) => x !== id);
  } else {
    state.unlockedUpgrades = state.unlockedUpgrades.filter((x) => x !== id);
    if (state.title === found.item.name) state.title = null; // unequip if active
    if (companion) {
      revertUpgradeEffect(companion, state, id);
      companionChanged = true;
    }
  }
  state.pointsSpent = Math.max(0, state.pointsSpent - found.item.cost);
  saveXpState(state);
  return {
    ok: true,
    message: `Refunded ${labelOf(found)} (+${found.item.cost} pt).`,
    state,
    companionChanged,
  };
}

/**
 * Equip (or clear with "" / "none") a prestige title. The title must be an
 * owned prestige-category upgrade. Forward-compatible with the Phase 6 catalog.
 */
export function equipTitle(id: string): UnlockResult {
  const state = loadXpState();
  if (id === "" || id.toLowerCase() === "none") {
    state.title = null;
    saveXpState(state);
    return { ok: true, message: "Title cleared.", state, companionChanged: false };
  }
  const found = findUnlockable(id);
  if (!found || found.kind !== "upgrade" || found.item.category !== "prestige") {
    return fail(state, `"${id}" is not a prestige title.`);
  }
  if (!isOwned(state, id)) {
    return fail(state, `You haven't unlocked the "${found.item.name}" title yet.`);
  }
  state.title = found.item.name;
  saveXpState(state);
  return {
    ok: true,
    message: `Title set to "${found.item.name}".`,
    state,
    companionChanged: false,
  };
}

// ─── Ascension / prestige (additional-rewards FR1) ────────────────────────────

/**
 * Pure: validation message for ascending `state`, or null when allowed.
 * Ascension is only available at max level and below the prestige cap.
 */
export function ascendError(state: XpState): string | null {
  if (state.level < MAX_LEVEL) {
    return `Ascension unlocks at level ${MAX_LEVEL} — you're level ${state.level}.`;
  }
  if (state.prestigeLevel >= PRESTIGE_MAX) {
    return `You're already at the maximum prestige tier (${PRESTIGE_MAX}).`;
  }
  return null;
}

/**
 * Pure: apply an ascension to a state in place. Bumps the prestige tier and its
 * multiplier, resets level/XP to 1 and the point budget to fresh, and reopens
 * respec. Owned reactions/upgrades/cosmetic flags and the equipped title are
 * deliberately preserved — nothing purchased is lost (FR1.2).
 */
export function applyAscension(state: XpState): void {
  state.prestigeLevel = Math.min(PRESTIGE_MAX, state.prestigeLevel + 1);
  state.prestigeMultiplier = prestigeMultiplierFor(state.prestigeLevel);
  state.totalXp = 0;
  state.level = 1;
  state.pointsTotal = pointsForLevel(1); // 0 — points re-earned by re-leveling
  state.pointsSpent = 0; // fresh budget; owned items stay owned
  state.respecLockedAt = null; // respec reopens until the next L10 crossing
  state.levelUpAchieved = false;
}

/**
 * Ascend: reset to level 1 for a permanent prestige multiplier and access to
 * the prestige-exclusive catalog tier. Validates via ascendError, then commits.
 */
export function ascend(): UnlockResult {
  const state = loadXpState();
  const err = ascendError(state);
  if (err) return fail(state, err);
  applyAscension(state);
  saveXpState(state);
  return {
    ok: true,
    message:
      `Ascended to Prestige ${state.prestigeLevel}! Level and XP reset to 1; ` +
      `every unlock and title is kept. Permanent XP multiplier is now ` +
      `×${state.prestigeMultiplier.toFixed(2)}. Heads up: respec is open again ` +
      `until you next reach level ${RESPEC_LOCK_LEVEL}.`,
    state,
    companionChanged: false,
  };
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

/** Render an XP progress bar as a string */
export function renderXpBar(totalXp: number, width: number = 20): string {
  const lvl = computeLevel(totalXp);
  if (lvl >= MAX_LEVEL) {
    return "\u2588".repeat(width) + " MAX";
  }
  const current = XP_LEVELS[lvl] ?? 0;
  const next = XP_LEVELS[lvl + 1] ?? current;
  const progress = (totalXp - current) / (next - current);
  const filled = Math.round(progress * width);
  const empty = width - filled;
  return (
    "\u2588".repeat(filled) +
    "\u2591".repeat(empty) +
    ` Lvl ${lvl}`
  );
}

/** Render XP card in markdown for MCP tool response */
export function renderXpCardMarkdown(): string {
  const state = loadXpState();
  const bar = renderXpBar(state.totalXp, 20);
  const toNext = xpToNextLevel(state.totalXp);
  const nextLevel = state.level + 1;
  const avail = availablePoints(state);

  const parts: string[] = [];

  parts.push(`### \u2b50 ${state.level} \u2014 ${state.totalXp.toLocaleString()} XP`);
  parts.push("");
  parts.push(`**Progress:** \`${bar}\``);
  if (toNext > 0) {
    parts.push(`XP to Level ${nextLevel}: **${toNext.toLocaleString()}**`);
  } else if (state.level >= MAX_LEVEL) {
    parts.push("**MAX LEVEL** reached!");
  }
  parts.push("");

  const respec =
    state.respecLockedAt === null
      ? `open (locks at Lvl ${RESPEC_LOCK_LEVEL})`
      : "locked \u2014 choices are final";
  parts.push(
    `**Skill points:** ${avail} available \u00b7 ${state.pointsSpent} spent \u00b7 respec ${respec}`,
  );
  if (state.title) parts.push(`**Title:** ${state.title}`);
  parts.push("");

  const owned = [...state.unlockedReactions, ...state.unlockedUpgrades];
  if (owned.length > 0) {
    parts.push("**Owned:**");
    for (const id of state.unlockedReactions) {
      const rxn = UNLOCKABLE_REACTIONS.find((r) => r.id === id);
      if (rxn) parts.push(`  - \ud83d\udcac "${rxn.template}"`);
    }
    for (const id of state.unlockedUpgrades) {
      const upg = UNLOCKABLE_UPGRADES.find((u) => u.id === id);
      if (upg) parts.push(`  - ${upg.icon} ${upg.name}: ${upg.description}`);
    }
    parts.push("");
  }

  // Up next: cheapest/lowest-level unlocks the player doesn't own yet.
  const purchasable = [...UNLOCKABLE_REACTIONS, ...UNLOCKABLE_UPGRADES]
    .filter((i) => !owned.includes(i.id))
    .sort((a, b) => a.level - b.level || a.cost - b.cost)
    .slice(0, 4);
  if (purchasable.length > 0) {
    parts.push("**Up next** (spend via `buddy_upgrades`):");
    for (const i of purchasable) {
      const name = "name" in i ? i.name : `"${i.template}"`;
      const ready = state.level >= i.level && avail >= i.cost;
      const status = ready ? "\ud83d\udfe2" : `\ud83d\udd12 Lvl ${i.level}`;
      parts.push(`  - ${status} ${name} \u2014 ${i.cost} pt`);
    }
  }

  return parts.join("\n");
}
