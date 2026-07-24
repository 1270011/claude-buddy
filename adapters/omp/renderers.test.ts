import { describe, expect, test } from "bun:test";
import type { Companion, ReactionState } from "../../core/model.ts";
import { renderBuddyStatus, renderBuddyWidget } from "./renderers.ts";

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
  reaction: "*watching closely*",
  reason: "turn",
  timestamp: Date.now(),
};

describe("OMP buddy renderers", () => {
  test("keeps reactions out of the compact status line", () => {
    expect(renderBuddyStatus(companion)).not.toContain(reaction.reaction);
  });

  test("renders the reaction exactly once inside a framed bubble", () => {
    const rendered = renderBuddyWidget(companion, reaction).join("\n");

    expect(rendered.split(reaction.reaction)).toHaveLength(2);
    expect(rendered).toContain("╭──────────────────────────────────────────────╮");
    expect(rendered).toContain(`│ 💬 ${reaction.reaction} `);
    expect(rendered).toContain("╰──────────────────────────────────────────────╯");
    expect(rendered).not.toContain(`“${reaction.reaction}”`);
  });

  test("wraps long reactions at word boundaries", () => {
    const longReaction = "the stray new PiBuddyStorage() on every turn_end — silent wrong-directory config reads — that is the crack in the file";
    const lines = renderBuddyWidget(companion, { ...reaction, reaction: longReaction });
    const start = lines.indexOf("╭──────────────────────────────────────────────╮");
    const end = lines.indexOf("╰──────────────────────────────────────────────╯");

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(lines.slice(start, end + 1)).toEqual([
      "╭──────────────────────────────────────────────╮",
      "│ 💬 the stray new PiBuddyStorage() on every   │",
      "│ turn_end — silent wrong-directory config     │",
      "│ reads — that is the crack in the file        │",
      "╰──────────────────────────────────────────────╯",
    ]);
  });
});
