import { RARITY_STARS } from "../../core/engine.ts";
import { getArtFrame, HAT_ART } from "../../core/render-model.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import type { Achievement } from "../../core/achievements.ts";

function trimArt(line: string): string {
  return line.replace(/\s+$/g, "");
}

export function renderBuddyStatus(companion: Companion, reaction?: ReactionState | null): string {
  const shiny = companion.bones.shiny ? " ✨" : "";
  const stars = RARITY_STARS[companion.bones.rarity];
  const suffix = reaction?.reaction ? ` — ${reaction.reaction}` : "";
  return `${trimArt(getArtFrame(companion.bones.species, companion.bones.eye, Date.now())[0])} ${companion.name} ${stars}${shiny}${suffix}`;
}

export function renderBuddyWidget(
  companion: Companion,
  reaction?: ReactionState | null,
  achievements: Achievement[] = [],
): string[] {
  const frame = Math.floor(Date.now() / 700);
  const art = getArtFrame(companion.bones.species, companion.bones.eye, frame).map(trimArt);
  const hat = companion.bones.hat === "none" ? [] : [trimArt(HAT_ART[companion.bones.hat])];
  const stars = RARITY_STARS[companion.bones.rarity];
  const shiny = companion.bones.shiny ? " ✨" : "";
  const lines = [
    `buddy · ${companion.name}`,
    `${companion.bones.rarity} ${companion.bones.species} ${stars}${shiny}`,
    "",
    ...hat,
    ...art,
  ];

  if (reaction?.reaction) {
    lines.push("", `“${reaction.reaction}”`);
  }

  if (achievements.length > 0) {
    lines.push("", ...achievements.map((achievement) => `🏆 ${achievement.name}`));
  }

  return lines;
}

export function renderBuddyStats(companion: Companion): string[] {
  return [
    `name: ${companion.name}`,
    `species: ${companion.bones.species}`,
    `rarity: ${companion.bones.rarity}`,
    `peak: ${companion.bones.peak}`,
    `dump: ${companion.bones.dump}`,
    "",
    ...Object.entries(companion.bones.stats).map(([stat, value]) => `${stat.padEnd(9)} ${String(value).padStart(3)}`),
  ];
}

export function renderAchievementsSummary(
  unlocked: Array<{ achievement: Achievement; unlockedAt: number; slot?: string }>,
  remaining: Achievement[],
): string[] {
  const lines = [`achievements unlocked: ${unlocked.length}`];

  if (unlocked.length > 0) {
    lines.push("", ...unlocked.map(({ achievement }) => `${achievement.icon} ${achievement.name}`));
  }

  if (remaining.length > 0) {
    lines.push("", `next up: ${remaining[0].icon} ${remaining[0].name}`);
  }

  return lines;
}
