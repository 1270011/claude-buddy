import { describe, expect, test } from "bun:test";
import type { Companion, ReactionState } from "../../core/model.ts";
import { displayWidth, renderCompanionWidget, stripAnsi, subscribeToWidgetResize } from "./widget-layout.ts";

const companion: Companion = {
  name: "Nimbus",
  personality: "quietly observant",
  userId: "test-user",
  hatchedAt: 0,
  bones: {
    rarity: "uncommon",
    species: "blob",
    eye: "°",
    hat: "none",
    shiny: false,
    peak: "WISDOM",
    dump: "CHAOS",
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 40, WISDOM: 90, SNARK: 40 },
  },
};

const reaction: ReactionState = {
  reaction: "*blinks slowly* slicing backwards, the ancient way",
  reason: "turn",
  timestamp: 0,
};

describe("shared buddy widget layout", () => {
  test.each([40, 60, 80, 120])("keeps the hero composition safe at %i columns", (width) => {
    const lines = renderCompanionWidget(companion, reaction, [], width, 0);
    const plain = lines.map(stripAnsi);
    const tailLine = plain.find((line) => line.includes("--   "));
    const artLine = plain.find((line) => line.includes("( °  ° )"));

    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.every((line) => displayWidth(line) <= width)).toBe(true);
    expect(tailLine).toBeDefined();
    expect(tailLine!.indexOf("--   ")).toBeLessThan(tailLine!.indexOf("( °  ° )"));
    expect(plain.at(-1)).toContain("Nimbus");
    expect(artLine).toBeDefined();
  });

  test("drops the frame and tail together when the sprite cannot fit", () => {
    const lines = renderCompanionWidget(companion, reaction, [], 24, 0);
    const plain = lines.map(stripAnsi).join("\n");

    expect(plain).not.toMatch(/\|.*\|--   /);
    expect(plain).not.toMatch(/^ *\.[-]{12,}\.$/m);
    expect(lines.every((line) => displayWidth(line) <= 24)).toBe(true);
  });

  test("applies rarity color to the bubble card, sprite, and centered name", () => {
    const lines = renderCompanionWidget(companion, reaction, [], 80, 0);
    const colored = lines.filter((line) => line.includes("\x1b[38;2;78;186;101m"));

    expect(colored.some((line) => stripAnsi(line).includes("( °  ° )"))).toBe(true);
    expect(colored.some((line) => stripAnsi(line).includes("Nimbus ★★"))).toBe(true);
  });

  test("notifies resize subscribers and removes them cleanly", () => {
    let calls = 0;
    const unsubscribe = subscribeToWidgetResize(() => {
      calls += 1;
    });

    process.stdout.emit("resize");
    expect(calls).toBe(1);
    unsubscribe();
    process.stdout.emit("resize");
    expect(calls).toBe(1);
  });
});
