const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ART_GAP = "  ";
const DEFAULT_WIDGET_WIDTH = 78;

export const WIDGET_MAX_LINES = 10;

export function stripAnsi(text: string): string {
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
  return columns && columns > 0 ? Math.max(24, columns - 2) : DEFAULT_WIDGET_WIDTH;
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
