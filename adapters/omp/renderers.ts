import { RARITY_STARS } from "../../core/engine.ts";
import { getArtFrame, HAT_ART } from "../../core/render-model.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import type { Achievement } from "../../core/achievements.ts";
import { getRarityColor } from "../../server/theme.ts";

export const OMP_WIDGET_MAX_LINES = 10;

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const RESET = "\x1b[0m";
const DIM_ITALIC = "\x1b[2;3m";
const ART_GAP = "  ";
const DEFAULT_WIDGET_WIDTH = 78;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function characterWidth(character: string, next?: string): number {
  if (character === "\u200d" || /[\uFE00-\uFE0F]/u.test(character)) return 0;
  if (next === "\uFE0F" && /\p{Emoji}/u.test(character)) return 2;
  return /\p{Emoji_Presentation}/u.test(character) ? 2 : 1;
}

export function displayWidth(text: string): number {
  const characters = [...stripAnsi(text)];
  let width = 0;
  for (let index = 0; index < characters.length; index += 1) {
    width += characterWidth(characters[index]!, characters[index + 1]);
  }
  return width;
}

function trimArt(line: string): string {
  return line.replace(/\s+$/g, "");
}

function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  let result = "";
  let currentWidth = 0;
  for (const character of [...stripAnsi(text)]) {
    const nextWidth = characterWidth(character);
    if (currentWidth + nextWidth > width) break;
    result += character;
    currentWidth += nextWidth;
  }
  return result;
}

function wrapReaction(reaction: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of `💬 ${reaction.trim()}`.split(/\s+/)) {
    if (!word) continue;
    if (displayWidth(word) > width) {
      if (current) lines.push(current);
      lines.push(`${truncateToWidth(word, Math.max(1, width - 1))}…`);
      current = "";
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (displayWidth(candidate) > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;

  const bounded = lines.slice(0, maxLines);
  const last = bounded[maxLines - 1] ?? "";
  bounded[maxLines - 1] = `${truncateToWidth(last, Math.max(1, width - 1))}…`;
  return bounded;
}

function getWidgetWidth(): number {
  const columns = process.stdout.columns;
  return columns && columns > 0 ? Math.max(24, columns - 2) : DEFAULT_WIDGET_WIDTH;
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
  width: number,
  artWidth: number,
): string[] {
  const sideWidth = Math.max(8, width - artWidth - ART_GAP.length);
  const color = getRarityColor(companion.bones.rarity);
  const stars = RARITY_STARS[companion.bones.rarity];
  const shiny = companion.bones.shiny ? " ✨" : "";
  const lines = [
    `${color}${companion.name} ${stars}${shiny}${RESET}`,
    `${companion.bones.rarity} ${companion.bones.species}`,
  ];

  if (reaction?.reaction) {
    const remainingLines = Math.max(1, OMP_WIDGET_MAX_LINES - lines.length);
    lines.push(...wrapReaction(reaction.reaction, sideWidth, remainingLines).map((line) => `${DIM_ITALIC}${line}${RESET}`));
  }

  for (const achievement of achievements) {
    if (lines.length >= OMP_WIDGET_MAX_LINES) break;
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
  const artWidth = Math.max(...art.map(displayWidth), 0);
  const details = renderDetails(companion, reaction, achievements, Math.max(24, width), artWidth);
  const rows = Math.max(art.length, details.length);

  return Array.from({ length: Math.min(OMP_WIDGET_MAX_LINES, rows) }, (_, index) => {
    const artLine = art[index] ?? "";
    const detailLine = details[index] ?? "";
    return `${artLine}${" ".repeat(Math.max(0, artWidth - displayWidth(artLine)))}${ART_GAP}${detailLine}`.trimEnd();
  });
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
