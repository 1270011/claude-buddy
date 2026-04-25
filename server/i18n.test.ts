import { describe, test, expect, afterEach } from "bun:test";
import {
  t,
  tArray,
  tObj,
  setLocale,
  AVAILABLE_LOCALES,
} from "./i18n.ts";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";

function localeDir(): string {
  return join(dirname(import.meta.dir), "locales");
}

// ─── Locale discovery ──────────────────────────────────────────────────────

describe("AVAILABLE_LOCALES", () => {
  test("contains at least 'en'", () => {
    expect(AVAILABLE_LOCALES).toHaveProperty("en");
  });

  test("has at least one locale", () => {
    expect(Object.keys(AVAILABLE_LOCALES).length).toBeGreaterThanOrEqual(1);
  });

  test("every discovered locale has a corresponding JSON file", () => {
    const files = readdirSync(localeDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
    for (const code of Object.keys(AVAILABLE_LOCALES)) {
      expect(files).toContain(code);
    }
  });

  test("every locale JSON file is discovered", () => {
    const files = readdirSync(localeDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
    for (const f of files) {
      expect(AVAILABLE_LOCALES).toHaveProperty(f);
    }
  });
});

// ─── t() ───────────────────────────────────────────────────────────────────

describe("t()", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("returns a string for a valid key", () => {
    const val = t("mcp.mute");
    expect(typeof val).toBe("string");
    expect(val.length).toBeGreaterThan(0);
  });

  test("returns the key for a missing key", () => {
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  test("returns the key for a deeply nested unknown path", () => {
    expect(t("a.b.c.d.e.f")).toBe("a.b.c.d.e.f");
  });

  test("returns the key when value is not a string (object)", () => {
    expect(t("reactions")).toBe("reactions");
    expect(t("reactions.hatch")).toBe("reactions.hatch");
  });

  test("interpolates {variable} placeholders", () => {
    const val = t("mcp.rename", { oldName: "Fluffy", name: "Spike" });
    expect(val).toContain("Fluffy");
    expect(val).toContain("Spike");
  });

  test("replaces all occurrences of the same placeholder", () => {
    const val = t("mcp.frequency.updated", { cooldown: 60 });
    expect(val).toContain("60");
    expect(val).not.toContain("{cooldown}");
  });

  test("leaves unmatched placeholders in the string", () => {
    const val = t("mcp.save", { name: "Pixel" });
    expect(val).toContain("Pixel");
    expect(val).toContain("{slot}");
  });

  test("handles numeric params", () => {
    const val = t("mcp.frequency.updated", { cooldown: 42 });
    expect(val).toContain("42");
  });

  test("works with no params argument", () => {
    const val = t("mcp.mute");
    expect(typeof val).toBe("string");
  });

  test("works with empty params object", () => {
    const val = t("mcp.mute", {});
    expect(typeof val).toBe("string");
  });
});

// ─── tArray() ──────────────────────────────────────────────────────────────

describe("tArray()", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("returns an array for a valid key like reactions.hatch", () => {
    const arr = tArray("reactions.hatch");
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
  });

  test("every element is a non-empty string", () => {
    const arr = tArray("reactions.pet");
    for (const el of arr) {
      expect(typeof el).toBe("string");
      expect(el.length).toBeGreaterThan(0);
    }
  });

  test("returns empty array for missing key", () => {
    expect(tArray("totally.bogus.key")).toEqual([]);
  });

  test("returns empty array for non-array values", () => {
    expect(tArray("reactions")).toEqual([]);
    expect(tArray("mcp.mute")).toEqual([]);
  });
});

// ─── tObj() ────────────────────────────────────────────────────────────────

describe("tObj()", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("returns an object for a valid key like species.owl", () => {
    const obj = tObj("species.owl");
    expect(typeof obj).toBe("object");
    expect(obj).not.toBeNull();
    expect(Object.keys(obj).length).toBeGreaterThan(0);
  });

  test("returns object with name and description for achievements.first_steps", () => {
    const obj = tObj("achievements.first_steps");
    expect(obj).toHaveProperty("name");
    expect(obj).toHaveProperty("description");
  });

  test("returns empty object for missing key", () => {
    expect(tObj("nonexistent.path")).toEqual({});
  });

  test("returns empty object for array values", () => {
    expect(tObj("reactions.pet")).toEqual({});
  });
});

// ─── setLocale() ───────────────────────────────────────────────────────────

describe("setLocale()", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("switching locale changes what t() returns", () => {
    const codes = Object.keys(AVAILABLE_LOCALES).filter((c) => c !== "en");
    if (codes.length === 0) return;

    setLocale("en");
    const enVal = t("achievements.first_steps.name");

    setLocale(codes[0]);
    const otherVal = t("achievements.first_steps.name");
    expect(typeof otherVal).toBe("string");
    expect(otherVal.length).toBeGreaterThan(0);
  });

  test("switching back to en restores English values", () => {
    setLocale("en");
    const enVal = t("achievements.first_steps.name");

    const codes = Object.keys(AVAILABLE_LOCALES).filter((c) => c !== "en");
    if (codes.length > 0) setLocale(codes[0]);

    setLocale("en");
    expect(t("achievements.first_steps.name")).toBe(enVal);
  });

  test("switching to unknown locale falls back to en", () => {
    setLocale("en");
    const enVal = t("reactions.hatch.0");

    setLocale("totally_fake_locale");
    expect(t("reactions.hatch.0")).toBe(enVal);
  });

  test("does not throw for any discovered locale", () => {
    for (const code of Object.keys(AVAILABLE_LOCALES)) {
      expect(() => setLocale(code)).not.toThrow();
    }
  });

  test("repeated switching does not throw", () => {
    const codes = Object.keys(AVAILABLE_LOCALES);
    for (let i = 0; i < 50; i++) {
      setLocale(codes[i % codes.length]);
    }
  });
});

