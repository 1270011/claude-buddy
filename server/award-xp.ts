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

import { awardXp, getXpState } from "./xp";
import {
  loadCompanionSlot,
  loadActiveSlot,
  writeStatusState,
  type Celebration,
  type StatusOpts,
} from "./state";
import { startSession, awardSessionComplete } from "./session";
import { recordSessionStart } from "./streak";
import { tickWhim } from "./quests";
import { announceOnce } from "./discovery";
import type { XpEvent } from "./xp";

/**
 * Pick the celebration to surface for an award. Level-up wins the single bubble
 * slot; then a just-completed daily whim; then a one-time system discovery;
 * otherwise the caller's fallback cause (so session-completion can still surface
 * streak loot via the 🎁 toast).
 */
function pickCelebration(
  level: number,
  leveled: boolean,
  whimRewarded: boolean,
  discovered: boolean,
  fallbackCause: StatusOpts["cause"],
): { celebration: Celebration | null; cause: StatusOpts["cause"] } {
  if (leveled) {
    return {
      celebration: { text: `✨ LEVEL ${level} ✨`, kind: "levelup", at: Date.now() },
      cause: "levelup",
    };
  }
  if (whimRewarded) {
    return {
      celebration: { text: "⭐ today's whim — done!", kind: "whim", at: Date.now() },
      cause: "whim",
    };
  }
  if (discovered) {
    return {
      celebration: {
        text: "🎁 new: a daily whim — see /buddy xp",
        kind: "discovery",
        at: Date.now(),
      },
      cause: undefined,
    };
  }
  return { celebration: null, cause: fallbackCause };
}

/** Reconcile today's whim, swallowing any failure (game-feel NFR4). */
function safeTickWhim(slot?: string): boolean {
  try {
    return tickWhim(slot).justRewarded;
  } catch {
    return false;
  }
}

/**
 * Announce the daily-whim system once ever — but only when nothing higher
 * (level-up / whim reward) is already taking the bubble, so the introduction
 * is actually seen. Best-effort.
 */
function maybeDiscoverWhim(suppressed: boolean): boolean {
  if (suppressed) return false;
  try {
    return announceOnce("whim");
  } catch {
    return false;
  }
}

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
    // Break the streak if the previous session never committed, then capture
    // the new baseline (additional-rewards FR2).
    recordSessionStart();
    startSession();
    return;
  }

  if (event === "session_complete") {
    const prevLevel = getXpState().level;
    const { bonus, state } = awardSessionComplete(slot, species, rarity);
    // A commit ticks the daily whim (commits_made was bumped before this runs).
    const whimRewarded = safeTickWhim(slot);
    if (companion) {
      const leveled = state.level > prevLevel;
      const discovered = maybeDiscoverWhim(leveled || whimRewarded);
      // Fallback "loot" so any streak/whim loot drop surfaces as a 🎁 toast.
      const { celebration, cause } = pickCelebration(
        state.level,
        leveled,
        whimRewarded,
        discovered,
        "loot",
      );
      writeStatusState(companion, {
        level: state.level,
        xp: state.totalXp,
        xpGain: bonus,
        celebration,
        cause,
      });
    }
    console.log(
      `Session bonus: +${bonus} XP → Level ${state.level} (${state.totalXp.toLocaleString()} XP total)`,
    );
    return;
  }

  const prevState = getXpState();
  const before = prevState.totalXp;
  const prevLevel = prevState.level;
  const state = awardXp(event as XpEvent, slot, species, rarity);
  const gained = state.totalXp - before;
  const whimRewarded = safeTickWhim(slot);
  if (companion) {
    const leveled = state.level > prevLevel;
    const discovered = maybeDiscoverWhim(leveled || whimRewarded);
    // No fallback cause: a plain event rolls no loot, so no side-channel echo.
    const { celebration, cause } = pickCelebration(
      state.level,
      leveled,
      whimRewarded,
      discovered,
      undefined,
    );
    writeStatusState(companion, {
      level: state.level,
      xp: state.totalXp,
      xpGain: gained,
      celebration,
      cause,
    });
  }
  console.log(
    `XP awarded: +${event} → Level ${state.level} (${state.totalXp.toLocaleString()} XP total)`,
  );
}

main();
