import { RARITY_STARS } from "../../core/engine.ts";
import type { Achievement } from "../../core/achievements.ts";
import { getArtFrame, HAT_ART } from "../../core/render-model.ts";
import type { Companion, ReactionState } from "../../core/model.ts";
import { getRarityColor } from "../../server/theme.ts";

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ART_GAP = "  ";
const DEFAULT_WIDGET_WIDTH = 78;
const RESET = "\x1b[0m";
const DIM_ITALIC = "\x1b[2;3m";
const resizeSubscribers = new Set<() => void>();
let resizeDispatcher: (() => void) | null = null;

export const WIDGET_MAX_LINES = 10;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// East-Asian Wide/Fullwidth ranges. These MUST stay in sync with char_width()
// in statusline/buddy-status.sh \u2014 the two surfaces render the same companion
// card, and a disagreement here shears the bubble: borders sized from an
// undercounted width, text rows drawn at their true width.
//
// Box Drawing (U+2500-U+257F) and Block Elements sit inside the CJK span but
// are narrow, so they are carved out explicitly, matching the shell.
const BOX_DRAWING_START = 0x2500; // 9472
const BOX_DRAWING_END = 0x25bf; // 9631
const CJK_START = 0x3000; // 12288 \u2014 CJK punctuation through Hangul syllables
const CJK_END = 0x9fff; // 40959
const FULLWIDTH_START = 0xff01; // 65281 \u2014 Fullwidth ASCII variants
const FULLWIDTH_END = 0xff60; // 65376

function isEastAsianWide(codePoint: number): boolean {
  if (codePoint >= BOX_DRAWING_START && codePoint <= BOX_DRAWING_END) return false;
  if (codePoint >= CJK_START && codePoint <= CJK_END) return true;
  if (codePoint >= FULLWIDTH_START && codePoint <= FULLWIDTH_END) return true;
  return false;
}

function characterWidth(character: string, next?: string): number {
  if (character === "\u200d" || /[\uFE00-\uFE0F]/u.test(character)) return 0;
  if (next === "\uFE0F" && /\p{Emoji}/u.test(character)) return 2;
  if (/\p{Emoji_Presentation}/u.test(character)) return 2;
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && isEastAsianWide(codePoint) ? 2 : 1;
}

export function displayWidth(text: string): number {
  const characters = [...stripAnsi(text)];
  let width = 0;
  for (let index = 0; index < characters.length; index += 1) {
    width += characterWidth(characters[index]!, characters[index + 1]);
  }
  return width;
}

