/**
 * Unit tests for the pure string helpers in state.ts.
 *
 * The rest of state.ts is file I/O against ~/.claude-buddy/ and is not
 * covered here — those integration-style cases belong in a separate suite
 * with a proper temp directory. slugify() is a pure function though, so
 * it's easy to pin down.
 */

import { describe, test, expect } from "bun:test";
import { normalizeConfig, slugify } from "./state.ts";

describe("normalizeConfig", () => {
  test("leaves subStatusCommand unset by default", () => {
    expect(normalizeConfig({}).subStatusCommand).toBeUndefined();
  });

  test("preserves a configured subStatusCommand", () => {
    expect(normalizeConfig({ subStatusCommand: "ccstatusline" }).subStatusCommand)
      .toBe("ccstatusline");
  });

  test("treats empty and non-string subStatusCommand values as unset", () => {
    expect(normalizeConfig({ subStatusCommand: "  " }).subStatusCommand).toBeUndefined();
    expect(normalizeConfig({ subStatusCommand: null }).subStatusCommand).toBeUndefined();
  });

  test("defaults and validates subStatusRefreshSeconds", () => {
    expect(normalizeConfig({}).subStatusRefreshSeconds).toBe(15);
    expect(normalizeConfig({ subStatusRefreshSeconds: 30 }).subStatusRefreshSeconds).toBe(30);
    expect(normalizeConfig({ subStatusRefreshSeconds: "30" }).subStatusRefreshSeconds).toBe(15);
    expect(normalizeConfig({ subStatusRefreshSeconds: 0 }).subStatusRefreshSeconds).toBe(15);
  });
});

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
