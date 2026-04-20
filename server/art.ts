/**
 * ASCII art for all 18 buddy species
 *
 * Each species has 3 animation frames (idle variations).
 * Each frame is 5 lines, ~12 chars wide.
 * {E} is replaced with the eye character at render time.
 */

import type { Species, Eye, Hat, Rarity, StatName, BuddyBones } from "./engine.ts";

// ─── Species art: 3 frames × 5 lines each ──────────────────────────────────

export const SPECIES_ART: Record<Species, string[][]> = {
  duck: [
    ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--'    "],
    ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--'~   "],
    ["            ", "    __      ", "  <({E} )___  ", "   (  .__>  ", "    `--'    "],
  ],
  goose: [
    ["            ", "     ({E}>    ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ["            ", "    ({E}>     ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ["            ", "     ({E}>>   ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
  ],
  blob: [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (      )  ", "   `----'   "],
    ["            ", "  .------.  ", " (  {E}  {E}  ) ", " (        ) ", "  `------'  "],
    ["            ", "    .--.    ", "   ({E}  {E})   ", "   (    )   ", "    `--'    "],
  ],
  cat: [
    ["            ", "   /\\_/\\    ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")   "],
    ["            ", "   /\\_/\\    ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")~  "],
    ["            ", "   /\\-/\\    ", "  ( {E}   {E})  ", "  (  \u03c9  )   ", "  (\")_(\")   "],
  ],
  dragon: [
    ["            ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-'  "],
    ["            ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (        ) ", "  `-vvvv-'  "],
    ["   ~    ~   ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-'  "],
  ],
  octopus: [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  /\\/\\/\\/\\  "],
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  \\/\\/\\/\\/  "],
    ["     o      ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  /\\/\\/\\/\\  "],
  ],
  owl: [
    ["            ", "   /\\  /\\   ", "  (({E})({E}))  ", "  (  ><  )  ", "   `----'   "],
    ["            ", "   /\\  /\\   ", "  (({E})({E}))  ", "  (  ><  )  ", "   .----.   "],
    ["            ", "   /\\  /\\   ", "  (({E})(-))  ", "  (  ><  )  ", "   `----'   "],
  ],
  penguin: [
    ["            ", "  .---.     ", "  ({E}>{E})     ", " /(   )\\    ", "  `---'     "],
    ["            ", "  .---.     ", "  ({E}>{E})     ", " |(   )|    ", "  `---'     "],
    ["  .---.     ", "  ({E}>{E})     ", " /(   )\\    ", "  `---'     ", "   ~ ~      "],
  ],
  turtle: [
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[______]\\ ", "  ``    ``  "],
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[______]\\ ", "   ``  ``   "],
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[======]\\ ", "  ``    ``  "],
  ],
  snail: [
    ["            ", " {E}    .--.  ", "  \\  ( @ )  ", "   \\_`--'   ", "  ~~~~~~~   "],
    ["            ", "  {E}   .--.  ", "  |  ( @ )  ", "   \\_`--'   ", "  ~~~~~~~   "],
    ["            ", " {E}    .--.  ", "  \\  ( @  ) ", "   \\_`--'   ", "   ~~~~~~   "],
  ],
  ghost: [
    ["            ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  ~`~``~`~  "],
    ["            ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  `~`~~`~`  "],
    ["    ~  ~    ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  ~~`~~`~~  "],
  ],
  axolotl: [
    ["            ", "}~(______)~{", "}~({E} .. {E})~{", "  ( .--. )  ", "  (_/  \\_)  "],
    ["            ", "~}(______){~", "~}({E} .. {E}){~", "  ( .--. )  ", "  (_/  \\_)  "],
    ["            ", "}~(______)~{", "}~({E} .. {E})~{", "  (  --  )  ", "  ~_/  \\_~  "],
  ],
  capybara: [
    ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------'  "],
    ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   Oo   ) ", "  `------'  "],
    ["    ~  ~    ", "  u______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------'  "],
  ],
  cactus: [
    ["            ", " n  ____  n ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
    ["            ", "    ____    ", " n |{E}  {E}| n ", " |_|    |_| ", "   |    |   "],
    [" n        n ", " |  ____  | ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
  ],
  robot: [
    ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------'  "],
    ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ -==- ]  ", "  `------'  "],
    ["     *      ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------'  "],
  ],
  rabbit: [
    ["            ", "   (\\__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", "  (\")__(\")" ],
    ["            ", "   (|__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", "  (\")__(\")" ],
    ["            ", "   (\\__/)   ", "  ( {E}  {E} )  ", " =( .  . )= ", "  (\")__(\")" ],
  ],
  mushroom: [
    ["            ", " .-o-OO-o-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
    ["            ", " .-O-oo-O-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
    ["   . o  .   ", " .-o-OO-o-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
  ],
  chonk: [
    ["            ", "  /\\    /\\  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------'  "],
    ["            ", "  /\\    /|  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------'  "],
    ["            ", "  /\\    /\\  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------'~ "],
  ],
  wyvern: [
    ["}       {", 
     "|\\^```^/|",
     "\\ {E}' '{E} /", 
     " \\ } { /",
     " ≈(° °)≈",
     "   '-'"],
    ["}       {", 
     "|\\^```^/|",
     "\\ {E}' '{E} /", 
     " \\ } { /",
     " ≈(° °)≈",
     "  \x1b[38;2;255;120;0m//|\\\\\x1b[0m"],
    ["}       {", 
     "|\\^```^/|",
     "\\ {E}' '{E} /", 
     " \\ } { /",
     " ≈(° °)≈",
     "   'v'"],
  ]
};

// ─── Hat art ────────────────────────────────────────────────────────────────

export const HAT_ART: Record<Hat, string> = {
  none:      "",
  crown:     "   \\^^^/    ",
  tophat:    "   [___]    ",
  propeller: "    -+-     ",
  halo:      "   (   )    ",
  wizard:    "    /^\\     ",
  beanie:    "   (___)    ",
  tinyduck:  "    ,>      ",
};

// Wyvern line 0 is `}       {` (7 inner chars between horns).
// These replace that line so the hat sits between the horns.
const WYVERN_HAT: Partial<Record<Hat, string>> = {
  crown:     "} \\^^^/ {",  // \^^^/ (5) centered in 7
  tophat:    "} [___] {",   // [___] (5) centered in 7
  propeller: "}  -+-  {",   // -+- (3) centered in 7
  halo:      "} (   ) {",   // (   ) (5) centered in 7
  wizard:    "}  /^\\  {",  // /^\ (3) centered in 7
  beanie:    "} (___) {",   // (___) (5) centered in 7
  tinyduck:  "}  ,>   {",   // ,> (2) slightly left of center
};

function applyHat(species: Species, hat: Hat, art: string[]): void {
  if (hat === "none") return;
  if (species === "wyvern") {
    const wyvernLine = WYVERN_HAT[hat];
    if (wyvernLine) art[0] = wyvernLine;
  } else if (!art[0].trim()) {
    art[0] = HAT_ART[hat];
  }
}

// ─── Rarity ANSI colors ────────────────────────────────────────────────────

const RARITY_COLOR: Record<Rarity, string> = {
  common:    "\x1b[38;2;153;153;153m",  // inactive   rgb(153,153,153)
  uncommon:  "\x1b[38;2;78;186;101m",   // success    rgb(78,186,101)
  rare:      "\x1b[38;2;177;185;249m",  // permission rgb(177,185,249)
  epic:      "\x1b[38;2;175;135;255m",  // autoAccept rgb(175,135,255)
  legendary: "\x1b[38;2;255;193;7m",    // warning    rgb(255,193,7)
};

const SHINY_COLOR = "\x1b[93m"; // bright yellow
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

export const RARITY_STARS: Record<Rarity, string> = {
  common: "\u2605",
  uncommon: "\u2605\u2605",
  rare: "\u2605\u2605\u2605",
  epic: "\u2605\u2605\u2605\u2605",
  legendary: "\u2605\u2605\u2605\u2605\u2605",
};

// ─── Display width helpers ──────────────────────────────────────────────────

function stripAnsi(s: string): string { return s.replace(/\x1b\[[^m]*m/g, ""); }

// Unicode property escapes (ES2018) are the source of truth for which
// codepoints terminals render 2 cols wide. The statusline (bash) can't use
// these directly, so scripts/gen-emoji-widths.ts exports the subset that
// bash needs into statusline/emoji-widths.data — regenerate on version bumps.
const EMOJI_PRES_RE = /\p{Emoji_Presentation}/u;
const EMOJI_RE = /\p{Emoji}/u;

// Precondition: ch is neither a variation selector (U+FE00-U+FE0F) nor ZWJ
// (U+200D); displayWidth filters those before calling in.
function charWidth(ch: string): number {
  if (EMOJI_PRES_RE.test(ch)) return 2;
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x2500 && cp <= 0x259F) return 1;
  if (cp >= 0x3000 && cp <= 0x9FFF) return 2;
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
  return 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  let upgradable = false;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xFE0F) {
      // VS16 forces emoji presentation on the previous codepoint; upgrade
      // its width from 1 to 2 if it was narrow-but-emoji (e.g. ❤ + VS16).
      if (upgradable) { w += 1; upgradable = false; }
      continue;
    }
    if ((cp >= 0xFE00 && cp <= 0xFE0E) || cp === 0x200D) {
      upgradable = false;
      continue;
    }
    const cw = charWidth(ch);
    w += cw;
    upgradable = cw === 1 && EMOJI_RE.test(ch);
  }
  return w;
}

/** Pad string with spaces to reach target display width */
function dpad(s: string, targetW: number): string {
  const w = displayWidth(s);
  return w < targetW ? s + " ".repeat(targetW - w) : s;
}

// ─── Render functions ───────────────────────────────────────────────────────

export function getArtFrame(species: Species, eye: Eye, frame: number = 0): string[] {
  const frames = SPECIES_ART[species];
  const f = frames[frame % frames.length];
  return f.map((line) => line.replace(/\{E\}/g, eye));
}

export function renderCompanionCard(
  bones: BuddyBones,
  name: string,
  personality: string,
  reaction?: string,
  frame: number = 0,
  width: number = 40,
): string {
  const color = RARITY_COLOR[bones.rarity];
  const stars = RARITY_STARS[bones.rarity];
  const shiny = bones.shiny ? `${SHINY_COLOR}\u2728 ${NC}` : "";
  const art = getArtFrame(bones.species, bones.eye, frame);
  applyHat(bones.species, bones.hat, art);

  // Build the card
  const W = Math.max(24, width);
  const hr = "\u2500".repeat(W - 2);
  const lines: string[] = [];

  // Top border
  lines.push(`${color}\u256d${hr}\u256e${NC}`);

  // Inner width = W - 2 (borders), content area = W - 4 (borders + padding)
  const innerW = W - 4;

  // Species art (centered)
  for (const artLine of art) {
    if (!artLine.trim()) continue;
    lines.push(`${color}\u2502${NC}  ${dpad(artLine, innerW)}${color}\u2502${NC}`);
  }

  // Separator
  lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);

  // Name + rarity
  const nameStarsRaw = `${BOLD}${name}${NC}  ${color}${stars}${NC}`;
  lines.push(`${color}\u2502${NC}  ${nameStarsRaw}${" ".repeat(Math.max(0, innerW - displayWidth(name) - 2 - displayWidth(stars)))}${color}\u2502${NC}`);

  const rarityRaw = `${shiny}${color}${BOLD}${bones.rarity.toUpperCase()}${NC} ${bones.species}`;
  const rarityVis = (bones.shiny ? 3 : 0) + bones.rarity.length + 1 + bones.species.length;
  lines.push(`${color}\u2502${NC}  ${rarityRaw}${" ".repeat(Math.max(0, innerW - rarityVis))}${color}\u2502${NC}`);

  // Eye + Hat info
  const cosmeticLine = `eye: ${bones.eye}  hat: ${bones.hat}`;
  lines.push(`${color}\u2502${NC}  ${DIM}${cosmeticLine}${NC}${" ".repeat(Math.max(0, innerW - displayWidth(cosmeticLine)))}${color}\u2502${NC}`);

  // Separator
  lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);

  // Stats
  const STAT_NAMES: StatName[] = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];
  for (const stat of STAT_NAMES) {
    const val = bones.stats[stat];
    const filled = Math.round(val / 10);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
    const label = stat.slice(0, 3).padEnd(3);
    const marker = stat === bones.peak ? " \u25b2" : stat === bones.dump ? " \u25bc" : "  ";
    const valStr = String(val).padStart(3);
    const statLine = `${DIM}${label}${NC} ${bar} ${valStr}${marker}`;
    const statVis = 3 + 1 + 10 + 1 + 3 + 2; // label + spaces + bar + val + marker = 20
    lines.push(`${color}\u2502${NC}  ${statLine}${" ".repeat(Math.max(0, innerW - statVis))}${color}\u2502${NC}`);
  }

  // Speech bubble (if reaction)
  if (reaction) {
    lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);
    const maxMsg = innerW - 3; // "💬 " prefix (💬 = 2 cols + space)
    const msg = displayWidth(reaction) > maxMsg ? reaction.slice(0, maxMsg - 1) + "\u2026" : reaction;
    const msgPad = Math.max(0, innerW - displayWidth(msg) - 3);
    lines.push(`${color}\u2502${NC}  \ud83d\udcac ${msg}${" ".repeat(msgPad)}${color}\u2502${NC}`);
  }

  // Personality
  if (personality) {
    lines.push(`${color}\u251c${"╌".repeat(W - 2)}\u2524${NC}`);
    const words = personality.split(" ");
    let line = "";
    for (const word of words) {
      if (displayWidth(line) + displayWidth(word) + 1 > innerW) {
        lines.push(`${color}\u2502${NC}  ${DIM}${dpad(line, innerW)}${NC}${color}\u2502${NC}`);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) {
      lines.push(`${color}\u2502${NC}  ${DIM}${dpad(line, innerW)}${NC}${color}\u2502${NC}`);
    }
  }

  // Bottom border
  lines.push(`${color}\u2570${hr}\u256f${NC}`);

  return lines.join("\n");
}

