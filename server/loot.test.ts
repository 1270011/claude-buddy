/**
 * Tests for milestone loot boxes (additional-rewards FR4).
 *
 * The cosmetic `apply` functions are pure and pinned directly. rollLoot touches
 * the filesystem (loot.json + the durable bonus-point grant in xp.json), so it
 * runs against a temp CLAUDE_CONFIG_DIR — both loot.ts and xp.ts resolve their
 * state files at call time, so per-test env keeps each case hermetic.
 *
 * Safety: rollLoot is always called with an explicit, non-existent slot. The
 * companion store (state.ts) freezes its directory at module load, so a cosmetic
 * drop's companion lookup would otherwise hit the real profile — a missing slot
 * makes that lookup a pure read that returns null, so no real state is mutated.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  rollLoot,
  loadLoot,
  saveLoot,
  recentLoot,
  LOOT_COSMETICS,
  LOOT_COSMETIC_CHANCE,
  LOOT_BONUS_POINTS,
  LOOT_LOG_CAP,
} from "./loot.ts";
import { getXpState } from "./xp.ts";
import type { Companion } from "./engine.ts";

/** A slot that does not exist, so the companion lookup is a safe no-op read. */
const FAKE_SLOT = "loot-test-nonexistent-slot";

/** Minimal companion stub for testing cosmetic `apply` effects. */
function stubCompanion(): Companion {
  return {
    bones: { eye: "·", hat: "none", shiny: false },
  } as unknown as Companion;
}

// ─── Pure: cosmetic apply effects ─────────────────────────────────────────────

describe("LOOT_COSMETICS", () => {
  test("there are six loot-exclusive cosmetics, all category cosmetic", () => {
    expect(LOOT_COSMETICS.length).toBe(6);
    for (const c of LOOT_COSMETICS) expect(c.category).toBe("cosmetic");
  });

  test("ids are unique", () => {
    const ids = LOOT_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each carries flavor text and an apply effect", () => {
    for (const c of LOOT_COSMETICS) {
      expect(c.flavorText.length).toBeGreaterThan(0);
      expect(typeof c.apply).toBe("function");
    }
  });

  test("apply mutates the expected bones field", () => {
    const byId = (id: string) => LOOT_COSMETICS.find((c) => c.id === id)!;

    const eyes = stubCompanion();
    byId("loot_starlit_eyes").apply(eyes);
    expect(eyes.bones.eye).toBe("✦");

    const aurora = stubCompanion();
    byId("loot_aurora").apply(aurora);
    expect(aurora.bones.shiny).toBe(true);

    const wizard = stubCompanion();
    byId("loot_wizard_hat").apply(wizard);
    expect(wizard.bones.hat).toBe("wizard");

    // The "otherwise unreachable" combo sets two fields at once.
    const combo = stubCompanion();
    byId("loot_cosmic_static").apply(combo);
    expect(combo.bones.shiny).toBe(true);
    expect(combo.bones.eye).toBe("@");
  });
});

// ─── rollLoot (filesystem-backed) ─────────────────────────────────────────────

describe("rollLoot", () => {
  let cfgDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), "buddy-loot-test-"));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  test("always grants the deterministic point, even with no cosmetic", () => {
    const drop = rollLoot("level_up", FAKE_SLOT, () => 0.99); // above the chance
    expect(drop.bonusPoints).toBe(LOOT_BONUS_POINTS);
    expect(drop.cosmetic).toBeNull();
    // The point is durable in xp.json.
    expect(getXpState().bonusPoints).toBe(LOOT_BONUS_POINTS);
  });

  test("the deterministic point accumulates across rolls", () => {
    rollLoot("level_up", FAKE_SLOT, () => 0.99);
    rollLoot("achievement", FAKE_SLOT, () => 0.99);
    rollLoot("streak_milestone", FAKE_SLOT, () => 0.99);
    expect(getXpState().bonusPoints).toBe(3 * LOOT_BONUS_POINTS);
  });

  test("drops a cosmetic when the roll lands under the chance", () => {
    const drop = rollLoot("ascension", FAKE_SLOT, () => 0); // forces a drop
    expect(drop.cosmetic).not.toBeNull();
    expect(loadLoot().ownedLootCosmetics).toContain(drop.cosmetic!.id);
  });

  test("honors the 12% threshold exactly", () => {
    // Just under the chance → a cosmetic is attempted.
    const under = rollLoot("level_up", FAKE_SLOT, () => LOOT_COSMETIC_CHANCE - 0.001);
    expect(under.cosmetic).not.toBeNull();

    // Exactly at / above the chance → point only.
    const at = rollLoot("level_up", FAKE_SLOT, () => LOOT_COSMETIC_CHANCE);
    expect(at.cosmetic).toBeNull();
  });

  test("never grants an already-owned cosmetic (point only instead)", () => {
    // Pre-own every cosmetic, then force the cosmetic branch.
    saveLoot({
      log: [],
      ownedLootCosmetics: LOOT_COSMETICS.map((c) => c.id),
    });
    const drop = rollLoot("level_up", FAKE_SLOT, () => 0);
    expect(drop.cosmetic).toBeNull();
    expect(drop.bonusPoints).toBe(LOOT_BONUS_POINTS); // still gets the point
    expect(loadLoot().log.at(-1)!.id).toBe("points");
  });

  test("tags the log entry with the trigger type", () => {
    rollLoot("streak_milestone", FAKE_SLOT, () => 0.99);
    const last = loadLoot().log.at(-1)!;
    expect(last.trigger).toBe("streak_milestone");
    expect(last.id).toBe("points");
    expect(last.grantedAt).toBeGreaterThan(0);
  });

  test("a cosmetic drop logs the cosmetic id under its trigger", () => {
    const drop = rollLoot("ascension", FAKE_SLOT, () => 0);
    const last = loadLoot().log.at(-1)!;
    expect(last.id).toBe(drop.cosmetic!.id);
    expect(last.trigger).toBe("ascension");
  });

  test("caps the log at the most-recent LOOT_LOG_CAP entries", () => {
    for (let i = 0; i < LOOT_LOG_CAP + 5; i++) {
      rollLoot("level_up", FAKE_SLOT, () => 0.99);
    }
    expect(loadLoot().log.length).toBe(LOOT_LOG_CAP);
  });

  test("recentLoot returns the newest entries (newest last)", () => {
    rollLoot("level_up", FAKE_SLOT, () => 0.99);
    rollLoot("achievement", FAKE_SLOT, () => 0.99);
    rollLoot("ascension", FAKE_SLOT, () => 0.99);
    const recent = recentLoot(2);
    expect(recent.length).toBe(2);
    expect(recent[1].trigger).toBe("ascension");
  });

  test("an absent loot.json loads as an empty state", () => {
    expect(loadLoot()).toEqual({ log: [], ownedLootCosmetics: [] });
  });
});
