import { RARITY_STARS } from "../../core/engine.ts";
import { getArtFrame, HAT_ART } from "../../core/render-model.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import type { Achievement } from "../../core/achievements.ts";
import { getRarityColor } from "../../server/theme.ts";
import {
  composeDetailsAndArt,
  displayWidth,
  getDetailsWidth,
  getWidgetWidth,
  stripAnsi,
  WIDGET_MAX_LINES,
  wrapReaction,
} from "../shared/widget-layout.ts";

const RESET = "\x1b[0m";
const DIM_ITALIC = "\x1b[2;3m";

export { displayWidth, WIDGET_MAX_LINES as OMP_WIDGET_MAX_LINES };

function trimArt(line: string): string {
  return line.replace(/\s+$/g, "");
}

function getFullArtFrame(companion: Companion, frame: number): string[] {
  const art = getArtFrame(companion.bones.species, companion.bones.eye, frame);
  if (companion.bones.hat !== "none" && !stripAnsi(art[0] ?? "").trim()) {
    art[0] = HAT_ART[companion.bones.hat];
  }
  return art.map(trimArt);
}

function renderDetails(
  companion: Companion,
  reaction: ReactionState | null | undefined,
  achievements: Achievement[],
  sideWidth: number,
): string[] {
  const color = getRarityColor(companion.bones.rarity);
  const stars = RARITY_STARS[companion.bones.rarity];
  const shiny = companion.bones.shiny ? " ✨" : "";
  const lines = [
    `${color}${companion.name} ${stars}${shiny}${RESET}`,
    `${companion.bones.rarity} ${companion.bones.species}`,
  ];

  if (reaction?.reaction) {
    const remainingLines = Math.max(1, WIDGET_MAX_LINES - lines.length);
    lines.push(...wrapReaction(reaction.reaction, sideWidth, remainingLines).map((line) => `${DIM_ITALIC}${line}${RESET}`));
  }

  for (const achievement of achievements) {
    if (lines.length >= WIDGET_MAX_LINES) break;
    lines.push(`🏆 ${achievement.name}`);
  }

  return lines;
}

export function renderBuddyWidget(
  companion: Companion,
  reaction?: ReactionState | null,
  achievements: Achievement[] = [],
  width: number = getWidgetWidth(),
): string[] {
  const art = getFullArtFrame(companion, Math.floor(Date.now() / 700));
  const sideWidth = getDetailsWidth(art, width);
  const details = renderDetails(companion, reaction, achievements, sideWidth);
  return composeDetailsAndArt(details, art, width, WIDGET_MAX_LINES);
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