// ─── Markdown-native render (for MCP tool responses) ───────────────────────
//
// Claude Code's UI doesn't render raw ANSI escape codes properly — it strips
// the ESC byte but leaves "[38;2;...m" as literal text, making the output
// unreadable. This renderer produces pure markdown with unicode rarity dots
// instead of ANSI colors, so it renders cleanly in any MCP client UI.

const RARITY_DOT: Record<Rarity, string> = {
  common:    "\u26AA",  // ⚪ white circle
  uncommon:  "\uD83D\uDFE2",  // 🟢 green circle
  rare:      "\uD83D\uDD35",  // 🔵 blue circle
  epic:      "\uD83D\uDFE3",  // 🟣 purple circle
  legendary: "\uD83D\uDFE1",  // 🟡 yellow circle
};

export function renderCompanionCardMarkdown(
  bones: BuddyBones,
  name: string,
  personality: string,
  reaction?: string,
  frame: number = 0,
): string {
  const dot = RARITY_DOT[bones.rarity];
  const stars = RARITY_STARS[bones.rarity];
  const shiny = bones.shiny ? " \u2728" : "";
  const art = getArtFrame(bones.species, bones.eye, frame);
  applyHat(bones.species, bones.hat, art);

  // Strip empty lines from art for cleaner rendering
  const artLines = art.filter((l) => l.trim().length > 0);

  const STAT_NAMES: StatName[] = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];
  const statRows = STAT_NAMES.map((stat) => {
    const val = bones.stats[stat];
    const filled = Math.round(val / 10);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
    const marker = stat === bones.peak ? " \u25B2" : stat === bones.dump ? " \u25BC" : "";
    const label = `**${stat.slice(0, 3)}**${stat.slice(3)}`;
    return `| ${label} | ${val}${marker} | \`${bar}\` |`;
  }).join("\n");

  const parts: string[] = [];

  // Header: rarity dot, name, species+rarity, stars, shiny
  parts.push(`### ${dot} ${name} · \`${bones.rarity.toUpperCase()} ${bones.species}\` · ${stars}${shiny}`);
  parts.push("");

  // ASCII art in a code block (preserves monospaced formatting)
  parts.push("```");
  parts.push(artLines.join("\n"));
  parts.push("```");
  parts.push("");

  // Identity line
  parts.push(`**Identity:** eye \`${bones.eye}\` · hat \`${bones.hat}\``);
  parts.push("");

  // Stats table
  parts.push("| Stat | Value | Bar |");
  parts.push("|---|---|---|");
  parts.push(statRows);
  parts.push("");

  // Reaction (if any) — reactions often already contain asterisks
  // for actions like "*blinks slowly*", so render them verbatim to avoid
  // accidentally turning italics into bold.
  if (reaction) {
    parts.push(`\ud83d\udcac ${reaction}`);
    parts.push("");
  }

  // Personality as blockquote
  if (personality) {
    parts.push(`> ${personality}`);
  }

  return parts.join("\n");
}

// ─── Compact status line render ─────────────────────────────────────────────

export function renderStatusLine(
  bones: BuddyBones,
  name: string,
  reaction?: string,
): string {
  const face = SPECIES_ART[bones.species][0][2]?.replace(/\{E\}/g, bones.eye).trim() || "(?)";
  const color = RARITY_COLOR[bones.rarity];
  const stars = RARITY_STARS[bones.rarity];
  const shiny = bones.shiny ? "\u2728" : "";
  const msg = reaction ? ` \u2502 "${reaction}"` : "";
  return `${color}${face}${NC} ${BOLD}${name}${NC} ${shiny}${color}${stars}${NC}${msg}`;
}