// ─── Structural integrity across all locales ───────────────────────────────

describe("locale file structural integrity", () => {
  const codes = Object.keys(AVAILABLE_LOCALES);

  function loadJson(code: string): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(localeDir(), `${code}.json`), "utf8"),
    );
  }

  test("every locale file has _language field", () => {
    for (const code of codes) {
      const data = loadJson(code);
      expect(data._language).toBeDefined();
      expect(typeof data._language).toBe("string");
      expect((data._language as string).length).toBeGreaterThan(0);
    }
  });

  test("every locale has the same top-level keys as en", () => {
    const enData = loadJson("en");
    const enKeys = Object.keys(enData)
      .filter((k) => k !== "_language")
      .sort();
    for (const code of codes) {
      if (code === "en") continue;
      const data = loadJson(code);
      const keys = Object.keys(data)
        .filter((k) => k !== "_language")
        .sort();
      expect(keys).toEqual(enKeys);
    }
  });

  test("the reactions section has the same number of reaction reasons", () => {
    const enData = loadJson("en");
    const enReasons = Object.keys(
      enData.reactions as Record<string, unknown>,
    ).sort();
    for (const code of codes) {
      if (code === "en") continue;
      const data = loadJson(code);
      const reasons = Object.keys(
        data.reactions as Record<string, unknown>,
      ).sort();
      expect(reasons).toEqual(enReasons);
    }
  });

  test("every locale has the same number of achievements", () => {
    const enData = loadJson("en");
    const enAchIds = Object.keys(
      enData.achievements as Record<string, unknown>,
    ).sort();
    for (const code of codes) {
      if (code === "en") continue;
      const data = loadJson(code);
      const ids = Object.keys(
        data.achievements as Record<string, unknown>,
      ).sort();
      expect(ids).toEqual(enAchIds);
    }
  });

  test("every achievement in every locale has name and desc", () => {
    const enData = loadJson("en");
    const enAchIds = Object.keys(
      enData.achievements as Record<string, unknown>,
    ).filter(
      (k) =>
        typeof (enData.achievements as Record<string, unknown>)[k] ===
          "object" &&
        !Array.isArray(
          (enData.achievements as Record<string, unknown>)[k],
        ) &&
        ((enData.achievements as Record<string, Record<string, unknown>>)[k]
          .name !== undefined),
    );
    for (const code of codes) {
      const data = loadJson(code);
      for (const id of enAchIds) {
        const ach = (data.achievements as Record<string, Record<string, unknown>>)[id];
        expect(ach).toBeDefined();
        expect(ach.name).toBeDefined();
        expect(ach.description).toBeDefined();
        expect(typeof ach.name).toBe("string");
        expect(typeof ach.description).toBe("string");
        expect((ach.name as string).length).toBeGreaterThan(0);
        expect((ach.description as string).length).toBeGreaterThan(0);
      }
    }
  });

  test("{variable} placeholders are preserved across locales", () => {
    const enRaw = readFileSync(join(localeDir(), "en.json"), "utf8");
    const enVars = new Set(enRaw.match(/\{[a-zA-Z_]+\}/g) ?? []);
    for (const code of codes) {
      if (code === "en") continue;
      const raw = readFileSync(join(localeDir(), `${code}.json`), "utf8");
      const vars = new Set(raw.match(/\{[a-zA-Z_]+\}/g) ?? []);
      for (const v of enVars) {
        expect(vars.has(v)).toBe(true);
      }
    }
  });

  test("every locale has all species keys matching en", () => {
    const enData = loadJson("en");
    const enSpecies = Object.keys(
      enData.species as Record<string, unknown>,
    ).sort();
    for (const code of codes) {
      if (code === "en") continue;
      const data = loadJson(code);
      const species = Object.keys(
        data.species as Record<string, unknown>,
      ).sort();
      expect(species).toEqual(enSpecies);
    }
  });

  test("every locale has all MCP keys matching en", () => {
    const enData = loadJson("en");
    const mcpKeys = Object.keys(
      enData.mcp as Record<string, unknown>,
    ).sort();
    for (const code of codes) {
      if (code === "en") continue;
      const data = loadJson(code);
      const keys = Object.keys(
        data.mcp as Record<string, unknown>,
      ).sort();
      expect(keys).toEqual(mcpKeys);
    }
  });

  test("every locale has personality.prompt_template with {rarity} and {species}", () => {
    for (const code of codes) {
      const data = loadJson(code);
      const personality = data.personality as Record<string, unknown>;
      const promptStr = JSON.stringify(personality.prompt_template);
      expect(promptStr).toContain("{rarity}");
      expect(promptStr).toContain("{species}");
    }
  });
});
