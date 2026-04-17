/**
 * Display-width tests — covers the U+2600-U+27BF split between Emoji_Presentation
 * (2 cols) and text-presentation (1 col), plus VS16 upgrades. Keeps bubble
 * padding and companion-card alignment stable when reactions/achievements
 * contain emoji.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { displayWidth } from "./art.ts";

describe("displayWidth", () => {
  test("ASCII has width equal to character count", () => {
    expect(displayWidth("")).toBe(0);
    expect(displayWidth("hola")).toBe(4);
    expect(displayWidth("hola  ")).toBe(6);
  });

  test("non-BMP emoji (U+1F000+) count as 2", () => {
    expect(displayWidth("\u{1F3C6}")).toBe(2); // 🏆
    expect(displayWidth("\u{1F9F9}")).toBe(2); // 🧹
  });

  test("Emoji_Presentation codepoints in U+2600-U+27BF count as 2", () => {
    expect(displayWidth("\u2705")).toBe(2); // ✅
    expect(displayWidth("\u274C")).toBe(2); // ❌
    expect(displayWidth("\u26A1")).toBe(2); // ⚡
    expect(displayWidth("\u2728")).toBe(2); // ✨
  });

  test("text-presentation symbols in U+2600-U+27BF stay 1 without VS16", () => {
    expect(displayWidth("\u2605")).toBe(1);           // ★
    expect(displayWidth("\u2605\u2605\u2605\u2605\u2605")).toBe(5); // ★★★★★ (rarity stars)
    expect(displayWidth("\u2660")).toBe(1);           // ♠
    expect(displayWidth("\u2764")).toBe(1);           // ❤ plain
  });

  test("VS16 upgrades narrow symbols in U+2600-U+27BF to 2", () => {
    expect(displayWidth("\u2764\uFE0F")).toBe(2); // ❤️
    expect(displayWidth("\u2600\uFE0F")).toBe(2); // ☀️
  });

  test("VS16 after an already-wide emoji does not add width", () => {
    expect(displayWidth("\u2705\uFE0F")).toBe(2);      // ✅ + VS16
    expect(displayWidth("\u{1F3C6}\uFE0F")).toBe(2);   // 🏆 + VS16
  });

  test("zero-width joiner and variation selectors don't add width", () => {
    expect(displayWidth("\u200D")).toBe(0);
    expect(displayWidth("\uFE00")).toBe(0);
  });

  test("ANSI escape sequences are stripped", () => {
    expect(displayWidth("\x1b[31mhola\x1b[0m")).toBe(4);
  });

  test("mixed ASCII + emoji matches terminal columns", () => {
    // "🏆 ✅ Good Buddy" → 2+1+2+1+10 = 16
    expect(displayWidth("\u{1F3C6} \u2705 Good Buddy")).toBe(16);
  });
});

describe("statusline/emoji-widths.data", () => {
  test("matches Unicode Emoji_Presentation in U+2600-U+27BF (regenerate via 'bun run gen:emoji-widths')", () => {
    const data = readFileSync(
      join(import.meta.dir, "..", "statusline", "emoji-widths.data"),
      "utf8",
    );
    const fileList = data
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .join(" ")
      .trim()
      .split(/\s+/)
      .map(Number);

    const re = /\p{Emoji_Presentation}/u;
    const expected: number[] = [];
    for (let cp = 0x2600; cp <= 0x27BF; cp++) {
      if (re.test(String.fromCodePoint(cp))) expected.push(cp);
    }
    expect(fileList).toEqual(expected);
  });
});
