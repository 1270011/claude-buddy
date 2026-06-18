#!/usr/bin/env bun
/**
 * Lightweight XP awarding script — called from shell hooks.
 * Awards XP for coding events without loading the full MCP server.
 *
 * Usage:
 *   bun run server/award-xp.ts <event> [slot]
 *
 * Events: errors_spotted | tests_passed | tests_failed | large_diff | turn | time_spent | buddy_pet
 */

import { awardXp } from "./xp";
import { loadCompanionSlot, loadActiveSlot } from "./state";
import { startSession, awardSessionComplete } from "./session";
import type { XpEvent } from "./xp";

const VALID_EVENTS = new Set([
  "errors_spotted",
  "tests_passed",
  "tests_failed",
  "large_diff",
  "turn",
  "time_spent",
  "buddy_pet",
]);

// Session-lifecycle events route through session.ts rather than the fixed-XP
// path: session_start captures a baseline, session_complete awards the bonus.
const SESSION_EVENTS = new Set(["session_start", "session_complete"]);

function main(): void {
  const event = process.argv[2] as string;
  const slot = process.argv[3] ?? loadActiveSlot();

  if (!event || (!VALID_EVENTS.has(event) && !SESSION_EVENTS.has(event))) {
    const all = [...VALID_EVENTS, ...SESSION_EVENTS].join(" | ");
    console.error(
      `Usage: bun run server/award-xp.ts <event> [slot]\nValid events: ${all}`,
    );
    process.exit(1);
  }

  // Get species and rarity for bonus calculation
  const companion = loadCompanionSlot(slot);
  const species = companion?.bones.species;
  const rarity = companion?.bones.rarity;

  if (event === "session_start") {
    startSession();
    return;
  }

  if (event === "session_complete") {
    const { bonus, state } = awardSessionComplete(slot, species, rarity);
    console.log(
      `Session bonus: +${bonus} XP → Level ${state.level} (${state.totalXp.toLocaleString()} XP total)`,
    );
    return;
  }

  const state = awardXp(event as XpEvent, slot, species, rarity);
  console.log(
    `XP awarded: +${event} → Level ${state.level} (${state.totalXp.toLocaleString()} XP total)`,
  );
}

main();
