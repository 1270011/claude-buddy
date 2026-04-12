#!/usr/bin/env bun
/**
 * buddy-shell — terminal wrapper with fixed buddy panel at bottom.
 *
 * Intercepts specific ANSI sequences from the PTY (alternate screen,
 * screen clear, scroll region reset) and repairs the panel after each.
 * Everything else passes through unmodified.
 *
 * Usage:
 *   npx tsx cli/buddy-shell.ts          # runs claude
 *   npx tsx cli/buddy-shell.ts bash     # runs bash
 */

import { spawn as ptySpawn } from "node-pty";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getArtFrame, HAT_ART } from "../server/art.ts";
import type { Species, Eye, Hat } from "../server/engine.ts";
import { getBiome, listBiomes } from "./biomes.ts";

if (!process.stdin.isTTY && !process.argv.includes("--biomes")) {
  console.error("buddy-shell requires an interactive terminal (TTY)");
  process.exit(1);
}

// --biomes flag: list all and exit
if (process.argv.includes("--biomes")) {
  console.log("\nAvailable biomes:\n");
  for (const b of listBiomes()) {
    const tag = b.isDefault ? " (default)" : "";
    console.log(`  ${b.name}${tag}`);
  }
  console.log(`\nUsage: npx tsx cli/buddy-shell.ts claude --biome volcano\n`);
  process.exit(0);
}

// Parse --biome <name> from args
const biomeArgIdx = process.argv.indexOf("--biome");
const biomeOverride = biomeArgIdx >= 0 ? process.argv[biomeArgIdx + 1] : undefined;

const ESC = "\x1b";
const CSI = `${ESC}[`;
const moveTo = (r: number, c: number) => `${CSI}${r};${c}H`;
const clearLine = `${CSI}2K`;
const setScrollRegion = (top: number, bot: number) => `${CSI}${top};${bot}r`;
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
const NC = `${CSI}0m`;
const CYAN = `${CSI}36m`;
const GREEN = `${CSI}32m`;
const YELLOW = `${CSI}33m`;
const MAGENTA = `${CSI}35m`;
const GRAY = `${CSI}90m`;

const RED = `${CSI}31m`;
const BLUE = `${CSI}34m`;

const RARITY_CLR: Record<string, string> = {
  common: GRAY, uncommon: GREEN, rare: BLUE,
  epic: MAGENTA, legendary: YELLOW,
};


const STATE_DIR = join(homedir(), ".claude-buddy");

function layout() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const panel = Math.max(5, Math.floor(rows * 0.20));
  const code = rows - panel;
  return { cols, rows, panel, code };
}

function loadStatus(): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, "status.json"), "utf8"));
  } catch { return null; }
}

function loadStats(): Record<string, any> | null {
  try {
    const m = JSON.parse(readFileSync(join(STATE_DIR, "menagerie.json"), "utf8"));
    return m.companions?.[m.active]?.bones ?? null;
  } catch { return null; }
}

// ─── Render panel + set scroll region ───────────────────────────────────────

