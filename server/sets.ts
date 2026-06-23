/**
 * Cosmetic sets (game-feel FR-C1): named groupings of existing cosmetics that
 * grant a flavor TITLE (and nothing mechanical) when fully owned. Pure-derived
 * from the companion's cosmeticFlags + hat — no new persisted state of its own;
 * the only side effect is granting the set's title (via xp.ts) once complete.
 *
 * A member is either a cosmeticFlag id, or "hat:<hat>" to require a worn hat.
 */

import type { Companion } from "./engine.ts";
import type { XpState } from "./xp.ts";

export interface CosmeticSet {
  id: string;
  name: string;
  /** Member tokens: a cosmeticFlag id, or "hat:<hat>". */
  members: string[];
  /** The flavor title granted on completion. */
  title: string;
}

export const COSMETIC_SETS: CosmeticSet[] = [
  {
    id: "arcane",
    name: "Arcane",
    members: ["hat:wizard", "glow", "constellation"],
    title: "Arcanist",
  },
  {
    id: "twinkle",
    name: "Twinkle",
    members: ["sparkle_eyes", "aura_shiny"],
    title: "Stargazer",
  },
  {
    id: "regal",
    name: "Regal",
    members: ["hat:crown", "has_third_eye"],
    title: "Sovereign",
  },
];

/** Whether a single set member is satisfied by the state + companion. */
export function memberMet(
  member: string,
  state: XpState,
  companion: Companion | null,
): boolean {
  if (member.startsWith("hat:")) {
    return !!companion && companion.bones.hat === member.slice(4);
  }
  return state.cosmeticFlags.includes(member);
}

export interface SetProgress {
  set: CosmeticSet;
  have: number;
  total: number;
  complete: boolean;
}

/** Progress toward every cosmetic set, in catalog order. */
export function setProgress(
  state: XpState,
  companion: Companion | null,
): SetProgress[] {
  return COSMETIC_SETS.map((set) => {
    const have = set.members.filter((m) => memberMet(m, state, companion)).length;
    return { set, have, total: set.members.length, complete: have === set.members.length };
  });
}

/**
 * Grant the title for any newly-completed set (idempotent; only sets a title
 * when none is worn). Returns the name of a title granted this call, or null.
 * Best-effort: a lazy require keeps sets.ts off the static xp.ts dependency.
 */
export function grantCompletedSetTitle(
  state: XpState,
  companion: Companion | null,
): string | null {
  for (const p of setProgress(state, companion)) {
    if (!p.complete) continue;
    if (state.title === p.set.title) return null; // already worn
    if (state.title !== null) continue; // a different title is worn — don't clobber
    try {
      const { grantTitleIfUnset } = require("./xp.ts") as typeof import("./xp.ts");
      grantTitleIfUnset(p.set.title);
      return p.set.title;
    } catch {
      return null;
    }
  }
  return null;
}

/** Markdown lines summarizing set progress, for the buddy_xp / buddy_list card. */
export function formatSetsLines(
  state: XpState,
  companion: Companion | null,
): string[] {
  const progress = setProgress(state, companion).filter((p) => p.have > 0);
  if (progress.length === 0) return [];
  const lines = ["**Cosmetic sets:**"];
  for (const p of progress) {
    const mark = p.complete ? `✅ «${p.set.title}»` : `${p.have}/${p.total}`;
    lines.push(`  - ${p.set.name}: ${mark}`);
  }
  return lines;
}
