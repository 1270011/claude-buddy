import { describe, test, expect } from "bun:test";
import {
  getReaction,
  generateFallbackName,
} from "./reactions.ts";
import { SPECIES, RARITIES, STAT_NAMES } from "./engine.ts";

const REASONS = [
  "hatch", "pet", "error", "test-fail", "large-diff", "turn", "idle",
  "commit", "push", "merge-conflict", "branch", "rebase", "stash", "tag",
  "late-night", "early-morning", "long-session", "marathon", "friday", "weekend", "monday",
  "lint-fail", "type-error", "build-fail", "security-warning", "deprecation",
  "frustrated", "happy", "stuck", "sarcastic",
  "many-edits", "delete-file", "large-file", "create-file",
  "all-green", "deploy", "release", "coverage",
  "debug-loop", "write-spree", "search-heavy",
  "recovery-from-error", "recovery-from-test-fail",
  "recovery-from-build-fail", "recovery-from-merge-conflict",
  "late-night-error", "late-night-commit", "friday-push",
  "marathon-error", "weekend-conflict", "build-after-push", "marathon-test-fail",
  "lang-python", "lang-typescript", "lang-rust", "lang-go",
  "lang-java", "lang-ruby", "lang-php", "lang-c",
  "lang-cpp", "lang-haskell", "lang-swift", "lang-elixir",
  "lang-zig", "lang-kotlin",
  "streak-3", "streak-5", "streak-10", "streak-20",
  "new-year", "valentines", "pi-day", "april-fools",
  "halloween", "christmas", "new-years-eve", "spooky-season",
  "success",
  "regex-file", "css-file", "sql-file", "docker-file", "ci-file", "lock-file",
  "env-file", "test-file", "doc-file", "config-file", "binary-file", "gitignore",
  "makefile", "readme", "package-file", "proto-file",
] as const;

describe("getReaction", () => {
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
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("error", "owl", "common", undefined, { line: 42 });
      if (r.includes("42")) sawSubstitution = true;
      expect(r).not.toContain("{line}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("substitutes {count} placeholder in test-fail reactions", () => {
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("test-fail", "robot", "common", undefined, { count: 7 });
      if (r.includes("7")) sawSubstitution = true;
      expect(r).not.toContain("{count}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("substitutes {lines} placeholder in large-diff reactions", () => {
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("large-diff", "dragon", "legendary", undefined, { lines: 999 });
      if (r.includes("999")) sawSubstitution = true;
      expect(r).not.toContain("{lines}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("substitutes {files} placeholder in commit reactions", () => {
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("commit", "blob", "common", undefined, { files: 5 });
      if (r.includes("5")) sawSubstitution = true;
      expect(r).not.toContain("{files}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("substitutes {branch} placeholder in branch reactions", () => {
    let sawSubstitution = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("branch", "duck", "common", undefined, { branch: "feature" });
      if (r.includes("feature")) sawSubstitution = true;
      expect(r).not.toContain("{branch}");
    }
    expect(sawSubstitution).toBe(true);
  });

  test("works without stats or context", () => {
    for (let i = 0; i < 50; i++) {
      const r = getReaction("pet", "cat", "rare");
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  test("works with stats but no context", () => {
    const stats = { DEBUGGING: 80, PATIENCE: 20, CHAOS: 10, WISDOM: 30, SNARK: 5 };
    for (let i = 0; i < 50; i++) {
      const r = getReaction("error", "cat", "rare", stats);
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  test("high SNARK stats can produce snarky reactions", () => {
    const snarkyStats = { DEBUGGING: 10, PATIENCE: 10, CHAOS: 10, WISDOM: 10, SNARK: 95 };
    let sawSnark = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("error", "blob", "common", snarkyStats);
      if (r.includes("unexpected") || r.includes("truly") || r.includes("consider")) {
        sawSnark = true;
      }
    }
    expect(sawSnark).toBe(true);
  });

  test("high PATIENCE stats can produce calm reactions", () => {
    const patientStats = { DEBUGGING: 10, PATIENCE: 95, CHAOS: 10, WISDOM: 10, SNARK: 5 };
    let sawPatience = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("error", "blob", "common", patientStats);
      if (r.includes("worse") || r.includes("fixable") || r.includes("steady")) {
        sawPatience = true;
      }
    }
    expect(sawPatience).toBe(true);
  });

  test("low stats do not override reactions", () => {
    const lowStats = { DEBUGGING: 5, PATIENCE: 5, CHAOS: 5, WISDOM: 5, SNARK: 5 };
    for (let i = 0; i < 50; i++) {
      const r = getReaction("error", "owl", "common", lowStats);
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  test("legendary rarity can produce flair", () => {
    let sawFlair = false;
    for (let i = 0; i < 500; i++) {
      const r = getReaction("pet", "dragon", "legendary");
      if (r.includes("legendary") || r.includes("ancient") || r.includes("reality")) {
        sawFlair = true;
      }
    }
    expect(sawFlair).toBe(true);
  });

  test("common rarity never adds flair", () => {
    for (let i = 0; i < 100; i++) {
      const r = getReaction("pet", "cat", "common");
      expect(r).not.toMatch(/legendary aura|epic presence|rare energy|uncommon charm/);
    }
  });

  test("species with no custom pool still returns a general reaction", () => {
    for (const reason of REASONS) {
      for (let i = 0; i < 20; i++) {
        const r = getReaction(reason, "chonk", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });

  test("git reason reactions work for all species", () => {
    const gitReasons = ["commit", "push", "merge-conflict", "branch", "rebase", "stash", "tag"] as const;
    for (const reason of gitReasons) {
      for (const species of SPECIES) {
        for (let i = 0; i < 10; i++) {
          const r = getReaction(reason, species, "common");
          expect(r.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("build/quality reason reactions work", () => {
    const qualityReasons = ["lint-fail", "type-error", "build-fail", "security-warning", "deprecation"] as const;
    for (const reason of qualityReasons) {
      for (let i = 0; i < 50; i++) {
        const r = getReaction(reason, "robot", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });

  test("mood reason reactions work", () => {
    const moods = ["frustrated", "happy", "stuck"] as const;
    for (const mood of moods) {
      for (let i = 0; i < 50; i++) {
        const r = getReaction(mood, "cat", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });

  test("milestone reason reactions work", () => {
    const milestones = ["all-green", "deploy", "release", "coverage"] as const;
    for (const reason of milestones) {
      for (let i = 0; i < 50; i++) {
        const r = getReaction(reason, "duck", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });

  test("language reason reactions work", () => {
    const langs = ["lang-python", "lang-rust", "lang-typescript", "lang-go", "lang-haskell"] as const;
    for (const lang of langs) {
      for (let i = 0; i < 50; i++) {
        const r = getReaction(lang, "owl", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });

  test("holiday reason reactions work", () => {
    const holidays = ["halloween", "christmas", "new-year", "april-fools"] as const;
    for (const holiday of holidays) {
      for (let i = 0; i < 50; i++) {
        const r = getReaction(holiday, "ghost", "common");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });
});

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
      expect(name).toMatch(/^[A-Z][a-z]+$/);
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(12);
    }
  });

  test("picks multiple distinct names over many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateFallbackName());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