function setupPanel() {
  const { cols, code, panel } = layout();
  const s = loadStatus();
  const bones = loadStats();

  const out: string[] = [];

  // Set scroll region to code area only
  out.push(setScrollRegion(1, code));

  // Clear panel area
  for (let i = 0; i < panel; i++) {
    out.push(moveTo(code + 1 + i, 1) + clearLine);
  }

  // Separator line
  out.push(moveTo(code + 1, 1) +
    `${CYAN}─ buddy ${"─".repeat(Math.max(0, cols - 9))}${NC}`);

  if (!s) {
    out.push(moveTo(code + 2, 1) +
      `${DIM}  No buddy. Run: bun run install-buddy${NC}`);
    process.stdout.write(out.join(""));
    return;
  }

  const clr = RARITY_CLR[s.rarity] ?? GRAY;
  const shiny = s.shiny ? " ✨" : "";

  // ─── 3-column layout ──────────────────────────────────────────
  //
  //  | left: speech bubble | center: buddy art | far right: stats |
  //

  // Get ASCII art
  let artLines: string[] = [];
  try {
    artLines = getArtFrame(s.species as Species, s.eye as Eye, 0);
    const hatLine = HAT_ART[s.hat as Hat];
    if (hatLine && artLines[0] && !artLines[0].trim()) artLines[0] = hatLine;
    artLines = artLines.filter(l => l.trim());
  } catch {
    artLines = [s.face || "(??)"];
  }

  const contentRows = panel - 1;
  const artW = 14;
  const artStart = Math.floor(cols / 2) - Math.floor(artW / 2);

  // ── Speech bubble (simple, above buddy) ──
  let bubbleLines: string[] = [];
  const maxBubbleW = Math.min(40, artStart - 4); // up to 40 chars or available space
  const maxBubbleLines = Math.max(1, contentRows - 2); // leave room for top/bottom border

  if (s.reaction && !s.muted && maxBubbleW > 8) {
    const text = s.reaction;
    const wrapped: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line.length + word.length + 1 > maxBubbleW) {
        if (line) wrapped.push(line);
        line = word.length > maxBubbleW ? word.slice(0, maxBubbleW - 1) + "…" : word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) wrapped.push(line);
    const maxLines = Math.min(wrapped.length, maxBubbleLines);
    const bw = Math.max(...wrapped.slice(0, maxLines).map(l => l.length));
    bubbleLines.push(`╭${"─".repeat(bw + 2)}╮`);
    for (let i = 0; i < maxLines; i++) {
      bubbleLines.push(`│ ${wrapped[i].padEnd(bw)} │`);
    }
    bubbleLines.push(`╰${"─".repeat(bw + 2)}╯`);
  }
  const bubbleW = bubbleLines.length > 0 ? bubbleLines[0].length : 0;
  const bubbleCol = Math.max(1, artStart - Math.floor(bubbleW / 2));

  // ── Right column: name + stats (far right) ──
  const statW = 20;
  const rightStart = cols - statW;
  const rightLines: string[] = [];
  rightLines.push(`${BOLD}${clr}${s.name}${NC}${shiny}`);
  rightLines.push(`${clr}${s.rarity?.toUpperCase()} ${s.species} ${s.stars}${NC}`);

  if (bones?.stats) {
    for (const [k, v] of Object.entries(bones.stats as Record<string, number>)) {
      const marker = k === bones.peak ? "▲" : k === bones.dump ? "▼" : " ";
      const c = k === bones.peak ? GREEN : k === bones.dump ? `${CSI}31m` : DIM;
      rightLines.push(`${c}${k.padEnd(10)} ${String(v).padStart(3)}${marker}${NC}`);
    }
  }

  // ── Generate landscape from biome ──
  function renderBgRow(row: number, seed: number, isGround: boolean): string {
    const bgOut: string[] = [];
    bgOut.push(moveTo(row, 1) + clearLine);
    if (isGround) {
      bgOut.push(moveTo(row, 1));
      let line = "";
      const gc = biome.groundChars;
      for (let x = 0; x < cols; x++) {
        line += gc[(x * 13 + 7) % gc.length];
      }
      bgOut.push(`${biome.ground}${line}${NC}`);
    } else {
      const pChars = biome.particle.chars;
      for (let x = 1; x <= cols; x++) {
        const h = ((seed * 31 + x * 17) % 97);
        if (h < 3) {
          bgOut.push(moveTo(row, x) + `${biome.particle.color}${pChars[0]}${NC}`);
        } else if (h < 5 && pChars.length > 1) {
          bgOut.push(moveTo(row, x) + `${biome.particle.color}${pChars[1]}${NC}`);
        } else if (h < 6 && pChars.length > 2) {
          bgOut.push(moveTo(row, x) + `${biome.particle.color}${pChars[2]}${NC}`);
        }
      }
    }
    return bgOut.join("");
  }

  // Structure from biome (house/lighthouse/tower/etc)
  const biome = getBiome(s.rarity, biomeOverride);
  const structureLines = biome.structure.slice(-contentRows);
  const structureStart = artStart + artW + 2;

  // Position buddy so feet are on the ground (last art line = last row)
  // If art has 4 lines and contentRows is 4:
  //   row 0: art[0] (sky)
  //   row 1: art[1] (sky)
  //   row 2: art[2] (sky)
  //   row 3: art[3] (ground) — feet on grass
  const artOffset = Math.max(0, contentRows - artLines.length);
  const structOffset = Math.max(0, contentRows - structureLines.length);

  // ── Render rows ──
  for (let i = 0; i < contentRows; i++) {
    const row = code + 2 + i;
    const isLastRow = i === contentRows - 1;

    // Background: sky or ground
    out.push(renderBgRow(row, i * 3 + 1, isLastRow));

    // Structure from biome (right of buddy, on the ground)
    const structIdx = i - structOffset;
    if (structIdx >= 0 && structIdx < structureLines.length && structureStart + 16 < rightStart) {
      out.push(moveTo(row, structureStart) + structureLines[structIdx]);
    }

    // Speech bubble (above buddy)
    if (i < bubbleLines.length && bubbleCol > 0) {
      out.push(moveTo(row, bubbleCol) + `${clr}${bubbleLines[i]}${NC}`);
    }

    // Buddy art (feet on ground)
    const artIdx = i - artOffset;
    if (artIdx >= 0 && artIdx < artLines.length) {
      out.push(moveTo(row, artStart) + `${clr}${BOLD}${artLines[artIdx]}${NC}`);
    }

    // Stats (far right)
    if (i < rightLines.length) {
      out.push(moveTo(row, rightStart) + rightLines[i]);
    }
  }

  process.stdout.write(out.join(""));
}

