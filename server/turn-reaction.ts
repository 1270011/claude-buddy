#!/usr/bin/env bun
/**
 * Pick a hook-generated turn reaction for the buddy status line.
 * Called from hooks/buddy-comment.sh as a fallback when Claude Code v2.1.169+
 * renders <!-- buddy: --> comments visibly instead of hiding them.
 *
 * Usage: bun run server/turn-reaction.ts [slot]
 * Prints the reaction string to stdout.
 */

import { loadCompanionSlot, loadActiveSlot } from "./state.ts";
import { getReaction } from "./reactions.ts";

function main(): void {
  const slot = process.argv[2] ?? loadActiveSlot();
  const companion = loadCompanionSlot(slot);

  if (!companion) {
    process.exit(0);
  }

  const { species, rarity, stats } = companion.bones;
  const reaction = getReaction(
    "turn",
    species,
    rarity,
    stats as Record<string, number>,
  );

  process.stdout.write(reaction);
}

main();
