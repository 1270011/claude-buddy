/**
 * Milestone loot boxes for claude-buddy (additional-rewards FR4).
 *
 * Certain milestones — level-up, streak milestone, achievement unlock, and
 * ascension — roll for loot. A roll always grants a small deterministic skill-
 * point bonus (so it never feels like "you got nothing"), and additionally has
 * a small chance to drop a loot-exclusive cosmetic that can't be bought through
 * the normal point economy. Loot is always a bonus *on top of* the milestone's
 * deterministic reward, never a replacement (FR4.3).
 *
 * Loot cosmetics are a lightweight remix of the existing companion `bones`
 * fields (eye / hat / shiny) — no new art — set to combinations otherwise
 * unreachable through the purchasable catalog (design §5.3).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { buddyStateDir } from "./path.ts";
import { grantBonusPoints } from "./xp.ts";
import {
  loadActiveSlot,
  loadCompanionSlot,
  saveCompanionSlot,
} from "./state.ts";
import type { Companion } from "./engine.ts";

// ─── Trigger + state shapes ──────────────────────────────────────────────────

export type LootTrigger =
  | "level_up"
  | "streak_milestone"
  | "achievement"
  | "ascension";

export interface LootLogEntry {
  /** A loot-exclusive cosmetic id, or "points" for a points-only roll. */
  id: string;
  grantedAt: number; // epoch seconds
  trigger: LootTrigger;
}

export interface LootState {
  log: LootLogEntry[]; // capped at LOOT_LOG_CAP most-recent entries
  ownedLootCosmetics: string[]; // loot-exclusive ids already received
}

// ─── Loot-exclusive cosmetics (remix of existing bones fields) ────────────────

export interface LootCosmetic {
  id: string;
  category: "cosmetic";
  flavorText: string; // shown on drop
  apply: (c: Companion) => void;
}

export const LOOT_COSMETICS: LootCosmetic[] = [
  {
    id: "loot_starlit_eyes",
    category: "cosmetic",
    flavorText: "Eyes like distant stars.",
    apply: (c) => {
      c.bones.eye = "✦"; // ✦
    },
  },
  {
    id: "loot_void_gaze",
    category: "cosmetic",
    flavorText: "A deep, knowing gaze.",
    apply: (c) => {
      c.bones.eye = "◉"; // ◉
    },
  },
  {
    id: "loot_aurora",
    category: "cosmetic",
    flavorText: "An aurora shimmer settles over you.",
    apply: (c) => {
      c.bones.shiny = true;
    },
  },
  {
    id: "loot_wizard_hat",
    category: "cosmetic",
    flavorText: "A wizard's hat, slightly singed.",
    apply: (c) => {
      c.bones.hat = "wizard";
    },
  },
  {
    id: "loot_halo",
    category: "cosmetic",
    flavorText: "A halo, faintly humming.",
    apply: (c) => {
      c.bones.hat = "halo";
    },
  },
  {
    id: "loot_cosmic_static",
    category: "cosmetic",
    flavorText: "Cosmic static in both eyes — a shimmer to match.",
    apply: (c) => {
      // The "otherwise unreachable" combo: shiny + a rare eye in one drop.
      c.bones.shiny = true;
      c.bones.eye = "@";
    },
  },
];

// ─── Tunables (conservative by design — FR4.4 / NFR6) ─────────────────────────

/** Skill points always granted on a qualifying milestone roll. */
export const LOOT_BONUS_POINTS = 1;
/** Probability of a loot-exclusive cosmetic dropping on a roll. */
export const LOOT_COSMETIC_CHANCE = 0.12;
/** Maximum log entries retained (most-recent kept). */
export const LOOT_LOG_CAP = 50;

// ─── Atomic I/O ──────────────────────────────────────────────────────────────

function lootFile(): string {
  return join(buddyStateDir(), "loot.json");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function loadLoot(): LootState {
  try {
    const p = JSON.parse(readFileSync(lootFile(), "utf8")) as Partial<LootState>;
    return {
      log: Array.isArray(p.log) ? p.log : [],
      ownedLootCosmetics: Array.isArray(p.ownedLootCosmetics)
        ? p.ownedLootCosmetics
        : [],
    };
  } catch {
    return { log: [], ownedLootCosmetics: [] };
  }
}

export function saveLoot(state: LootState): void {
  mkdirSync(buddyStateDir(), { recursive: true });
  const file = lootFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(state));
  }
}

/** The most recent loot log entries (newest last), for display. */
export function recentLoot(limit: number = 3): LootLogEntry[] {
  const { log } = loadLoot();
  return log.slice(-Math.max(0, limit));
}

// ─── Roll ─────────────────────────────────────────────────────────────────────

/** Pick a random loot cosmetic the player doesn't already own, or null. */
function pickUnownedCosmetic(
  owned: string[],
  rng: () => number,
): LootCosmetic | null {
  const pool = LOOT_COSMETICS.filter((c) => !owned.includes(c.id));
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)] ?? null;
}

export interface LootDrop {
  /** Deterministic skill points granted (always LOOT_BONUS_POINTS). */
  bonusPoints: number;
  /** The cosmetic dropped this roll, or null if none. */
  cosmetic: LootCosmetic | null;
}

/**
 * Roll for loot at a milestone. Always grants the deterministic point bonus,
 * then rolls (default 12%) for an unowned loot-exclusive cosmetic; if one drops
 * it is applied to the active (or given) companion and recorded. The roll is
 * logged either way. `rng` is injectable so the cosmetic roll is testable
 * without flakiness (design risk R3).
 */
export function rollLoot(
  trigger: LootTrigger,
  slot?: string,
  rng: () => number = Math.random,
): LootDrop {
  // 1. Deterministic point — always granted (FR4.1 / FR4.3).
  grantBonusPoints(LOOT_BONUS_POINTS);

  const state = loadLoot();

  // 2. Cosmetic roll — bonus on top, gated by "unowned" so a maxed-loot player
  //    never wastes a roll (they just keep the guaranteed point).
  let cosmetic: LootCosmetic | null = null;
  if (rng() < LOOT_COSMETIC_CHANCE) {
    cosmetic = pickUnownedCosmetic(state.ownedLootCosmetics, rng);
    if (cosmetic) {
      const targetSlot = slot ?? loadActiveSlot();
      const companion = loadCompanionSlot(targetSlot);
      if (companion) {
        cosmetic.apply(companion);
        saveCompanionSlot(companion, targetSlot);
      }
      state.ownedLootCosmetics.push(cosmetic.id);
    }
  }

  // 3. Log (newest last), capped to the most-recent LOOT_LOG_CAP entries.
  state.log.push({
    id: cosmetic?.id ?? "points",
    grantedAt: nowSeconds(),
    trigger,
  });
  if (state.log.length > LOOT_LOG_CAP) {
    state.log = state.log.slice(-LOOT_LOG_CAP);
  }
  saveLoot(state);

  return { bonusPoints: LOOT_BONUS_POINTS, cosmetic };
}
