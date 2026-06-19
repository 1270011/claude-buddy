/**
 * Unit tests for the pure string helpers in state.ts.
 *
 * The rest of state.ts is file I/O against ~/.claude-buddy/ and is not
 * covered here — those integration-style cases belong in a separate suite
 * with a proper temp directory. slugify() is a pure function though, so
 * it's easy to pin down.
 */

import { describe, test, expect } from "bun:test";
import { slugify, raritySetProgress } from "./state.ts";
import type { Companion, Rarity } from "./engine.ts";

/** Build a companions record from a list of rarities (other bones irrelevant). */
function companionsWithRarities(
  rarities: Rarity[],
): Record<string, Companion> {
  const out: Record<string, Companion> = {};
  rarities.forEach((rarity, i) => {
    out[`slot${i}`] = { bones: { rarity } } as unknown as Companion;
  });
  return out;
}

describe("slugify", () => {
  test("lowercases input", () => {
    expect(slugify("Sesame")).toBe("sesame");
    expect(slugify("BIG_BUDDY")).toBe("big-buddy");
  });

  test("replaces invalid characters with a dash", () => {
    expect(slugify("hello world")).toBe("hello-world");
    expect(slugify("foo@bar")).toBe("foo-bar");
    expect(slugify("a/b/c")).toBe("a-b-c");
  });

  test("collapses consecutive dashes", () => {
    expect(slugify("foo   bar")).toBe("foo-bar");
    expect(slugify("a!!!b")).toBe("a-b");
  });

  test("trims leading and trailing dashes", () => {
    expect(slugify("---hi---")).toBe("hi");
    expect(slugify("  buddy  ")).toBe("buddy");
  });

  test("truncates to 14 characters", () => {
    const long = "abcdefghijklmnopqrstuvwxyz";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(14);
    expect(result).toBe("abcdefghijklmn");
  });

  test("falls back to 'buddy' for empty or all-invalid input", () => {
    expect(slugify("")).toBe("buddy");
    expect(slugify("!!!")).toBe("buddy");
    expect(slugify("   ")).toBe("buddy");
  });

  test("preserves digits and internal dashes", () => {
    expect(slugify("buddy-2")).toBe("buddy-2");
    expect(slugify("v1-0-3")).toBe("v1-0-3");
  });

  test("unicode / emoji input falls back to 'buddy'", () => {
    expect(slugify("🐢")).toBe("buddy");
    expect(slugify("日本語")).toBe("buddy");
  });
});

describe("raritySetProgress (additional-rewards FR3)", () => {
  test("an empty menagerie owns nothing", () => {
    const p = raritySetProgress({});
    expect(p.ownedCount).toBe(0);
    expect(p.total).toBe(5);
    expect(p.complete).toBe(false);
  });

  test("counts distinct rarities, ignoring duplicates", () => {
    const p = raritySetProgress(
      companionsWithRarities(["common", "common", "rare"]),
    );
    expect(p.owned).toEqual(["common", "rare"]);
    expect(p.ownedCount).toBe(2);
    expect(p.complete).toBe(false);
  });

  test("reports the missing tiers in canonical order", () => {
    const p = raritySetProgress(
      companionsWithRarities(["common", "uncommon", "rare"]),
    );
    expect(p.missing).toEqual(["epic", "legendary"]);
  });

  test("is complete only when all five tiers are present", () => {
    const four = raritySetProgress(
      companionsWithRarities(["common", "uncommon", "rare", "epic"]),
    );
    expect(four.complete).toBe(false);
    expect(four.ownedCount).toBe(4);

    const all = raritySetProgress(
      companionsWithRarities([
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
      ]),
    );
    expect(all.complete).toBe(true);
    expect(all.missing).toEqual([]);
    expect(all.ownedCount).toBe(5);
  });
});