export function truncateToWidth(text: string, width: number): string {
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

export function wrapReaction(reaction: string, width: number, maxLines: number): string[] {
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

export function getWidgetWidth(): number {
  const columns = process.stdout.columns;
  return columns && columns > 0 ? Math.max(1, columns - 2) : DEFAULT_WIDGET_WIDTH;
}

/** Share one host resize listener across all adapter UI instances. */
export function subscribeToWidgetResize(callback: () => void): () => void {
  resizeSubscribers.add(callback);
  if (!resizeDispatcher) {
    resizeDispatcher = () => {
      for (const subscriber of resizeSubscribers) subscriber();
    };
    process.stdout.on("resize", resizeDispatcher);
  }

  return () => {
    resizeSubscribers.delete(callback);
    if (resizeSubscribers.size === 0 && resizeDispatcher) {
      process.stdout.removeListener("resize", resizeDispatcher);
      resizeDispatcher = null;
    }
  };
}

export function getDetailsWidth(art: string[], width: number = getWidgetWidth()): number {
  const artWidth = Math.max(...art.map(displayWidth), 0);
  return Math.max(8, Math.max(24, width) - artWidth - ART_GAP.length);
}

export function composeDetailsAndArt(
  details: string[],
  art: string[],
  width: number = getWidgetWidth(),
  maxLines: number = WIDGET_MAX_LINES,
): string[] {
  const artWidth = Math.max(...art.map(displayWidth), 0);
  const sideWidth = getDetailsWidth(art, width);
  const rows = Math.max(art.length, details.length);

  return Array.from({ length: Math.min(maxLines, rows) }, (_, index) => {
    const artLine = art[index] ?? "";
    const detailLine = details[index] ?? "";
    const boundedDetailLine = displayWidth(detailLine) > sideWidth ? truncateToWidth(detailLine, sideWidth) : detailLine;
    return `${boundedDetailLine}${" ".repeat(Math.max(0, sideWidth - displayWidth(boundedDetailLine)))}${ART_GAP}${artLine}${" ".repeat(Math.max(0, artWidth - displayWidth(artLine)))}`;
  });
}

function trimArt(line: string): string {
  return line.replace(/\s+$/g, "");
}

function centerToWidth(text: string, width: number): string {
  const bounded = truncateToWidth(text, width);
  const remaining = Math.max(0, width - displayWidth(bounded));
  const left = Math.floor(remaining / 2);
  return `${" ".repeat(left)}${bounded}${" ".repeat(remaining - left)}`;
}

function padLine(line: string, width: number): string {
  const bounded = displayWidth(line) > width ? truncateToWidth(line, width) : line;
  return `${bounded}${" ".repeat(Math.max(0, width - displayWidth(bounded)))}`;
}

function frameReaction(reaction: string, achievements: Achievement[], innerWidth: number): string[] {
  const reactionLines = wrapReaction(reaction, innerWidth, 2);
  const achievementLine = achievements[0] ? `🏆 ${achievements[0].name}` : "";
  const content = [...reactionLines, ...(achievementLine ? [achievementLine] : [])]
    .slice(0, 3)
    .map((line) => `${DIM_ITALIC}${line}${RESET}`);
  const top = `.${"-".repeat(innerWidth + 2)}.`;
  return [
    top,
    ...content.map((line) => `| ${padLine(line, innerWidth)} |`),
    `\`${"-".repeat(innerWidth + 2)}'`,
  ];
}

/**
 * Render the hero card shared by the OMP, Pi, and Claude Code surfaces.
 * The bubble is deliberately dropped as a unit when the sprite cannot fit.
 */
export function renderCompanionWidget(
  companion: Companion,
  reaction: ReactionState | null | undefined,
  achievements: Achievement[] = [],
  width: number = getWidgetWidth(),
  frame: number = Math.floor(Date.now() / 700),
): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const art = getArtFrame(companion.bones.species, companion.bones.eye, frame).map(trimArt);
  if (companion.bones.hat !== "none" && !art[0]?.trim()) art[0] = HAT_ART[companion.bones.hat];

  const color = getRarityColor(companion.bones.rarity);
  const label = `${companion.name} ${RARITY_STARS[companion.bones.rarity]}${companion.bones.shiny ? " ✨" : ""}`;
  const artWidth = Math.max(...art.map(displayWidth), 0);
  const labelWidth = displayWidth(label);
  const spriteWidth = Math.min(safeWidth, Math.max(artWidth, labelWidth));
  const clippedArt = art.map((line) => `${color}${padLine(line, spriteWidth)}${RESET}`);
  const clippedLabel = `${color}${centerToWidth(label, spriteWidth)}${RESET}`;

  const minBubbleInner = 12;
  const tailWidth = 3;
  const maxBubbleInner = safeWidth - spriteWidth - tailWidth - 4;
  const hasContent = Boolean(reaction?.reaction?.trim()) || achievements.length > 0;
  const canFrame = hasContent && maxBubbleInner >= minBubbleInner;
  const bubbleInner = canFrame ? Math.min(44, maxBubbleInner) : 0;
  const bubble = canFrame ? frameReaction(reaction?.reaction ?? "", achievements, bubbleInner) : [];
  const bubbleWidth = bubbleInner + 4;
  const cardWidth = canFrame ? bubbleWidth + tailWidth + spriteWidth : spriteWidth;
  const height = Math.max(clippedArt.length + 1, bubble.length);
  const connectorRow = canFrame ? Math.min(bubble.length - 2, Math.max(1, Math.floor(bubble.length / 2))) : -1;

  return Array.from({ length: Math.min(WIDGET_MAX_LINES, height) }, (_, index) => {
    const artLine = index < clippedArt.length ? clippedArt[index]! : index === clippedArt.length ? clippedLabel : "";
    const sprite = padLine(artLine, spriteWidth);
    let body: string;
    if (canFrame) {
      const bubbleLine = bubble[index] ?? " ".repeat(bubbleWidth);
      const tail = index === connectorRow ? "-- " : "   ";
      body = `${bubbleLine}${tail}${sprite}`;
    } else {
      body = sprite;
    }
    return `${" ".repeat(Math.max(0, safeWidth - cardWidth))}${body}`;
  });
}
