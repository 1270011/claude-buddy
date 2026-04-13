/**
 * Unit tests for reactions.ts.
 *
 * Unlike engine.ts, reactions.ts uses Math.random() and is therefore not
 * deterministic. We can still make solid assertions about invariants:
 *
 *   - the shape of the return value (non-empty string)
 *   - template placeholder substitution
 *   - structural content of generatePersonalityPrompt
 *
 * Each non-deterministic assertion is run many times so that a single
 * lucky RNG pick cannot hide a real bug.
 */

import { describe, test, expect } from "bun:test";
import {
  getReaction,
  generateFallbackName,
  generatePersonalityPrompt,
} from "./reactions.ts";
import { SPECIES, RARITIES, STAT_NAMES } from "./engine.ts";

// ─── getReaction ──────────────────────────────────────────────────────────

describe("getReaction", () => {
  const REASONS = [
    "hatch",
    "pet",
    "error",
    "test-fail",
    "large-diff",
    "turn",
    "idle",
  ] as const;

  test("returns a non-empty string for every (reason, species, rarity) combo", () => {
    for (const reason of REASONS) {
      for (const species of SPECIES) {
        for (const rarity of RARITIES) {
          const r = getReaction(reason, species, rarity);
          expect(typeof r).toBe("string");
          expect(r.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("substitutes {line} placeholder when context.line is provided", () => {
    // The "error" pool contains a template with {line}. Run enough times that
    // we're very likely to hit it at least once, then assert the substitution.
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("error", "owl", "common", { line: 42 });
      if (r.includes("42")) {
        sawSubstitution = true;
      }
      // Regardless of which template is picked, {line} must not leak through
      expect(r).not.toContain("{line}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("substitutes {count} placeholder in test-fail reactions", () => {
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("test-fail", "robot", "common", { count: 7 });
      if (r.includes("7")) sawSubstitution = true;
      expect(r).not.toContain("{count}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("substitutes {lines} placeholder in large-diff reactions", () => {
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("large-diff", "dragon", "legendary", { lines: 999 });
      if (r.includes("999")) sawSubstitution = true;
      expect(r).not.toContain("{lines}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("works without a context argument", () => {
    for (let i = 0; i < 50; i++) {
      const r = getReaction("pet", "cat", "rare");
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  test("species with no custom pool still returns a general reaction", () => {
    // 'chonk' intentionally has no species-specific entries in reactions.ts
    for (const reason of REASONS) {
      for (let i = 0; i < 20; i++) {
        const r = getReaction(reason, "chonk", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── generateFallbackName ─────────────────────────────────────────────────

describe("generateFallbackName", () => {
  test("returns a non-empty string", () => {
    for (let i = 0; i < 20; i++) {
      const name = generateFallbackName();
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("names look like words: capitalized, alphabetic, reasonable length", () => {
    for (let i = 0; i < 100; i++) {
      const name = generateFallbackName();
      // Starts with uppercase, followed by lowercase letters only
      expect(name).toMatch(/^[A-Z][a-z]+$/);
      // Reasonable length bounds for the curated list
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(12);
    }
  });

  test("picks multiple distinct names over many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateFallbackName());
    }
    // With 18 names in the pool, 200 draws should produce well more than one.
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ─── generatePersonalityPrompt ────────────────────────────────────────────

describe("generatePersonalityPrompt", () => {
  const sampleStats = {
    DEBUGGING: 42,
    PATIENCE: 73,
    CHAOS: 12,
    WISDOM: 88,
    SNARK: 55,
  };

  test("includes the species and uppercased rarity", () => {
    const prompt = generatePersonalityPrompt(
      "turtle",
      "legendary",
      sampleStats,
      false,
    );
    expect(prompt).toContain("Species: turtle");
    expect(prompt).toContain("Rarity: LEGENDARY");
  });

  test("includes every stat name and its value", () => {
    const prompt = generatePersonalityPrompt(
      "owl",
      "rare",
      sampleStats,
      false,
    );
    for (const [name, value] of Object.entries(sampleStats)) {
      expect(prompt).toContain(`${name}:${value}`);
    }
  });

  test("marks shiny variants with the SHINY tag", () => {
    const shinyPrompt = generatePersonalityPrompt(
      "dragon",
      "epic",
      sampleStats,
      true,
    );
    const plainPrompt = generatePersonalityPrompt(
      "dragon",
      "epic",
      sampleStats,
      false,
    );
    expect(shinyPrompt).toContain("SHINY");
    expect(plainPrompt).not.toContain("SHINY");
  });

  test("includes the JSON output instruction", () => {
    const prompt = generatePersonalityPrompt(
      "cat",
      "common",
      sampleStats,
      false,
    );
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"personality"');
  });

  test("includes exactly 4 inspiration vibe words", () => {
    for (let i = 0; i < 20; i++) {
      const prompt = generatePersonalityPrompt(
        "blob",
        "uncommon",
        sampleStats,
        false,
      );
      // The line looks like: "Inspiration words: a, b, c, d"
      const match = prompt.match(/Inspiration words: (.+)/);
      expect(match).not.toBeNull();
      const words = match![1].split(",").map((w) => w.trim());
      expect(words.length).toBe(4);
      for (const w of words) {
        expect(w.length).toBeGreaterThan(0);
        expect(w).toMatch(/^[a-z]+$/);
      }
    }
  });

  test("shape is stable: same set of lines in the same order (ignoring vibes)", () => {
    const prompt = generatePersonalityPrompt(
      "penguin",
      "rare",
      { DEBUGGING: 1, PATIENCE: 2, CHAOS: 3, WISDOM: 4, SNARK: 5 },
      false,
    );
    const lines = prompt.split("\n");
    // Sanity: the fixed header line is there
    expect(lines[0]).toMatch(/Generate a coding companion/);
    // The "don't repeat yourself" instruction
    expect(prompt).toContain("distinct");
    // Stats come before inspiration words
    const statsIdx = lines.findIndex((l) => l.startsWith("Stats:"));
    const vibesIdx = lines.findIndex((l) => l.startsWith("Inspiration words:"));
    expect(statsIdx).toBeGreaterThan(-1);
    expect(vibesIdx).toBeGreaterThan(statsIdx);
  });

  test("does not crash for any valid species and rarity", () => {
    for (const species of SPECIES) {
      for (const rarity of RARITIES) {
        const prompt = generatePersonalityPrompt(
          species,
          rarity,
          sampleStats,
          false,
        );
        expect(typeof prompt).toBe("string");
        expect(prompt.length).toBeGreaterThan(0);
      }
    }
  });

  test("handles stats with arbitrary names (not just the five canonical ones)", () => {
    // The function uses Object.entries, so it should accept any keys.
    const customStats = { FOO: 10, BAR: 20 };
    const prompt = generatePersonalityPrompt(
      "mushroom",
      "common",
      customStats,
      false,
    );
    expect(prompt).toContain("FOO:10");
    expect(prompt).toContain("BAR:20");
  });

  // Defensive: make sure the canonical stat names are still what the engine
  // uses. If the engine adds a stat, personality prompts will silently
  // miss it unless someone updates generatePersonalityPrompt — this test
  // makes that assumption visible.
  test("all canonical STAT_NAMES flow through cleanly", () => {
    const full: Record<string, number> = {};
    for (const n of STAT_NAMES) full[n] = 50;
    const prompt = generatePersonalityPrompt("duck", "rare", full, false);
    for (const n of STAT_NAMES) {
      expect(prompt).toContain(`${n}:50`);
    }
  });
});