// ─── Sequences that destroy our panel ───────────────────────────────────────

const DESTRUCTIVE = [
  "\x1b[?1049h",   // enter alternate screen
  "\x1b[?1049l",   // leave alternate screen
  "\x1b[2J",       // clear entire screen
  "\x1b[r",        // reset scroll region
];

function containsDestructive(data: string): boolean {
  return DESTRUCTIVE.some(seq => data.includes(seq));
}

// ─── Main ───────────────────────────────────────────────────────────────────

const { cols, code } = layout();

process.stdin.setRawMode(true);
process.stdin.resume();

// Initial setup: clear code area, render panel
// Clear each line in the code area individually
for (let i = 1; i <= code; i++) {
  process.stdout.write(moveTo(i, 1) + clearLine);
}
setupPanel();
process.stdout.write(moveTo(1, 1));

// Spawn PTY (filter out --biome args)
const rawArgs = process.argv.slice(2).filter((a, i, arr) =>
  a !== "--biome" && (i === 0 || arr[i - 1] !== "--biome")
);
const cmd = rawArgs[0] || "claude";
const args = rawArgs.slice(1);

const pty = ptySpawn(cmd, args, {
  name: "xterm-256color",
  cols: cols,
  rows: code,
  cwd: process.cwd(),
  env: { ...process.env, BUDDY_SHELL: "1" } as Record<string, string>,
});

// PTY output → terminal, repair panel if damaged
pty.onData((data: string) => {
  // Forward output
  process.stdout.write(data);

  // If output contained destructive sequences, repair immediately
  if (containsDestructive(data)) {
    process.stdout.write(`${ESC}7`);  // save cursor
    setupPanel();                      // re-set scroll region + re-render panel
    process.stdout.write(`${ESC}8`);  // restore cursor
  }
});

// Keyboard → PTY
process.stdin.on("data", (data: Buffer) => {
  pty.write(data.toString());
});

// Resize
process.stdout.on("resize", () => {
  const l = layout();
  pty.resize(l.cols, l.code);
  process.stdout.write(`${ESC}7`);
  setupPanel();
  process.stdout.write(`${ESC}8`);
});

// Periodic panel refresh (repairs gradual damage)
const timer = setInterval(() => {
  process.stdout.write(`${ESC}7`);
  setupPanel();
  process.stdout.write(`${ESC}8`);
}, 3000);

// Cleanup
pty.onExit(({ exitCode }) => {
  clearInterval(timer);
  // Reset scroll region and clear panel
  process.stdout.write(`${CSI}r`);
  const l = layout();
  for (let i = 0; i < l.panel; i++) {
    process.stdout.write(moveTo(l.code + 1 + i, 1) + clearLine);
  }
  process.stdout.write(`${CSI}?25h`);
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
  process.exit(exitCode);
});

await new Promise(() => {});
